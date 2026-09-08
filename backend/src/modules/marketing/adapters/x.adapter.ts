import { Injectable, Logger } from '@nestjs/common';
import type { SocialPlatform } from '@erp/shared';
import type {
  GetMetricsParams,
  ISocialNetworkAdapter,
  PostMetrics,
  PublishPostParams,
  PublishPostResult,
  PublicProfileMetrics,
  PublicProfileParams,
} from './social-adapter.interface';
import { rateLimited, SocialRateLimitError } from './social-adapter.interface';

@Injectable()
export class XNetworkAdapter implements ISocialNetworkAdapter {
  private readonly logger = new Logger(XNetworkAdapter.name);
  private readonly baseUrl = 'https://api.twitter.com/2';

  supports(platform: SocialPlatform): boolean {
    return platform === 'x';
  }

  async publishPost(params: PublishPostParams): Promise<PublishPostResult> {
    const { account, content, platformConfig } = params;

    const body: Record<string, unknown> = {
      text: content,
    };

    if (platformConfig?.mediaIds && Array.isArray(platformConfig.mediaIds) && platformConfig.mediaIds.length > 0) {
      body.media = {
        media_ids: platformConfig.mediaIds,
      };
    }

    const res = await fetch(`${this.baseUrl}/tweets`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${account.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errorText = await res.text();
      this.logger.error(`X tweet creation failed: ${errorText}`);
      throw new Error(`X tweet creation failed: ${errorText}`);
    }

    const json = (await res.json()) as { data: { id: string; text: string } };
    const tweetId = json.data.id;

    return {
      externalPostId: tweetId,
      postUrl: `https://x.com/i/status/${tweetId}`,
      rawResponse: json,
    };
  }

  async getMetrics(params: GetMetricsParams): Promise<PostMetrics> {
    const { account, externalPostId } = params;

    try {
      const res = await fetch(
        `${this.baseUrl}/tweets/${externalPostId}?tweet.fields=public_metrics,organic_metrics`,
        {
          headers: {
            Authorization: `Bearer ${account.accessToken}`,
          },
        },
      );

      if (!res.ok) return {};

      const json = (await res.json()) as any;
      const metrics = json.data?.public_metrics;

      return {
        likes: metrics?.like_count ?? 0,
        comments: metrics?.reply_count ?? 0,
        shares: (metrics?.retweet_count ?? 0) + (metrics?.quote_count ?? 0),
        impressions: metrics?.impression_count ?? 0,
        rawMetrics: json,
      };
    } catch {
      return {};
    }
  }

  /** X's `users/by/username` public metrics, read with the brand's own token (15a, 15b). */
  supportsProfileMetrics(platform: SocialPlatform): boolean {
    return platform === 'x';
  }

  async fetchPublicProfileMetrics(
    params: PublicProfileParams,
  ): Promise<PublicProfileMetrics | undefined> {
    const { account, handle } = params;

    try {
      const res = await fetch(
        `${this.baseUrl}/users/by/username/${encodeURIComponent(handle)}?user.fields=public_metrics`,
        { headers: { Authorization: `Bearer ${account.accessToken}` } },
      );
      if (res.status === 429) throw rateLimited(account.platform, res);
      if (!res.ok) return undefined;

      const json = (await res.json()) as any;
      const metrics = json.data?.public_metrics;
      if (!metrics) return undefined;

      return {
        followerCount: numberOrUndefined(metrics.followers_count),
        postCount: numberOrUndefined(metrics.tweet_count),
      };
    } catch (err: unknown) {
      if (err instanceof SocialRateLimitError) throw err;
      return undefined;
    }
  }

}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
