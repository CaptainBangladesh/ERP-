import { HttpStatus, Injectable } from '@nestjs/common';
import { MARKETING_ERROR_CODES, type SocialPlatform } from '@erp/shared';
import { ApiException } from '../../http/api-exception';

export interface SocialOAuthResult {
  platformAccountId: string;
  accountName: string;
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number; // seconds
  metadata?: Record<string, unknown>;
}

export interface SocialOAuthRefreshResult {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number; // seconds
}

/**
 * SocialOAuth provider contract and injection token.
 *
 * Modeled after CRM's MailboxOAuth seam: an abstract class binding either LiveSocialOAuth
 * for production or StubSocialOAuth in test mode, allowing complete deterministic testing
 * of authorization redirect URLs, token exchanges, error handling, and token refresh.
 */
export abstract class SocialOAuth {
  abstract getAuthorizationUrl(
    platform: SocialPlatform,
    state: string,
    redirectUri: string,
  ): Promise<string>;

  abstract exchangeCode(
    platform: SocialPlatform,
    code: string,
    redirectUri: string,
  ): Promise<SocialOAuthResult>;

  abstract refreshToken(
    platform: SocialPlatform,
    refreshToken: string,
  ): Promise<SocialOAuthRefreshResult>;
}

@Injectable()
export class LiveSocialOAuth extends SocialOAuth {
  async getAuthorizationUrl(
    platform: SocialPlatform,
    state: string,
    redirectUri: string,
  ): Promise<string> {
    switch (platform) {
      case 'instagram':
      case 'facebook': {
        const appId = process.env.META_APP_ID;
        if (!appId) throw oauthProviderUnavailable(platform);
        const url = new URL('https://www.facebook.com/v21.0/dialog/oauth');
        url.search = new URLSearchParams({
          client_id: appId,
          redirect_uri: redirectUri,
          state,
          scope:
            'instagram_basic,instagram_business_content_publish,instagram_business_manage_messages,pages_show_list,pages_read_engagement,pages_manage_posts,pages_messaging',
          response_type: 'code',
        }).toString();
        return url.toString();
      }

      case 'linkedin': {
        const clientId = process.env.LINKEDIN_CLIENT_ID;
        if (!clientId) throw oauthProviderUnavailable(platform);
        const url = new URL('https://www.linkedin.com/oauth/v2/authorization');
        url.search = new URLSearchParams({
          response_type: 'code',
          client_id: clientId,
          redirect_uri: redirectUri,
          state,
          scope: 'openid profile w_member_social w_organization_social',
        }).toString();
        return url.toString();
      }

      case 'x': {
        const clientId = process.env.X_CLIENT_ID;
        if (!clientId) throw oauthProviderUnavailable(platform);
        const url = new URL('https://twitter.com/i/oauth2/authorize');
        url.search = new URLSearchParams({
          response_type: 'code',
          client_id: clientId,
          redirect_uri: redirectUri,
          scope: 'tweet.read tweet.write users.read offline.access dm.read dm.write',
          state,
          code_challenge: 'challenge',
          code_challenge_method: 'plain',
        }).toString();
        return url.toString();
      }

      case 'youtube':
      case 'google_business': {
        const clientId = process.env.GOOGLE_CLIENT_ID;
        if (!clientId) throw oauthProviderUnavailable(platform);
        const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
        const scope =
          platform === 'youtube'
            ? 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly'
            : 'https://www.googleapis.com/auth/business.manage';
        url.search = new URLSearchParams({
          client_id: clientId,
          redirect_uri: redirectUri,
          response_type: 'code',
          scope,
          access_type: 'offline',
          prompt: 'consent',
          state,
        }).toString();
        return url.toString();
      }

      case 'tiktok': {
        const clientKey = process.env.TIKTOK_CLIENT_KEY;
        if (!clientKey) throw oauthProviderUnavailable(platform);
        const url = new URL('https://www.tiktok.com/v2/auth/authorize/');
        url.search = new URLSearchParams({
          client_key: clientKey,
          scope: 'user.info.basic,video.upload,video.publish',
          response_type: 'code',
          redirect_uri: redirectUri,
          state,
        }).toString();
        return url.toString();
      }

      case 'pinterest': {
        const clientId = process.env.PINTEREST_APP_ID;
        if (!clientId) throw oauthProviderUnavailable(platform);
        const url = new URL('https://www.pinterest.com/oauth/');
        url.search = new URLSearchParams({
          client_id: clientId,
          redirect_uri: redirectUri,
          response_type: 'code',
          scope: 'boards:read,pins:read,pins:write',
          state,
        }).toString();
        return url.toString();
      }

      case 'threads': {
        const appId = process.env.THREADS_APP_ID || process.env.META_APP_ID;
        if (!appId) throw oauthProviderUnavailable(platform);
        const url = new URL('https://threads.net/oauth/authorize');
        url.search = new URLSearchParams({
          client_id: appId,
          redirect_uri: redirectUri,
          scope: 'threads_basic,threads_content_publish',
          response_type: 'code',
          state,
        }).toString();
        return url.toString();
      }

      case 'bluesky': {
        return `https://bsky.app/oauth/authorize?state=${encodeURIComponent(state)}&redirect_uri=${encodeURIComponent(redirectUri)}`;
      }

      default:
        throw oauthProviderUnavailable(platform);
    }
  }

  async exchangeCode(
    platform: SocialPlatform,
    code: string,
    redirectUri: string,
  ): Promise<SocialOAuthResult> {
    // In production, each provider has its specific token endpoint exchange
    throw oauthProviderUnavailable(platform);
  }

  async refreshToken(
    platform: SocialPlatform,
    refreshToken: string,
  ): Promise<SocialOAuthRefreshResult> {
    throw oauthProviderUnavailable(platform);
  }
}

@Injectable()
export class StubSocialOAuth extends SocialOAuth {
  readonly exchangedCodes: { platform: SocialPlatform; code: string; redirectUri: string }[] = [];
  readonly refreshedTokens: { platform: SocialPlatform; refreshToken: string }[] = [];

  static readonly REFUSED_CODE = 'refused_by_provider';

  async getAuthorizationUrl(
    platform: SocialPlatform,
    state: string,
    redirectUri: string,
  ): Promise<string> {
    return `https://oauth.stub.${platform}.test/authorize?client_id=stub_${platform}&state=${encodeURIComponent(
      state,
    )}&redirect_uri=${encodeURIComponent(redirectUri)}`;
  }

  async exchangeCode(
    platform: SocialPlatform,
    code: string,
    redirectUri: string,
  ): Promise<SocialOAuthResult> {
    this.exchangedCodes.push({ platform, code, redirectUri });

    if (code === StubSocialOAuth.REFUSED_CODE) {
      throw new ApiException(
        MARKETING_ERROR_CODES.oauthFailed,
        'The social platform refused authorization.',
        HttpStatus.BAD_GATEWAY,
      );
    }

    return {
      platformAccountId: `stub_${platform}_acc_${code}`,
      accountName: `${platform.toUpperCase()} Test Page`,
      accessToken: `stub_access_${platform}_${code}`,
      refreshToken: `stub_refresh_${platform}_${code}`,
      expiresIn: 3600 * 24 * 60, // 60 days
      metadata: {
        handle: `@test_${platform}`,
        profilePictureUrl: `https://cdn.example.com/${platform}/avatar.png`,
        followersCount: 1250,
      },
    };
  }

  async refreshToken(
    platform: SocialPlatform,
    refreshToken: string,
  ): Promise<SocialOAuthRefreshResult> {
    this.refreshedTokens.push({ platform, refreshToken });

    if (refreshToken === StubSocialOAuth.REFUSED_CODE) {
      throw new ApiException(
        MARKETING_ERROR_CODES.tokenRefreshFailed,
        'The social platform refused to refresh the OAuth token.',
        HttpStatus.BAD_GATEWAY,
      );
    }

    return {
      accessToken: `refreshed_access_${Date.now()}`,
      refreshToken: `refreshed_refresh_${Date.now()}`,
      expiresIn: 3600 * 24 * 90, // 90 days
    };
  }
}

function oauthProviderUnavailable(platform: string): ApiException {
  return new ApiException(
    MARKETING_ERROR_CODES.oauthProviderUnavailable,
    `Connecting a ${platform} account via OAuth is not configured on this server.`,
    HttpStatus.SERVICE_UNAVAILABLE,
  );
}
