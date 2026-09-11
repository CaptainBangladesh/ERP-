import { HttpStatus, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Socket } from 'node:net';
import {
  MAILBOX_ERROR_CODES,
  type ConnectMailboxUrlResponse,
  type MailDeliveryDiagnostics,
  type MailDiagnosticCheck,
  type MailTransportKind,
  type MailboxConnectionSummary,
  type MailboxProvider,
  type MailboxStatus,
} from '@erp/shared';
import { ApiException } from '../../http/api-exception';
import {
  companyApplied,
  InjectPrisma,
  Tenancy,
  type ScopedPrisma,
} from '../../platform/tenancy';
import { MailboxOAuth } from './mailbox-oauth';
import { CompanyDirectory, type CompanyMailAccount } from '../../platform/company';
import {
  checkRelayReachable,
  isSmtpRelayConfigured,
  smtpRelayUrl,
} from '../../platform/mail';
import { decryptSmtpPassword, encryptSmtpPassword } from '../../platform/secrets';
import { MailboxSender, type SendingMailbox } from './mailbox-sender';
import { imapHostFor } from './imap-host';

@Injectable()
export class MailboxesService {
  constructor(
    @InjectPrisma() private readonly prisma: ScopedPrisma,
    private readonly tenancy: Tenancy,
    private readonly oauth: MailboxOAuth,
    private readonly sender: MailboxSender,
    /**
     * The company's owner and its mail account, asked of the platform.
     *
     * CRM read `prisma.company` directly for both until the conformance pack refused it:
     * `Company` is identity's, and querying it bound this module to identity's schema without
     * either side declaring the edge. See `platform/company`.
     */
    private readonly company: CompanyDirectory,
  ) {}

  async createConnectUrl(
    provider: MailboxProvider,
    actor: { userId: string },
  ): Promise<ConnectMailboxUrlResponse> {
    const stateToken = `mbs_${randomBytes(16).toString('hex')}`;

    // Before the pending-connection row exists, because this refuses for a provider that has
    // no implementation or no credentials on this server — and a refusal that had already
    // written a row would leave one behind for a consent screen nobody was ever sent to.
    const url = this.oauth.consentUrl(provider, stateToken, mailboxRedirectUri());

    await this.prisma.mailboxAuthState.create({
      data: companyApplied({
        userId: actor.userId,
        provider,
        stateToken,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000), // 15 minutes
      }),
    });

    return { url, stateToken };
  }

  /**
   * The provider's answer, recorded as a connection — or nothing at all.
   *
   * The exchange runs before anything is written, and it throws unless the provider named the
   * account. That ordering is the point: there is no path here that writes a connected
   * mailbox without a provider having said whose it is. What used to sit in its place
   * defaulted the address to `gmail_user@example.com` whenever the exchange failed, which put
   * a mailbox nobody had authorised on the screen and left the real failure invisible.
   */
  async handleOAuthCallback(
    stateToken: string,
    code: string,
  ): Promise<{ success: boolean; mailboxId: string }> {
    const authState = await this.tenancy.withoutCompanyScope(
      'crm.mailbox.oauth_state_lookup',
      () =>
        this.prisma.mailboxAuthState.findUnique({
          where: { stateToken },
        }),
    );

    if (!authState || authState.expiresAt.getTime() <= Date.now()) {
      throw invalidAuthState();
    }

    const provider = authState.provider as MailboxProvider;
    const identity = await this.oauth.exchange(provider, code, mailboxRedirectUri());

    return this.tenancy.runInCompany(
      { companyId: authState.companyId, grants: 'all' },
      async () => {
        const connection = await this.prisma.mailboxConnection.upsert({
          where: {
            companyId_userId_provider: {
              companyId: authState.companyId,
              userId: authState.userId,
              provider: authState.provider,
            },
          },
          update: {
            status: 'connected',
            emailAddress: identity.emailAddress,
            displayName: identity.displayName,
            accessToken: identity.accessToken,
            tokenExpiresAt: identity.expiresAt ?? null,
            // Google sends a refresh token on first consent and may omit it on a later one.
            // Absent means "keep the one already stored", never "there is none".
            ...(identity.refreshToken ? { refreshToken: identity.refreshToken } : {}),
            connectedAt: new Date(),
          },
          create: companyApplied({
            userId: authState.userId,
            provider: authState.provider,
            emailAddress: identity.emailAddress,
            displayName: identity.displayName,
            status: 'connected',
            accessToken: identity.accessToken,
            refreshToken: identity.refreshToken,
            tokenExpiresAt: identity.expiresAt ?? null,
          }),
        });

        // Single use. A state token that outlived its exchange is a replay waiting to happen.
        await this.prisma.mailboxAuthState.deleteMany({ where: { id: authState.id } });

        return { success: true, mailboxId: connection.id };
      },
    );
  }

  async listMailboxes(
    actor: { userId: string; isOwner?: boolean } | string,
  ): Promise<MailboxConnectionSummary[]> {
    const context = typeof actor === 'string' ? { userId: actor, isOwner: false } : actor;
    const ownerUserId = (await this.company.ownerUserId()) ?? undefined;

    const rows = await this.prisma.mailboxConnection.findMany({
      where: {
        OR: [
          { userId: context.userId },
          { provider: 'smtp' },
          ...(ownerUserId ? [{ userId: ownerUserId }] : []),
        ],
      },
      orderBy: { createdAt: 'desc' },
    });

    const summaries = rows.map((r: any) => describeMailbox(r, context, ownerUserId));

    /**
     * The company mailbox is derived from the company's mail settings, not stored.
     *
     * It used to be written into this table — by whichever of CRM or identity got there
     * first — and the copy is what made the settings screen and the mailbox list disagree
     * whenever one of them changed something. Deriving it means there is one place the
     * company's mail account lives, clearing those settings removes the mailbox with them,
     * and a module that does not own the settings no longer writes them anywhere.
     *
     * A stored SMTP row still wins: that is a mailbox somebody connected here on purpose.
     */
    if (rows.some((r: any) => r.provider === 'smtp')) return summaries;

    const derived = await this.companyMailbox(context);
    return derived ? [...summaries, derived] : summaries;
  }

  /**
   * The company's own address, as a mailbox its people can send from.
   *
   * `null` whenever the company has not finished configuring mail — an address with no host
   * or no password cannot send, and offering it would produce a failure at send time in a
   * place nobody is watching.
   */
  private async companyMailbox(context: {
    userId: string;
    isOwner?: boolean;
  }): Promise<MailboxConnectionSummary | null> {
    const account = await this.company.mailAccount();
    if (!usableCompanyMail(account)) return null;

    const now = new Date().toISOString();
    const displayName = account.fromName || account.fromAddress;

    return {
      id: companyMailboxId(this.tenancy.current()?.companyId),
      userId: context.userId,
      provider: 'smtp',
      emailAddress: account.fromAddress,
      displayName,
      status: 'connected',
      connectedAt: now,
      createdAt: now,
      updatedAt: now,
      isShared: true,
      canManage: Boolean(context.isOwner),
      smtp: {
        host: account.smtpHost,
        port: account.smtpPort ?? 465,
        secure: account.smtpSecure ?? true,
        username: account.smtpUsername || account.fromAddress,
      },
    };
  }

  async requireMailbox(
    id: string,
    actor?: { userId: string; isOwner?: boolean },
  ): Promise<MailboxConnectionSummary> {
    const row = await this.prisma.mailboxConnection.findUnique({
      where: { id },
    });

    if (!row) {
      // The company mailbox has no row to find: it is derived from the company's own mail
      // settings, so it answers here from the same place the list built it.
      const derived = isCompanyMailboxId(id) && actor ? await this.companyMailbox(actor) : null;
      if (derived) return derived;
      throw mailboxNotFound();
    }

    const ownerUserId = (await this.company.ownerUserId()) ?? undefined;
    return describeMailbox(row, actor, ownerUserId);
  }

  /**
   * Adds a company mailbox from its SMTP settings.
   *
   * No redirect, no consent screen, no third party to ask — which is the whole difference
   * from the OAuth providers, and why company mail hosting (Private Email, Fastmail, an
   * Exchange server) needs a route of its own rather than a provider button that could never
   * work for it.
   *
   * The settings are *proved before they are stored*: `verify()` opens a connection and
   * authenticates. Saving them unchecked would move the failure to the first send — most
   * likely a campaign, at volume, long after whoever typed the password has stopped looking —
   * and leave a mailbox on the screen marked connected that never was.
   */
  async connectSmtp(
    input: {
      host: string;
      port: number;
      secure: boolean;
      emailAddress: string;
      displayName: string;
      username: string;
      password: string;
    },
    actor: { userId: string },
  ): Promise<MailboxConnectionSummary> {
    const encrypted = encryptSmtpPassword(input.password);

    const candidate = {
      smtpHost: input.host.trim(),
      smtpPort: input.port,
      smtpSecure: input.secure,
      smtpUsername: input.username.trim() || input.emailAddress.trim(),
      smtpPassword: encrypted,
      emailAddress: input.emailAddress.trim(),
    };

    try {
      await this.sender.verifySmtp(candidate);
    } catch (cause) {
      throw smtpSettingsRejected(cause instanceof Error ? cause.message : String(cause));
    }

    const settings = {
      status: 'connected',
      emailAddress: candidate.emailAddress,
      displayName: input.displayName.trim() || candidate.emailAddress,
      smtpHost: candidate.smtpHost,
      smtpPort: candidate.smtpPort,
      smtpSecure: candidate.smtpSecure,
      smtpUsername: candidate.smtpUsername,
      smtpPassword: candidate.smtpPassword,
    };

    // Found through the scoped client, which applies the company itself.
    // Re-adding or updating the company SMTP mailbox updates the company's shared mailbox.
    const existing = await this.prisma.mailboxConnection.findFirst({
      where: { provider: 'smtp' },
    });

    const connection = existing
      ? await this.prisma.mailboxConnection.update({
          where: { id: existing.id },
          data: { ...settings, connectedAt: new Date() },
        })
      : await this.prisma.mailboxConnection.create({
          data: companyApplied({ userId: actor.userId, provider: 'smtp', ...settings }),
        });

    // The same credentials become the company's, so system mailings — invitations, password
    // resets — leave from the address staff see in CRM rather than from the deployment's.
    // Written through the platform's seam: the column belongs to the tenant root, not here.
    await this.company.saveMailAccount({
      fromAddress: candidate.emailAddress,
      fromName: input.displayName.trim() || candidate.emailAddress,
      smtpHost: candidate.smtpHost,
      smtpPort: candidate.smtpPort,
      smtpSecure: candidate.smtpSecure,
      smtpUsername: candidate.smtpUsername,
      smtpPassword: candidate.smtpPassword,
    });

    return describeMailbox(connection, { userId: actor.userId, isOwner: true });
  }

  /**
   * The mailbox as the thing that sends, credentials and all.
   *
   * Kept apart from `requireMailbox`, which answers the summary a screen may see. Nothing
   * that renders gets the token or the password; only the sender asks for this.
   */
  async sendingMailbox(id: string): Promise<SendingMailbox> {
    const row = await this.prisma.mailboxConnection.findUnique({ where: { id } });
    if (row) return row as SendingMailbox;

    if (isCompanyMailboxId(id)) {
      const account = await this.company.mailAccount();
      if (usableCompanyMail(account)) {
        return {
          id,
          provider: 'smtp',
          emailAddress: account.fromAddress,
          displayName: account.fromName || account.fromAddress,
          accessToken: null,
          refreshToken: null,
          smtpHost: account.smtpHost,
          smtpPort: account.smtpPort ?? 465,
          smtpSecure: account.smtpSecure ?? true,
          smtpUsername: account.smtpUsername || account.fromAddress,
          smtpPassword: account.smtpPassword,
        };
      }
    }

    throw mailboxNotFound();
  }

  /**
   * What this server can and cannot do about sending mail, asked of the server itself.
   *
   * Every check here answers a question that otherwise costs a redeploy: can this machine open
   * an outbound SMTP socket at all, is the relay deployed and does it agree on the shared
   * secret, and does the stored password still open under the secret this server holds. Those
   * three produce nearly identical refusals at send time and have completely different fixes.
   *
   * Nothing is sent and no secret is returned — only whether each part is present and whether
   * it works.
   */
  async mailDiagnostics(): Promise<MailDeliveryDiagnostics> {
    const account = await this.company.mailAccount();
    const mailbox = await this.prisma.mailboxConnection
      .findFirst({ where: { provider: 'smtp' } })
      .catch(() => null);

    const host = mailbox?.smtpHost || account?.smtpHost || null;
    const port = mailbox?.smtpPort ?? account?.smtpPort ?? 465;
    const address = mailbox?.emailAddress || account?.fromAddress || null;
    const storedSecret = mailbox?.smtpPassword || account?.smtpPassword || null;

    const transport: MailTransportKind = isSmtpRelayConfigured()
      ? 'relay'
      : process.env.RESEND_API_KEY
        ? 'resend'
        : 'direct-smtp';

    /**
     * The two checks that touch the network are skipped under test, the same way
     * `CompanyMailer` refuses to become a real connection there: the suite has no relay to
     * reach and no mail host to probe, and a diagnostics call that dialled the internet would
     * make every run depend on somebody else's uptime.
     */
    const probing = process.env.NODE_ENV !== 'test';

    const relayCheck = !probing
      ? { reachable: false, detail: 'Not probed under test.' }
      : isSmtpRelayConfigured()
        ? await checkRelayReachable()
        : { reachable: false, detail: 'No SMTP_RELAY_URL is set, so no relay is used.' };

    // The definitive test for the failure this whole file exists to explain: open a bare TCP
    // socket to the mail host and see whether the platform lets it through. A blocked port
    // does not refuse — it hangs — so the timeout is the answer, not an inconclusive result.
    const outboundSmtp = !probing
      ? { ok: false, detail: 'Not probed under test.' }
      : host
        ? await probeOutboundSmtp(host, port)
        : { ok: false, detail: 'No company mailbox is configured, so there is no host to probe.' };

    // The same bare-socket test for the *inbound* side: whether this server can reach the
    // mailbox over IMAP to read replies. A host can permit one and block the other, so this is
    // asked separately from the SMTP probe above and answered on the port a poll would use.
    const outboundImap = !probing
      ? { ok: false, detail: 'Not probed under test.' }
      : host
        ? await probeOutboundImap(imapHostFor(host), 993)
        : { ok: false, detail: 'No company mailbox is configured, so there is no host to probe.' };

    let storedPassword: MailDiagnosticCheck;
    if (!storedSecret) {
      storedPassword = { ok: false, detail: 'No password is stored for this mailbox.' };
    } else {
      try {
        decryptSmtpPassword(storedSecret);
        storedPassword = {
          ok: true,
          detail: 'The stored password opens under the secret this server holds.',
        };
      } catch {
        storedPassword = {
          ok: false,
          detail:
            'The stored password cannot be read on this server — it was saved under a ' +
            'different MAILBOX_SECRET or SESSION_SECRET. Reconnect the mailbox here to ' +
            're-encrypt it under this server’s key.',
        };
      }
    }

    return {
      transport,
      outboundSmtp,
      outboundImap,
      relay: {
        configured: isSmtpRelayConfigured(),
        url: smtpRelayUrl() ?? null,
        ok: relayCheck.reachable,
        detail: relayCheck.detail,
      },
      companyMailbox: {
        configured: Boolean(host && address),
        address,
        host,
        ok: Boolean(host && address && storedSecret),
        detail:
          host && address
            ? `Sending as ${address} through ${host}:${port}.`
            : 'No company mailbox is configured yet.',
      },
      storedPassword,
      environment: {
        nodeEnv: process.env.NODE_ENV ?? 'development',
        resendConfigured: Boolean(process.env.RESEND_API_KEY),
        deploymentSmtpConfigured: Boolean(process.env.SMTP_HOST),
      },
    };
  }

  /**
   * Deletes a connection outright.
   *
   * Distinct from `disconnectMailbox`, which keeps the row so it can be reconnected. This is
   * for a connection somebody wants off the screen — including one that was never usable.
   *
   * Refused while a campaign still names it, the same way a role assigned to somebody cannot
   * be deleted: the column is a plain id with no foreign key behind it, so deleting anyway
   * would leave a campaign pointing at a mailbox that no longer exists, and the failure would
   * surface later at send time with nothing to explain it.
   */
  async removeMailbox(id: string, actor?: { userId: string; isOwner?: boolean }): Promise<void> {
    const row = await this.prisma.mailboxConnection.findUnique({ where: { id } });
    if (!row) throw mailboxNotFound();

    if (actor && !actor.isOwner && row.userId !== actor.userId) {
      throw mailboxForbidden('Only the company owner or mailbox creator can remove this mailbox.');
    }

    const campaigns = await this.prisma.campaign.count({
      where: { mailboxConnectionId: id },
    });
    if (campaigns > 0) throw mailboxInUse();

    await this.prisma.mailboxConnection.delete({ where: { id } });
  }

  async disconnectMailbox(
    id: string,
    actor?: { userId: string; isOwner?: boolean },
  ): Promise<MailboxConnectionSummary> {
    const row = await this.prisma.mailboxConnection.findUnique({
      where: { id },
    });
    if (!row) throw mailboxNotFound();

    if (actor && !actor.isOwner && row.userId !== actor.userId) {
      throw mailboxForbidden('Only the company owner or mailbox creator can disconnect this mailbox.');
    }

    const updated = await this.prisma.mailboxConnection.update({
      where: { id },
      data: { status: 'revoked' },
    });

    const ownerUserId = (await this.company.ownerUserId()) ?? undefined;
    return describeMailbox(updated, actor, ownerUserId);
  }
}

/**
 * The derived company mailbox's identifier.
 *
 * A prefix rather than a row id because there is no row: the mailbox is the company's mail
 * settings seen as a mailbox, and this is what lets a send name it. Scoping means there is
 * only ever one company in play, so the suffix identifies rather than disambiguates.
 */
const COMPANY_MAILBOX_PREFIX = 'company-smtp-';

export function companyMailboxId(companyId: string | undefined): string {
  return `${COMPANY_MAILBOX_PREFIX}${companyId ?? 'company'}`;
}

export function isCompanyMailboxId(id: string): boolean {
  return id.startsWith(COMPANY_MAILBOX_PREFIX);
}

/** A company mail account with enough filled in to actually send. */
type UsableCompanyMail = CompanyMailAccount & {
  fromAddress: string;
  smtpHost: string;
  smtpPassword: string;
};

function usableCompanyMail(account: CompanyMailAccount | null): account is UsableCompanyMail {
  return Boolean(account?.fromAddress && account.smtpHost && account.smtpPassword);
}

export function describeMailbox(
  row: {
    id: string;
    userId: string;
    provider: string;
    emailAddress: string;
    displayName: string;
    status: string;
    connectedAt: Date;
    createdAt: Date;
    updatedAt: Date;
    smtpHost?: string | null;
    smtpPort?: number | null;
    smtpSecure?: boolean | null;
    smtpUsername?: string | null;
  },
  actor?: { userId: string; isOwner?: boolean },
  ownerUserId?: string | null,
): MailboxConnectionSummary {
  const isOwner = Boolean(actor?.isOwner);
  const isCreator = actor?.userId ? row.userId === actor.userId : true;
  const isSmtp = row.provider === 'smtp';
  const isOwnerMailbox = Boolean(ownerUserId && row.userId === ownerUserId);
  const isShared = isSmtp || isOwnerMailbox;
  const canManage = isCreator || isOwner;

  return {
    id: row.id,
    userId: row.userId,
    provider: row.provider as MailboxProvider,
    emailAddress: row.emailAddress,
    displayName: row.displayName,
    status: row.status as MailboxStatus,
    connectedAt: row.connectedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    isShared,
    canManage,
    // Where it sends through, so the screen can show a company mailbox as more than a name.
    // The password is not here and has no route that returns it.
    ...(row.smtpHost
      ? {
          smtp: {
            host: row.smtpHost,
            port: row.smtpPort ?? 587,
            secure: row.smtpSecure ?? false,
            username: row.smtpUsername ?? row.emailAddress,
          },
        }
      : {}),
  };
}

/**
 * Whether this machine can open a TCP connection to a mail host at all.
 *
 * A bare socket rather than an SMTP conversation, because the question is about the network
 * and not about the mailbox: no credentials are sent, nothing is authenticated, and the
 * connection is closed the moment it succeeds. That keeps the answer unambiguous — a host
 * that accepts the socket and then rejects a password is a different finding entirely.
 *
 * A blocked port does not answer with a refusal; the packets are dropped and the connection
 * hangs until something gives up. So the deadline here *is* the result, and it is short
 * enough to keep a diagnostics request responsive.
 */
async function probeOutboundSmtp(host: string, port: number): Promise<MailDiagnosticCheck> {
  const TIMEOUT_MS = 8_000;

  return new Promise<MailDiagnosticCheck>((resolve) => {
    const socket = new Socket();
    let settled = false;

    const finish = (result: MailDiagnosticCheck) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(TIMEOUT_MS);

    socket.once('connect', () =>
      finish({ ok: true, detail: `Opened a connection to ${host}:${port}.` }),
    );

    socket.once('timeout', () =>
      finish({
        ok: false,
        detail:
          `Connecting to ${host}:${port} timed out after ${TIMEOUT_MS / 1000}s. Outbound SMTP ` +
          'is blocked where this API is hosted — Render blocks ports 25, 465 and 587 on free ' +
          'web services. Mail must go over HTTPS through a relay, or the API must move to a ' +
          'plan that permits outbound SMTP.',
      }),
    );

    socket.once('error', (cause: NodeJS.ErrnoException) =>
      finish({
        ok: false,
        detail: `Could not connect to ${host}:${port}: ${cause.message}`,
      }),
    );

    socket.connect(port, host);
  });
}

/**
 * The inbound counterpart to `probeOutboundSmtp`: can this server open an IMAP socket to read
 * replies? Same mechanism — a bare connect, where a timeout is the finding because a blocked
 * port hangs rather than refuses — with the one difference that matters for the operator: IMAP
 * (993) and SMTP (465/587) are blocked independently, so "sending works" says nothing about
 * whether reading will.
 */
async function probeOutboundImap(host: string, port: number): Promise<MailDiagnosticCheck> {
  const TIMEOUT_MS = 8_000;

  return new Promise<MailDiagnosticCheck>((resolve) => {
    const socket = new Socket();
    let settled = false;

    const finish = (result: MailDiagnosticCheck) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(TIMEOUT_MS);

    socket.once('connect', () =>
      finish({ ok: true, detail: `Opened an IMAP connection to ${host}:${port}.` }),
    );

    socket.once('timeout', () =>
      finish({
        ok: false,
        detail:
          `Connecting to ${host}:${port} timed out after ${TIMEOUT_MS / 1000}s. Outbound IMAP ` +
          'appears blocked where this API is hosted, so replies cannot be read here. Reply ' +
          'capture needs a host that permits outbound IMAP (993).',
      }),
    );

    socket.once('error', (cause: NodeJS.ErrnoException) =>
      finish({
        ok: false,
        detail: `Could not connect to ${host}:${port}: ${cause.message}`,
      }),
    );

    socket.connect(port, host);
  });
}

/** The mail host would not accept these settings, so they were not stored. */
export function smtpSettingsRejected(detail: string): ApiException {
  return new ApiException(
    MAILBOX_ERROR_CODES.smtpSettingsRejected,
    `The mail server did not accept these settings: ${detail}`,
    HttpStatus.BAD_REQUEST,
  );
}

export function mailboxNotFound(): ApiException {
  return new ApiException(
    MAILBOX_ERROR_CODES.mailboxNotFound,
    'That mailbox connection does not exist.',
    HttpStatus.NOT_FOUND,
  );
}

export function mailboxNotConnected(reason?: string): ApiException {
  return new ApiException(
    MAILBOX_ERROR_CODES.mailboxNotConnected,
    `Mailbox connection is not active.${reason ? ' ' + reason : ''}`,
    HttpStatus.BAD_REQUEST,
  );
}

export function invalidAuthState(): ApiException {
  return new ApiException(
    MAILBOX_ERROR_CODES.invalidAuthState,
    'Invalid or expired OAuth state token.',
    HttpStatus.BAD_REQUEST,
  );
}

/**
 * The address Google returns a mailbox connection to.
 *
 * Sent twice — once to start the consent flow and again to exchange the code — and Google
 * compares it literally both times, so it is read in one place rather than written out at
 * each end. Separate from the sign-in flow's own callback: two routes, two settings.
 */
function mailboxRedirectUri(): string {
  return (
    process.env.GOOGLE_REDIRECT_URI ||
    `http://localhost:${process.env.PORT || 3000}/api/crm/mailboxes/callback`
  );
}

export function mailboxInUse(): ApiException {
  return new ApiException(
    MAILBOX_ERROR_CODES.mailboxInUse,
    'A campaign still sends from this mailbox. Disconnect it instead, or delete the campaign first.',
    HttpStatus.CONFLICT,
  );
}

export function mailboxForbidden(detail?: string): ApiException {
  return new ApiException(
    MAILBOX_ERROR_CODES.mailboxForbidden,
    detail || 'You do not have permission to modify this mailbox.',
    HttpStatus.FORBIDDEN,
  );
}

