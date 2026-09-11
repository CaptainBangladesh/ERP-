import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import MailComposer from 'nodemailer/lib/mail-composer';
import { MAILBOX_ERROR_CODES } from '@erp/shared';
import { ApiException } from '../../http/api-exception';
import {
  DevMailer,
  SMTP_TIMEOUTS,
  describeResendSenderProblem,
  isNameResolutionFailure,
  isSmtpRelayConfigured,
  isUnreachableMailHost,
  sendThroughRelay,
  verifyThroughRelay,
  type MailMessage,
} from '../../platform/mail';
import { decryptSmtpPassword } from '../../platform/secrets';

/**
 * A mailbox, as much of one as sending needs to know.
 *
 * Deliberately the stored row rather than `MailboxConnectionSummary`: the summary is what a
 * screen may see, and it has no password and no token precisely so that it cannot send.
 */
export interface SendingMailbox {
  id: string;
  provider: string;
  emailAddress: string;
  displayName: string;
  accessToken: string | null;
  refreshToken: string | null;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpSecure: boolean | null;
  smtpUsername: string | null;
  smtpPassword: string | null;
}

/**
 * Sending *as a particular mailbox*.
 *
 * Separate from the platform's `Mailer`, and the distinction is the point of this file.
 * `Mailer` is how the *system* speaks — password resets, invitations — one configured sender
 * for the whole deployment. This is how a *person* speaks: mail that has to come from the
 * salesperson's own address, through their own account, so a reply reaches them.
 *
 * Which transport carries it is decided by the mailbox the user picked, not by configuration:
 * a `gmail` mailbox goes out through the Gmail API using the token that mailbox holds, and an
 * `smtp` mailbox through its own host with its own credentials. That is what makes "personal
 * or company" a real choice at the moment of sending rather than a label on a row.
 */
export abstract class MailboxSender {
  abstract sendFrom(mailbox: SendingMailbox, message: MailMessage): Promise<void>;

  /**
   * Proves a set of SMTP settings by connecting and authenticating with them.
   *
   * Part of this seam rather than a second one because it is the same capability — talking to
   * somebody's mail server — and because a suite with no mail server to reach has to be able
   * to stand in for both halves together.
   */
  abstract verifySmtp(settings: SmtpSettings): Promise<void>;
}

/** Enough to open a connection, before there is a stored mailbox to open one for. */
export interface SmtpSettings {
  smtpHost: string | null;
  smtpPort: number | null;
  smtpSecure: boolean | null;
  smtpUsername: string | null;
  smtpPassword: string | null;
  emailAddress: string;
}

@Injectable()
export class LiveMailboxSender extends MailboxSender {
  private readonly logger = new Logger(LiveMailboxSender.name);

  async verifySmtp(settings: SmtpSettings): Promise<void> {
    if (isSmtpRelayConfigured()) {
      return verifyThroughRelay({
        host: settings.smtpHost || '',
        port: settings.smtpPort || 465,
        secure: settings.smtpSecure ?? ((settings.smtpPort || 465) === 465),
        username: settings.smtpUsername || settings.emailAddress,
        password: storedPasswordOf(settings),
      });
    }

    /**
     * With Resend carrying the mail, the stored SMTP password is never used, so opening a
     * socket to the mail host would prove nothing about whether a send will work. What
     * decides that is whether Resend will accept this *sender*, so that is what is checked.
     */
    if (process.env.RESEND_API_KEY) {
      const problem = await describeResendSenderProblem(
        process.env.RESEND_API_KEY,
        settings.emailAddress,
      );
      if (problem) throw new Error(problem);
      return;
    }

    const transport = smtpTransportFor(settings);
    try {
      await transport.verify();
    } finally {
      transport.close();
    }
  }

  async sendFrom(mailbox: SendingMailbox, message: MailMessage): Promise<void> {
    switch (mailbox.provider) {
      case 'smtp':
        if (isSmtpRelayConfigured()) {
          this.logger.log(`SMTP_RELAY_URL detected: delivering via Vercel HTTPS relay for ${mailbox.emailAddress}`);
          const from = mailbox.displayName
            ? `${mailbox.displayName} <${mailbox.emailAddress}>`
            : mailbox.emailAddress;
          return sendThroughRelay(
            {
              host: mailbox.smtpHost || '',
              port: mailbox.smtpPort || 465,
              secure: mailbox.smtpSecure ?? ((mailbox.smtpPort || 465) === 465),
              username: mailbox.smtpUsername || mailbox.emailAddress,
              password: storedPasswordOf(mailbox),
            },
            {
              from,
              to: message.to,
              subject: message.subject,
              body: message.body,
              html: message.html,
              inReplyTo: message.inReplyTo,
              references: message.references,
            },
          );
        }
        if (process.env.RESEND_API_KEY) {
          this.logger.log(`RESEND_API_KEY detected: delivering via Resend HTTPS API for ${mailbox.emailAddress}`);
          return this.sendOverResend(mailbox, message, process.env.RESEND_API_KEY);
        }
        return this.sendOverSmtp(mailbox, message);
      case 'resend':
        return this.sendOverResend(
          mailbox,
          message,
          process.env.RESEND_API_KEY || (mailbox as any).accessToken || '',
        );
      case 'gmail':
        return this.sendOverGmail(mailbox, message);
      default:
        throw sendFailed(
          `Sending from a ${mailbox.provider} mailbox is not supported yet. Nothing was sent.`,
        );
    }
  }

  /**
   * Free HTTP-based delivery via Resend API over HTTPS (port 443).
   *
   * Standard SMTP ports (25, 465, 587) are blocked by cloud hosts like Render's Free tier.
   * Resend delivers over standard HTTPS (port 443), which is never blocked and costs $0.
   */
  private async sendOverResend(
    mailbox: { displayName: string; emailAddress: string },
    message: MailMessage,
    apiKey: string,
  ): Promise<void> {
    const from = mailbox.displayName
      ? `${mailbox.displayName} <${mailbox.emailAddress}>`
      : mailbox.emailAddress;

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [message.to],
        subject: message.subject,
        text: message.body,
        html: message.html,
        // Resend sets arbitrary headers from this map; In-Reply-To/References is how a reply
        // threads under the original in the recipient's client.
        ...(message.inReplyTo || message.references
          ? {
              headers: {
                ...(message.inReplyTo ? { 'In-Reply-To': message.inReplyTo } : {}),
                ...(message.references ? { References: message.references } : {}),
              },
            }
          : {}),
      }),
    }).catch((err) => {
      throw sendFailed(`Could not reach Resend API: ${err instanceof Error ? err.message : String(err)}`);
    });

    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { message?: string };
      throw sendFailed(`Resend API refused the message (HTTP ${response.status}): ${data.message || 'Unknown error'}`);
    }
  }

  /**
   * Company mail hosting — Private Email, Fastmail, Exchange, anything speaking SMTP.
   *
   * The transport is built per send from this mailbox's own credentials rather than from the
   * environment, which is the whole reason two people in one company can send from two
   * different accounts.
   */
  private async sendOverSmtp(mailbox: SendingMailbox, message: MailMessage): Promise<void> {
    const transport = smtpTransportFor(mailbox);

    try {
      await transport.sendMail({
        from: { name: mailbox.displayName, address: mailbox.emailAddress },
        to: message.to,
        subject: message.subject,
        text: message.body,
        html: message.html,
        ...(message.inReplyTo ? { inReplyTo: message.inReplyTo } : {}),
        ...(message.references ? { references: message.references } : {}),
      });
    } catch (cause) {
      this.logger.error(
        `Failed to send "${message.subject}" to ${message.to} as ${mailbox.emailAddress} via ` +
          `${mailbox.smtpHost}:${mailbox.smtpPort ?? 587}.`,
        cause instanceof Error ? cause.stack : String(cause),
      );
      throw sendFailed(describeCause(cause, mailbox));
    } finally {
      transport.close();
    }
  }

  /**
   * The Gmail API, sending as the account that consented.
   *
   * Worth the extra machinery over SMTP for a personal Gmail: the message lands in that
   * account's own Sent folder and threads with the reply, which is what somebody expects of
   * mail they sent — and it needs no password, only the token the mailbox already holds.
   *
   * An expired access token is refreshed and the send retried once. Access tokens last an
   * hour, so without this a mailbox connected this morning would fail every afternoon.
   */
  private async sendOverGmail(mailbox: SendingMailbox, message: MailMessage): Promise<void> {
    if (!mailbox.accessToken) {
      throw sendFailed('This Gmail mailbox is not authorised. Reconnect it and try again.');
    }

    const raw = await buildRawMessage(mailbox, message);

    let response = await sendGmailRaw(mailbox.accessToken, raw);

    if (response.status === 401 && mailbox.refreshToken) {
      const refreshed = await refreshGoogleAccessToken(mailbox.refreshToken);
      if (refreshed) response = await sendGmailRaw(refreshed, raw);
    }

    if (!response.ok) {
      throw sendFailed(
        response.status === 401
          ? 'Google no longer accepts this mailbox. Reconnect it and try again.'
          : `Google refused the message (HTTP ${response.status}).`,
      );
    }
  }
}

/**
 * The sender under test, which delivers into `DevMailer` instead of the internet.
 *
 * Forwarding to `DevMailer` rather than keeping its own list means every existing test that
 * reads `DevMailer.sent` as its inbox keeps working, and `sentFrom` adds the one thing those
 * tests could not see before: *which mailbox* carried the message.
 */
@Injectable()
export class RecordingMailboxSender extends MailboxSender {
  readonly sentFrom: { mailboxId: string; provider: string; emailAddress: string }[] = [];

  /** A password the stub rejects, so "the host said no" is testable without a host. */
  static readonly REJECTED_PASSWORD = 'wrong-password';

  constructor(private readonly devMailer: DevMailer) {
    super();
  }

  async verifySmtp(settings: SmtpSettings): Promise<void> {
    if (!settings.smtpPassword) throw new Error('No password given.');

    // The stored value is encrypted, so the check is on what it decrypts to — which also
    // proves the encryption round-trips on the way through.
    if (decryptSmtpPassword(settings.smtpPassword) === RecordingMailboxSender.REJECTED_PASSWORD) {
      throw new Error('535 Authentication failed');
    }
  }

  async sendFrom(mailbox: SendingMailbox, message: MailMessage): Promise<void> {
    this.sentFrom.push({
      mailboxId: mailbox.id,
      provider: mailbox.provider,
      emailAddress: mailbox.emailAddress,
    });
    await this.devMailer.send(message);
  }
}

/**
 * A transport for one mailbox's settings.
 *
 * Also used to prove settings before they are stored — see `MailboxesService.connectSmtp` —
 * so that a wrong password is a message under the form rather than a campaign that fails
 * halfway through tomorrow.
 */
export function smtpTransportFor(mailbox: SmtpSettings): nodemailer.Transporter {
  if (!mailbox.smtpHost || !mailbox.smtpPassword) {
    throw sendFailed('This mailbox has no SMTP settings. Add them again.');
  }

  const port = mailbox.smtpPort ?? 587;

  return nodemailer.createTransport({
    host: mailbox.smtpHost,
    port,
    secure: mailbox.smtpSecure ?? port === 465,
    auth: {
      user: mailbox.smtpUsername || mailbox.emailAddress,
      pass: storedPasswordOf(mailbox),
    },
    ...SMTP_TIMEOUTS,
  });
}

/**
 * The mailbox's password, or a refusal that says why it could not be read.
 *
 * `decryptSmtpPassword` throws a bare `Error` for a value the key will not open, and a bare
 * error out of here becomes a 500 with no code on it — which every screen shows as "Something
 * went wrong. Please try again.", the least useful sentence available for the one failure that
 * has a precise cause and a precise fix.
 *
 * That cause is almost always a deployment: the row was encrypted under one `MAILBOX_SECRET`
 * (or, unset, `SESSION_SECRET`) and is being read under another — which is exactly what
 * happens when a hosted server shares a database with a laptop and the two hold different
 * secrets. Reconnecting the mailbox re-encrypts it under the key the server actually has, so
 * that is what the message says.
 */
function storedPasswordOf(mailbox: SmtpSettings): string {
  try {
    return decryptSmtpPassword(mailbox.smtpPassword!);
  } catch {
    throw sendFailed(
      `The stored password for ${mailbox.emailAddress} could not be read on this server — ` +
        'it was saved under a different encryption secret. Reconnect this mailbox to store it ' +
        'again. Nothing was sent.',
    );
  }
}

/**
 * The message as bytes on the wire, which is what the Gmail API takes.
 *
 * Built with nodemailer's composer rather than by hand: headers carrying a name with an
 * accent, or a subject longer than a line, have encoding rules that are easy to get subtly
 * wrong and produce mail that renders as mojibake in somebody's client.
 */
async function buildRawMessage(
  mailbox: SendingMailbox,
  message: MailMessage,
): Promise<string> {
  const composed = await new MailComposer({
    from: { name: mailbox.displayName, address: mailbox.emailAddress },
    to: message.to,
    subject: message.subject,
    text: message.body,
    html: message.html,
    ...(message.inReplyTo ? { inReplyTo: message.inReplyTo } : {}),
    ...(message.references ? { references: message.references } : {}),
  })
    .compile()
    .build();

  return composed.toString('base64url');
}

async function sendGmailRaw(
  accessToken: string,
  raw: string,
): Promise<{ ok: boolean; status: number }> {
  const response = await fetch(
    'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw }),
    },
  ).catch(() => undefined);

  if (!response) return { ok: false, status: 0 };
  return { ok: response.ok, status: response.status };
}

/** A fresh access token, or `undefined` if Google will not grant one. */
async function refreshGoogleAccessToken(refreshToken: string): Promise<string | undefined> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return undefined;

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  }).catch(() => undefined);

  if (!response?.ok) return undefined;

  const tokens = (await response.json()) as { access_token?: string };
  return tokens.access_token;
}

/**
 * What to tell somebody whose mail did not go out.
 *
 * "The mail server refused the message" is right for a 5xx from a host that answered and
 * wrong for the failure this most often is on a hosting platform: nothing answered at all,
 * because outbound SMTP is blocked there. Those two need different sentences — one is fixed
 * by correcting the mailbox, the other only by the people who run the server — so the
 * connection failures are named as connection failures rather than as a refusal.
 */
function describeCause(cause: unknown, mailbox: SmtpSettings): string {
  const detail = cause instanceof Error ? cause.message : String(cause);
  const where = `${mailbox.smtpHost}:${mailbox.smtpPort ?? 587}`;

  // A name that does not resolve is a typo, not a blocked port, and saying "your host blocks
  // SMTP" here would send somebody to change their hosting plan over a misspelling.
  if (isNameResolutionFailure(cause)) {
    return (
      `No mail server was found at ${where} (${detail}). Check the host name on this ` +
      'mailbox. Nothing was sent.'
    );
  }

  if (isUnreachableMailHost(cause)) {
    return (
      `Could not reach ${where} from this server (${detail}). This server cannot open outbound ` +
      'SMTP connections — hosting platforms commonly block ports 25, 465 and 587, and Render ' +
      'blocks all three on free web services. The mailbox settings are not at fault and ' +
      'retyping the password will not help. Set SMTP_RELAY_URL to send over HTTPS instead ' +
      '(see docs/deployment/hosted-email.md), or move this API to a plan that permits ' +
      'outbound SMTP. Nothing was sent.'
    );
  }

  return `The mail server refused the message: ${detail}`;
}

/** The message did not go out, and nothing should be recorded as though it had. */
export function sendFailed(detail: string): ApiException {
  return new ApiException(MAILBOX_ERROR_CODES.sendFailed, detail, HttpStatus.BAD_GATEWAY);
}
