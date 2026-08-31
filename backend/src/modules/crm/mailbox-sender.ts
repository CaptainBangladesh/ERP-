import { HttpStatus, Injectable } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import MailComposer from 'nodemailer/lib/mail-composer';
import { MAILBOX_ERROR_CODES } from '@erp/shared';
import { ApiException } from '../../http/api-exception';
import { DevMailer, type MailMessage } from '../../platform/mail';
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
  async verifySmtp(settings: SmtpSettings): Promise<void> {
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
        return this.sendOverSmtp(mailbox, message);
      case 'gmail':
        return this.sendOverGmail(mailbox, message);
      default:
        throw sendFailed(
          `Sending from a ${mailbox.provider} mailbox is not supported yet. Nothing was sent.`,
        );
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
      });
    } catch (cause) {
      throw sendFailed(describeCause(cause));
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
      pass: decryptSmtpPassword(mailbox.smtpPassword),
    },
  });
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

function describeCause(cause: unknown): string {
  const detail = cause instanceof Error ? cause.message : String(cause);
  return `The mail server refused the message: ${detail}`;
}

/** The message did not go out, and nothing should be recorded as though it had. */
export function sendFailed(detail: string): ApiException {
  return new ApiException(MAILBOX_ERROR_CODES.sendFailed, detail, HttpStatus.BAD_GATEWAY);
}
