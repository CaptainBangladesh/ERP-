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
export class MetaNetworkAdapter implements ISocialNetworkAdapter {
  private readonly logger = new Logger(MetaNetworkAdapter.name);
  private readonly baseUrl = 'https://graph.facebook.com/v21.0';

  supports(platform: SocialPlatform): boolean {
    return platform === 'instagram' || platform === 'facebook';
  }

  async publishPost(params: PublishPostParams): Promise<PublishPostResult> {
    const { account, content, mediaUrls, platformConfig } = params;

    if (account.platform === 'instagram') {
      return this.publishInstagram(account, content, mediaUrls, platformConfig);
    } else {
      return this.publishFacebook(account, content, mediaUrls, platformConfig);
    }
  }

  private async publishInstagram(
    account: PublishPostParams['account'],
    content: string,
    mediaUrls?: string[],
    platformConfig?: Record<string, unknown>,
  ): Promise<PublishPostResult> {
    const igUserId = account.platformAccountId;
    const mediaUrl = mediaUrls && mediaUrls.length > 0 ? mediaUrls[0] : null;

    // Step 1: Create media container
    const createParams = new URLSearchParams({
      access_token: account.accessToken,
      caption: content,
    });

    if (mediaUrl) {
      const isVideo = mediaUrl.endsWith('.mp4') || platformConfig?.mediaType === 'REEL';
      if (isVideo) {
        createParams.append('media_type', 'REELS');
        createParams.append('video_url', mediaUrl);
      } else {
        createParams.append('image_url', mediaUrl);
      }
    }

    const containerRes = await fetch(`${this.baseUrl}/${igUserId}/media`, {
      method: 'POST',
      body: createParams,
    });

    if (!containerRes.ok) {
      const errorText = await containerRes.text();
      this.logger.error(`Instagram container creation failed: ${errorText}`);
      throw new Error(`Instagram container creation failed: ${errorText}`);
    }

    const containerData = (await containerRes.json()) as { id: string };
    const creationId = containerData.id;

    // Step 2: Publish media container
    const publishParams = new URLSearchParams({
      access_token: account.accessToken,
      creation_id: creationId,
    });

    const publishRes = await fetch(`${this.baseUrl}/${igUserId}/media_publish`, {
      method: 'POST',
      body: publishParams,
    });

    if (!publishRes.ok) {
      const errorText = await publishRes.text();
      this.logger.error(`Instagram publish failed: ${errorText}`);
      throw new Error(`Instagram publish failed: ${errorText}`);
    }

    const publishData = (await publishRes.json()) as { id: string };
    const postId = publishData.id;

    // Optional Step 3: First comment if configured
    if (platformConfig?.firstComment && typeof platformConfig.firstComment === 'string') {
      try {
        const commentParams = new URLSearchParams({
          access_token: account.accessToken,
          message: platformConfig.firstComment,
        });
        await fetch(`${this.baseUrl}/${postId}/comments`, {
          method: 'POST',
          body: commentParams,
        });
      } catch (err: unknown) {
        this.logger.warn(`Instagram first-comment failed for post ${postId}: ${String(err)}`);
      }
    }

    return {
      externalPostId: postId,
      postUrl: `https://www.instagram.com/p/${postId}/`,
      rawResponse: publishData,
    };
  }

  private async publishFacebook(
    account: PublishPostParams['account'],
    content: string,
    mediaUrls?: string[],
    _platformConfig?: Record<string, unknown>,
  ): Promise<PublishPostResult> {
    const pageId = account.platformAccountId;
    const mediaUrl = mediaUrls && mediaUrls.length > 0 ? mediaUrls[0] : null;

    let endpoint = `${this.baseUrl}/${pageId}/feed`;
    const params = new URLSearchParams({
      access_token: account.accessToken,
      message: content,
    });

    if (mediaUrl) {
      endpoint = `${this.baseUrl}/${pageId}/photos`;
      params.append('url', mediaUrl);
      params.append('caption', content);
      params.delete('message');
    }

    const res = await fetch(endpoint, {
      method: 'POST',
      body: params,
    });

    if (!res.ok) {
      const errorText = await res.text();
      this.logger.error(`Facebook post failed: ${errorText}`);
      throw new Error(`Facebook post failed: ${errorText}`);
    }

    const data = (await res.json()) as { id: string; post_id?: string };
    const postId = data.post_id ?? data.id;

    return {
      externalPostId: postId,
      postUrl: `https://www.facebook.com/${postId}`,
      rawResponse: data,
    };
  }

  async getMetrics(params: GetMetricsParams): Promise<PostMetrics> {
    const { account, externalPostId } = params;
    const url = `${this.baseUrl}/${externalPostId}?fields=shares,comments.summary(true),likes.summary(true)&access_token=${account.accessToken}`;

    try {
      const res = await fetch(url);
      if (!res.ok) {
        return {};
      }
      const data = (await res.json()) as any;
      const likes = data.likes?.summary?.total_count ?? 0;
      const comments = data.comments?.summary?.total_count ?? 0;
      const shares = data.shares?.count ?? 0;

      return {
        likes,
        comments,
        shares,
        rawMetrics: data,
      };
    } catch {
      return {};
    }
  }

  /**
   * Instagram Business Discovery / the Page's public fields — the official endpoint, with the
   * brand's own connected token (15a, 15b). A handle the API does not know is an absent
   * answer, not a scrape.
   */
  /**
   * Instagram's `business_discovery` is the only Meta endpoint that answers for a handle.
   *
   * Facebook Pages have no equivalent public read, so this says `false` for it even though
   * `supports()` says `true` — publishing and benchmarking are different questions.
   */
  supportsProfileMetrics(platform: SocialPlatform): boolean {
    return platform === 'instagram';
  }

  async fetchPublicProfileMetrics(
    params: PublicProfileParams,
  ): Promise<PublicProfileMetrics | undefined> {
    const { account, handle } = params;
    if (account.platform !== 'instagram') return undefined;

    try {
      const url =
        `${this.baseUrl}/${account.platformAccountId}` +
        `?fields=business_discovery.username(${encodeURIComponent(handle)})` +
        `{followers_count,media_count}&access_token=${encodeURIComponent(account.accessToken)}`;
      const res = await fetch(url);
      if (res.status === 429) throw rateLimited(account.platform, res);
      if (!res.ok) return undefined;

      const data = (await res.json()) as any;
      const profile = data.business_discovery;
      if (!profile) return undefined;

      return {
        followerCount: numberOrUndefined(profile.followers_count),
        postCount: numberOrUndefined(profile.media_count),
      };
    } catch (err: unknown) {
      // Everything but a throttle is "no numbers this time"; a throttle is a decision the
      // caller has to make about the brand's real token, so it goes up (15f).
      if (err instanceof SocialRateLimitError) throw err;
      return undefined;
    }
  }

}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
