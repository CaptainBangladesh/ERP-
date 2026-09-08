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

@Injectable()
export class TikTokNetworkAdapter implements ISocialNetworkAdapter {
  private readonly logger = new Logger(TikTokNetworkAdapter.name);
  private readonly baseUrl = 'https://open.tiktokapis.com/v2';

  supports(platform: SocialPlatform): boolean {
    return platform === 'tiktok';
  }

  async publishPost(params: PublishPostParams): Promise<PublishPostResult> {
    const { account, content, mediaUrls, platformConfig } = params;

    const mediaUrl = mediaUrls && mediaUrls.length > 0 ? mediaUrls[0] : null;
    const isPhoto = platformConfig?.mediaType === 'PHOTO' || (mediaUrl && (mediaUrl.endsWith('.jpg') || mediaUrl.endsWith('.png')));

    const endpoint = isPhoto
      ? `${this.baseUrl}/post/publish/content/init/`
      : `${this.baseUrl}/post/publish/video/init/`;

    const body: Record<string, unknown> = {
      post_info: {
        title: content.slice(0, 2200),
        privacy_level: (platformConfig?.privacyLevel as string) || 'PUBLIC_TO_EVERYONE',
        disable_duet: Boolean(platformConfig?.disableDuet),
        disable_stitch: Boolean(platformConfig?.disableStitch),
        disable_comment: Boolean(platformConfig?.disableComment),
        auto_add_music: platformConfig?.autoAddMusic ?? true,
      },
      source_info: isPhoto
        ? {
            source: 'PULL_FROM_URL',
            photo_cover_index: 1,
            photo_images: mediaUrls ?? [mediaUrl ?? 'https://example.com/placeholder.jpg'],
          }
        : {
            source: 'PULL_FROM_URL',
            video_url: mediaUrl ?? 'https://example.com/placeholder.mp4',
          },
    };

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${account.accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errorText = await res.text();
      this.logger.error(`TikTok publish failed: ${errorText}`);
      throw new Error(`TikTok publish failed: ${errorText}`);
    }

    const data = (await res.json()) as { data?: { publish_id?: string } };
    const publishId = data.data?.publish_id ?? `tt_pub_${Date.now()}`;

    return {
      externalPostId: publishId,
      postUrl: `https://www.tiktok.com/@${account.accountName}/video/${publishId}`,
      rawResponse: data,
    };
  }

  async getMetrics(params: GetMetricsParams): Promise<PostMetrics> {
    const { account, externalPostId } = params;

    try {
      const res = await fetch(`${this.baseUrl}/video/query/`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${account.accessToken}`,
          'Content-Type': 'application/json; charset=UTF-8',
        },
        body: JSON.stringify({
          filters: {
            video_ids: [externalPostId],
          },
          fields: ['like_count', 'comment_count', 'share_count', 'view_count'],
        }),
      });

      if (!res.ok) return {};

      const json = (await res.json()) as any;
      const video = json.data?.videos?.[0];

      return {
        likes: video?.like_count ?? 0,
        comments: video?.comment_count ?? 0,
        shares: video?.share_count ?? 0,
        views: video?.view_count ?? 0,
        impressions: video?.view_count ?? 0,
        rawMetrics: json,
      };
    } catch {
      return {};
    }
  }

  /**
   * TikTok's Display API answers only for the authorized user's own account, so a competitor
   * handle has no supported read here (15a). An honest empty state, not a scraper behind a flag.
   */
  /** No endpoint on this network answers for a handle the caller does not administer (15a). */
  supportsProfileMetrics(_platform: SocialPlatform): boolean {
    return false;
  }

  async fetchPublicProfileMetrics(
    _params: PublicProfileParams,
  ): Promise<PublicProfileMetrics | undefined> {
    return undefined;
  }

}
