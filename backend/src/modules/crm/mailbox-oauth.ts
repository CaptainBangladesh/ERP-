import { HttpStatus, Injectable } from '@nestjs/common';
import { MAILBOX_ERROR_CODES, type MailboxProvider } from '@erp/shared';
import { ApiException } from '../../http/api-exception';

/**
 * Who a mailbox belongs to, as the provider itself reports it, plus the tokens that let this
 * system send as them.
 *
 * Every field comes from the provider. None of it is supplied by the caller or defaulted,
 * which is the point: a connection row says "this mailbox is connected and this is whose it
 * is", and that claim is only true if a provider made it.
 */
export interface MailboxIdentity {
  emailAddress: string;
  displayName: string;
  accessToken: string;
  refreshToken?: string;
  /** When the access token stops working, so it can be refreshed before a send fails. */
  expiresAt?: Date;
}

/**
 * The one way this system turns an OAuth code into a mailbox it may send from.
 *
 * An abstract class as the injection token and the contract at once, the same shape as
 * `Mailer` and `SessionAuthority`. Two implementations are bound, and which one is chosen
 * is decided in `crm.module.ts` by whether this is the test suite — not by whether the
 * provider happens to be configured.
 *
 * That distinction is the whole reason this seam exists. The exchange used to be inline, with
 * a fallback that invented `gmail_user@example.com` whenever Google could not be reached, and
 * wrote it as a connected mailbox. Nothing downstream could tell that from a real connection:
 * the screen showed a mailbox the user had never authorised, and a send against it would fail
 * far from the cause. A failure to establish who owns a mailbox is not a mailbox.
 */
export abstract class MailboxOAuth {
  abstract exchange(
    provider: MailboxProvider,
    code: string,
    redirectUri: string,
  ): Promise<MailboxIdentity>;
}

/**
 * The real exchange, against Google.
 *
 * Throws on every path that does not end with the provider naming the account. There is no
 * branch here that produces an identity out of anything but a provider's answer.
 */
@Injectable()
export class GoogleMailboxOAuth extends MailboxOAuth {
  async exchange(
    provider: MailboxProvider,
    code: string,
    redirectUri: string,
  ): Promise<MailboxIdentity> {
    // Outlook has no implementation yet. Saying so is better than the mock connection that
    // used to stand in for it, which looked like a working Outlook mailbox on the screen.
    if (provider !== 'gmail') throw mailboxProviderUnavailable(provider);

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw mailboxProviderUnavailable(provider);

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    }).catch(() => undefined);

    if (!tokenResponse?.ok) throw mailboxAuthFailed();

    const tokens = (await tokenResponse.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
    if (!tokens.access_token) throw mailboxAuthFailed();

    const profileResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    }).catch(() => undefined);

    if (!profileResponse?.ok) throw mailboxAuthFailed();

    const profile = (await profileResponse.json()) as { email?: string; name?: string };
    if (!profile.email) throw mailboxAuthFailed();

    return {
      emailAddress: profile.email,
      displayName: profile.name || profile.email.split('@')[0]!,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: tokens.expires_in
        ? new Date(Date.now() + tokens.expires_in * 1000)
        : undefined,
    };
  }
}

/**
 * The exchange under test, where there is no Google to reach.
 *
 * Bound only when `NODE_ENV` is `test` — deliberately not when credentials are missing, which
 * is the case the old fallback covered and the case that made a developer's screen show a
 * mailbox nobody had connected. A developer with no credentials gets a refusal, the same as
 * production.
 *
 * It records what it was asked to exchange, the way `DevMailer` records what it was asked to
 * send, so a test can assert the code and redirect URI actually reached it.
 */
@Injectable()
export class StubMailboxOAuth extends MailboxOAuth {
  readonly exchanged: { provider: MailboxProvider; code: string; redirectUri: string }[] = [];

  /** Codes the stub treats as a provider that refused, so refusal is testable too. */
  static readonly REFUSED_CODE = 'refused_by_provider';

  async exchange(
    provider: MailboxProvider,
    code: string,
    redirectUri: string,
  ): Promise<MailboxIdentity> {
    this.exchanged.push({ provider, code, redirectUri });

    if (code === StubMailboxOAuth.REFUSED_CODE) throw mailboxAuthFailed();

    return {
      emailAddress: `${provider}.user@example.test`,
      displayName: `${provider} user`,
      accessToken: `test_access_${code}`,
      refreshToken: `test_refresh_${code}`,
      expiresAt: new Date(Date.now() + 3_600_000),
    };
  }
}

/** No credentials, or a provider nothing here can talk to yet. An operator's problem. */
export function mailboxProviderUnavailable(provider: string): ApiException {
  return new ApiException(
    MAILBOX_ERROR_CODES.providerUnavailable,
    `Connecting a ${provider} mailbox is not available on this server.`,
    HttpStatus.SERVICE_UNAVAILABLE,
  );
}

/** The provider would not say whose mailbox this is, so there is no connection to record. */
export function mailboxAuthFailed(): ApiException {
  return new ApiException(
    MAILBOX_ERROR_CODES.connectionFailed,
    'The mailbox provider did not confirm the account. Nothing was connected — try again.',
    HttpStatus.BAD_GATEWAY,
  );
}
