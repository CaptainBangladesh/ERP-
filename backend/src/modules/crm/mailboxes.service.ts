import { HttpStatus, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import {
  MAILBOX_ERROR_CODES,
  type ConnectMailboxUrlResponse,
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
import { encryptSmtpPassword } from '../../platform/secrets';
import { MailboxSender, type SendingMailbox } from './mailbox-sender';

@Injectable()
export class MailboxesService {
  constructor(
    @InjectPrisma() private readonly prisma: ScopedPrisma,
    private readonly tenancy: Tenancy,
    private readonly oauth: MailboxOAuth,
    private readonly sender: MailboxSender,
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

  async listMailboxes(userId: string): Promise<MailboxConnectionSummary[]> {
    const rows = await this.prisma.mailboxConnection.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r: any) => describeMailbox(r));
  }

  async requireMailbox(id: string): Promise<MailboxConnectionSummary> {
    const row = await this.prisma.mailboxConnection.findUnique({
      where: { id },
    });
    if (!row) throw mailboxNotFound();
    return describeMailbox(row);
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

    // Found through the scoped client, which applies the company itself — so re-adding a
    // company mailbox updates this user's own, and can never reach into another company's.
    const existing = await this.prisma.mailboxConnection.findFirst({
      where: { userId: actor.userId, provider: 'smtp' },
    });

    const connection = existing
      ? await this.prisma.mailboxConnection.update({
          where: { id: existing.id },
          data: { ...settings, connectedAt: new Date() },
        })
      : await this.prisma.mailboxConnection.create({
          data: companyApplied({ userId: actor.userId, provider: 'smtp', ...settings }),
        });

    return describeMailbox(connection);
  }

  /**
   * The mailbox as the thing that sends, credentials and all.
   *
   * Kept apart from `requireMailbox`, which answers the summary a screen may see. Nothing
   * that renders gets the token or the password; only the sender asks for this.
   */
  async sendingMailbox(id: string): Promise<SendingMailbox> {
    const row = await this.prisma.mailboxConnection.findUnique({ where: { id } });
    if (!row) throw mailboxNotFound();

    return row as SendingMailbox;
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
  async removeMailbox(id: string): Promise<void> {
    const row = await this.prisma.mailboxConnection.findUnique({ where: { id } });
    if (!row) throw mailboxNotFound();

    const campaigns = await this.prisma.campaign.count({
      where: { mailboxConnectionId: id },
    });
    if (campaigns > 0) throw mailboxInUse();

    await this.prisma.mailboxConnection.delete({ where: { id } });
  }

  async disconnectMailbox(id: string): Promise<MailboxConnectionSummary> {
    const row = await this.prisma.mailboxConnection.findUnique({
      where: { id },
    });
    if (!row) throw mailboxNotFound();

    const updated = await this.prisma.mailboxConnection.update({
      where: { id },
      data: { status: 'revoked' },
    });

    return describeMailbox(updated);
  }
}

export function describeMailbox(row: {
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
}): MailboxConnectionSummary {
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

/** A mailbox a campaign still sends from. Disconnect it, or delete the campaign first. */
export function mailboxInUse(): ApiException {
  return new ApiException(
    MAILBOX_ERROR_CODES.mailboxInUse,
    'A campaign still sends from this mailbox. Disconnect it instead, or delete the campaign first.',
    HttpStatus.CONFLICT,
  );
}
