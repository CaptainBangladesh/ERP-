import { createHmac, timingSafeEqual } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  MARKETING_ERROR_CODES,
  type ExpiringAccountsResponse,
  type RefreshTokenResponse,
  type SocialAccountListResponse,
  type SocialAccountResponse,
  type SocialAccountStatus,
  type SocialAccountSummary,
  type SocialPlatform,
  type SocialRateLimitStatus,
} from '@erp/shared';
import { ApiException } from '../../http/api-exception';
import { countAgainstQuota, publishingWindowFor, UNLIMITED_WINDOW } from './publishing-quota';
import { listQuery } from '../../platform/list';
import { companyApplied, InjectPrisma, type ScopedPrisma } from '../../platform/tenancy';
import type { Valid } from '../../platform/validation';
import { CryptoService } from './crypto.service';
import {
  ConnectSocialAccountBody,
  OAuthAuthorizeBody,
  OAuthCallbackBody,
  SOCIAL_ACCOUNT_LIST,
} from './schemas';
import { SocialOAuth } from './social-oauth';
import { MARKETING_SECRET_VARS, marketingSecret } from './vault-secrets';

export interface DecryptedAccountCredentials {
  id: string;
  brandId: string;
  platform: SocialPlatform;
  accountName: string;
  platformAccountId: string;
  accessToken: string;
  refreshToken?: string;
  tokenExpiresAt: Date | null;
  status: SocialAccountStatus;
}

@Injectable()
export class SocialAccountsService {
  constructor(
    @InjectPrisma() private readonly prisma: ScopedPrisma,
    private readonly crypto: CryptoService,
    private readonly socialOAuth: SocialOAuth,
  ) {}

  /**
   * Initiates an OAuth 2.0 authorization redirect flow with a tamper-proof state parameter.
   */
  async initiateOAuthFlow(
    brandId: string,
    input: Valid<typeof OAuthAuthorizeBody>,
  ): Promise<{ authorizationUrl: string; state: string }> {
    const brand = await this.prisma.marketingBrand.findFirst({ where: { id: brandId } });
    if (!brand) throw brandNotFound();

    const statePayload = JSON.stringify({
      brandId,
      platform: input.platform,
      nonce: Math.random().toString(36).substring(2, 15),
      timestamp: Date.now(),
    });

    const signature = this.signState(statePayload);
    const state = Buffer.from(JSON.stringify({ payload: statePayload, sig: signature })).toString(
      'base64url',
    );

    const authorizationUrl = await this.socialOAuth.getAuthorizationUrl(
      input.platform,
      state,
      input.redirectUri,
    );

    return { authorizationUrl, state };
  }

  /**
   * Exchanges an OAuth callback authorization code for platform access/refresh tokens,
   * encrypts credentials at rest, and stores the connected SocialAccount.
   */
  async handleOAuthCallback(
    input: Valid<typeof OAuthCallbackBody>,
  ): Promise<SocialAccountResponse> {
    const parsedState = this.verifyState(input.state);
    const { brandId, platform } = parsedState;

    const brand = await this.prisma.marketingBrand.findFirst({ where: { id: brandId } });
    if (!brand) throw brandNotFound();

    const exchangeResult = await this.socialOAuth.exchangeCode(
      platform,
      input.code,
      input.redirectUri,
    );

    const encryptedAccessToken = this.crypto.encrypt(exchangeResult.accessToken);
    const encryptedRefreshToken = exchangeResult.refreshToken
      ? this.crypto.encrypt(exchangeResult.refreshToken)
      : null;

    const tokenExpiresAt = exchangeResult.expiresIn
      ? new Date(Date.now() + exchangeResult.expiresIn * 1000)
      : null;

    const existing = await this.prisma.socialAccount.findFirst({
      where: {
        brandId,
        platform,
        platformAccountId: exchangeResult.platformAccountId,
      },
    });

    let savedAccount;
    if (existing) {
      savedAccount = await this.prisma.socialAccount.update({
        where: { id: existing.id },
        data: {
          accountName: exchangeResult.accountName,
          encryptedAccessToken,
          encryptedRefreshToken,
          tokenExpiresAt,
          status: 'active',
          metadata: (exchangeResult.metadata as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        },
      });
    } else {
      savedAccount = await this.prisma.socialAccount.create({
        data: companyApplied<Prisma.SocialAccountUncheckedCreateInput>({
          brandId,
          platform,
          accountName: exchangeResult.accountName,
          platformAccountId: exchangeResult.platformAccountId,
          encryptedAccessToken,
          encryptedRefreshToken,
          tokenExpiresAt,
          status: 'active',
          metadata: (exchangeResult.metadata as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        }),
      });
    }

    return this.describeAccount(savedAccount);
  }

  /**
   * Directly connects a social account with given credentials (for testing, sandbox, or manual tokens).
   */
  async connectAccount(
    brandId: string,
    input: Valid<typeof ConnectSocialAccountBody>,
  ): Promise<SocialAccountResponse> {
    const brand = await this.prisma.marketingBrand.findFirst({ where: { id: brandId } });
    if (!brand) throw brandNotFound();

    const encryptedAccessToken = this.crypto.encrypt(input.accessToken);
    const encryptedRefreshToken = input.refreshToken
      ? this.crypto.encrypt(input.refreshToken)
      : null;

    const tokenExpiresAt = input.expiresIn
      ? new Date(Date.now() + input.expiresIn * 1000)
      : null;

    const existing = await this.prisma.socialAccount.findFirst({
      where: {
        brandId,
        platform: input.platform,
        platformAccountId: input.platformAccountId,
      },
    });

    let account;
    if (existing) {
      account = await this.prisma.socialAccount.update({
        where: { id: existing.id },
        data: {
          accountName: input.accountName,
          encryptedAccessToken,
          encryptedRefreshToken,
          tokenExpiresAt,
          status: 'active',
          metadata: input.metadata ? (input.metadata as Prisma.InputJsonValue) : Prisma.JsonNull,
        },
      });
    } else {
      account = await this.prisma.socialAccount.create({
        data: companyApplied<Prisma.SocialAccountUncheckedCreateInput>({
          brandId,
          platform: input.platform,
          accountName: input.accountName,
          platformAccountId: input.platformAccountId,
          encryptedAccessToken,
          encryptedRefreshToken,
          tokenExpiresAt,
          status: 'active',
          metadata: input.metadata ? (input.metadata as Prisma.InputJsonValue) : Prisma.JsonNull,
        }),
      });
    }

    return this.describeAccount(account);
  }

  /**
   * Lists connected accounts for a brand with safe masked secrets.
   */
  async listAccounts(
    brandId: string,
    query: Record<string, unknown> = {},
  ): Promise<SocialAccountListResponse> {
    const slice = listQuery(query, SOCIAL_ACCOUNT_LIST);

    const where: Prisma.SocialAccountWhereInput = { brandId };

    const [rows, total] = await Promise.all([
      this.prisma.socialAccount.findMany({
        ...slice.findMany<Prisma.SocialAccountFindManyArgs>(),
        where: { ...slice.findMany<Prisma.SocialAccountFindManyArgs>().where, ...where },
      }),
      this.prisma.socialAccount.count({
        where: { ...slice.count<Prisma.SocialAccountCountArgs>().where, ...where },
      }),
    ]);

    return slice.respond(rows.map((r) => this.describeAccount(r)), total);
  }

  /**
   * Retrieves single connected account details with safe masked token.
   */
  async getAccount(id: string): Promise<SocialAccountResponse> {
    const account = await this.prisma.socialAccount.findFirst({ where: { id } });
    if (!account) throw accountNotFound();

    return this.describeAccount(account);
  }

  /**
   * Internal method for backend publishing tasks (Ticket 04):
   * Decrypts and returns raw OAuth tokens in memory. Never exposed over HTTP.
   */
  async getDecryptedTokens(id: string): Promise<DecryptedAccountCredentials> {
    const account = await this.prisma.socialAccount.findFirst({ where: { id } });
    if (!account) throw accountNotFound();

    const accessToken = this.crypto.decrypt(account.encryptedAccessToken);
    const refreshToken = account.encryptedRefreshToken
      ? this.crypto.decrypt(account.encryptedRefreshToken)
      : undefined;

    return {
      id: account.id,
      brandId: account.brandId,
      platform: account.platform as SocialPlatform,
      accountName: account.accountName,
      platformAccountId: account.platformAccountId,
      accessToken,
      refreshToken,
      tokenExpiresAt: account.tokenExpiresAt ? new Date(account.tokenExpiresAt) : null,
      status: account.status as SocialAccountStatus,
    };
  }

  /**
   * Refreshes an expired or expiring OAuth token using its stored encrypted refresh token.
   */
  async refreshToken(id: string): Promise<RefreshTokenResponse> {
    const account = await this.prisma.socialAccount.findFirst({ where: { id } });
    if (!account) throw accountNotFound();

    if (!account.encryptedRefreshToken) {
      throw new ApiException(
        MARKETING_ERROR_CODES.tokenRefreshFailed,
        'This connected account has no refresh token. Re-authorization via OAuth is required.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const decryptedRefreshToken = this.crypto.decrypt(account.encryptedRefreshToken);

    const refreshResult = await this.socialOAuth.refreshToken(
      account.platform as SocialPlatform,
      decryptedRefreshToken,
    );

    const newEncryptedAccessToken = this.crypto.encrypt(refreshResult.accessToken);
    const newEncryptedRefreshToken = refreshResult.refreshToken
      ? this.crypto.encrypt(refreshResult.refreshToken)
      : account.encryptedRefreshToken;

    const tokenExpiresAt = refreshResult.expiresIn
      ? new Date(Date.now() + refreshResult.expiresIn * 1000)
      : account.tokenExpiresAt;

    const updated = await this.prisma.socialAccount.update({
      where: { id },
      data: {
        encryptedAccessToken: newEncryptedAccessToken,
        encryptedRefreshToken: newEncryptedRefreshToken,
        tokenExpiresAt,
        status: 'active',
      },
    });

    return {
      refreshed: true,
      account: this.describeAccount(updated),
    };
  }

  /**
   * Scans connected accounts for tokens expiring within thresholdDays (e.g. 7 days).
   * Updates account status to 'expiring' or 'expired'.
   */
  async checkExpiringAccounts(
    brandId?: string,
    thresholdDays = 7,
  ): Promise<ExpiringAccountsResponse> {
    const now = new Date();
    const thresholdDate = new Date(now.getTime() + thresholdDays * 24 * 60 * 60 * 1000);

    const accounts = await this.prisma.socialAccount.findMany({
      where: {
        ...(brandId ? { brandId } : {}),
        status: { not: 'disconnected' },
        tokenExpiresAt: { not: null },
      },
    });

    const expiring: SocialAccountSummary[] = [];

    for (const account of accounts) {
      if (!account.tokenExpiresAt) continue;
      const expiresAt = new Date(account.tokenExpiresAt);

      if (expiresAt <= now) {
        if (account.status !== 'expired') {
          await this.prisma.socialAccount.update({
            where: { id: account.id },
            data: { status: 'expired' },
          });
          account.status = 'expired';
        }
        expiring.push(this.describeAccount(account));
      } else if (expiresAt <= thresholdDate) {
        if (account.status !== 'expiring') {
          await this.prisma.socialAccount.update({
            where: { id: account.id },
            data: { status: 'expiring' },
          });
          account.status = 'expiring';
        }
        expiring.push(this.describeAccount(account));
      }
    }

    return {
      thresholdDays,
      accounts: expiring,
    };
  }

  /**
   * Disconnects a social account.
   */
  async disconnectAccount(id: string): Promise<void> {
    const account = await this.prisma.socialAccount.findFirst({ where: { id } });
    if (!account) throw accountNotFound();

    await this.prisma.socialAccount.update({
      where: { id },
      data: { status: 'disconnected' },
    });
  }

  /**
   * The one place a stored social account becomes a DTO.
   *
   * Public because `brands.service` renders the same accounts on `GET /brands/:id` and used to
   * build its own copy of this object — including its own mask, which read the ciphertext
   * column directly. Two mappings meant one of them could be fixed and the other missed, and
   * that is exactly what happened. There is one now.
   */
  describeAccount(
    row: {
      id: string;
      brandId: string;
      platform: string;
      accountName: string;
      platformAccountId: string;
      encryptedAccessToken: string;
      encryptedRefreshToken: string | null;
      tokenExpiresAt: Date | null;
      status: string;
      metadata: unknown;
      createdAt: Date;
      updatedAt: Date;
    },
  ): SocialAccountSummary {
    const now = new Date();
    const expiresAt = row.tokenExpiresAt ? new Date(row.tokenExpiresAt) : null;
    const isTokenExpired = expiresAt ? expiresAt.getTime() <= now.getTime() : false;
    const daysUntilExpiration = expiresAt
      ? Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
      : null;

    return {
      id: row.id,
      brandId: row.brandId,
      platform: row.platform as SocialPlatform,
      accountName: row.accountName,
      platformAccountId: row.platformAccountId,
      maskedAccessToken: this.maskStoredToken(row.encryptedAccessToken),
      hasRefreshToken: Boolean(row.encryptedRefreshToken),
      tokenExpiresAt: expiresAt ? expiresAt.toISOString() : null,
      isTokenExpired,
      daysUntilExpiration,
      status: row.status as SocialAccountStatus,
      metadata: (row.metadata as Record<string, unknown>) ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /**
   * The last four characters of the *token*, never of the ciphertext.
   *
   * This used to mask `encryptedAccessToken` directly, so the UI showed four characters of a
   * GCM authentication tag: meaningless to the person reading it, and a leaked fragment of the
   * tag. Ciphertext, IVs and auth tags do not leave this service — not in a DTO, not in a log
   * line, not in an error message — so the plaintext is produced here, used for four characters,
   * and left to fall out of scope with the call frame.
   *
   * A row that cannot be decrypted still renders: a key rotation should not turn the accounts
   * list into an error page, and the mask is not the place to discover it.
   */
  private maskStoredToken(stored: string): string {
    try {
      return this.crypto.maskToken(this.crypto.decrypt(stored));
    } catch {
      return this.crypto.maskToken('');
    }
  }

  /**
   * Signs the OAuth `state` parameter.
   *
   * The secret used to fall back to `SESSION_SECRET` and then to a constant in this file, so a
   * deployment missing the variable signed state with a value anybody reading this repository
   * knows — which is the same as not signing it. `marketingSecret` refuses to boot production
   * without it and never returns a constant anywhere else. See `vault-secrets.ts`.
   */
  private signState(payload: string): string {
    return createHmac('sha256', marketingSecret(MARKETING_SECRET_VARS.oauthState))
      .update(payload)
      .digest('base64url');
  }

  private verifyState(state: string): { brandId: string; platform: SocialPlatform } {
    try {
      const decoded = Buffer.from(state, 'base64url').toString('utf8');
      const { payload, sig } = JSON.parse(decoded) as { payload: string; sig: string };

      const expectedSig = this.signState(payload);
      const valid = timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig));
      if (!valid) {
        throw new ApiException(
          MARKETING_ERROR_CODES.oauthInvalidState,
          'Invalid OAuth state token: signature mismatch.',
          HttpStatus.BAD_REQUEST,
        );
      }

      const parsed = JSON.parse(payload) as {
        brandId: string;
        platform: SocialPlatform;
        timestamp: number;
      };

      // Ensure state is not older than 15 minutes
      if (Date.now() - parsed.timestamp > 15 * 60 * 1000) {
        throw new ApiException(
          MARKETING_ERROR_CODES.oauthInvalidState,
          'OAuth state token has expired. Please try connecting again.',
          HttpStatus.BAD_REQUEST,
        );
      }

      return parsed;
    } catch (error) {
      if (error instanceof ApiException) throw error;
      throw new ApiException(
        MARKETING_ERROR_CODES.oauthInvalidState,
        'Invalid OAuth state parameter.',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  /**
   * Returns current rate limit quotas, active usage, and messaging window parameters for a social account.
   */
  async getRateLimitStatus(id: string): Promise<SocialRateLimitStatus> {
    const account = await this.prisma.socialAccount.findFirst({ where: { id } });
    if (!account) throw accountNotFound();

    const platform = account.platform as SocialPlatform;
    const now = Date.now();

    // The same helper the publisher enforces with, so the number on screen and the number that
    // refuses a post cannot say different things.
    const window = publishingWindowFor(platform) ?? UNLIMITED_WINDOW;
    const used = await countAgainstQuota(
      this.prisma.scheduledPost,
      id,
      window.windowSeconds,
      now,
    );

    const limit = window.cap;
    const windowSeconds = window.windowSeconds;

    return {
      platform,
      publishing: {
        limit,
        windowSeconds,
        used,
        remaining: Math.max(0, limit - used),
        resetAt: new Date(now + windowSeconds * 1000).toISOString(),
      },
      messaging: {
        maxInboundWindowHours: 24,
        extendedHumanAgentWindowDays: 7,
      },
    };
  }
}

function brandNotFound(): ApiException {
  return new ApiException(
    MARKETING_ERROR_CODES.brandNotFound,
    'That brand does not exist.',
    HttpStatus.NOT_FOUND,
  );
}

function accountNotFound(): ApiException {
  return new ApiException(
    MARKETING_ERROR_CODES.socialAccountNotFound,
    'That social account does not exist.',
    HttpStatus.NOT_FOUND,
  );
}
