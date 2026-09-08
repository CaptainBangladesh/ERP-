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
export class LinkedInNetworkAdapter implements ISocialNetworkAdapter {
  private readonly logger = new Logger(LinkedInNetworkAdapter.name);
  private readonly baseUrl = 'https://api.linkedin.com/rest';

  supports(platform: SocialPlatform): boolean {
    return platform === 'linkedin';
  }

  async publishPost(params: PublishPostParams): Promise<PublishPostResult> {
    const { account, content, platformConfig } = params;

    const authorUrn = account.platformAccountId.startsWith('urn:li:')
      ? account.platformAccountId
      : `urn:li:organization:${account.platformAccountId}`;

    const body: Record<string, unknown> = {
      author: authorUrn,
      commentary: content,
      visibility: 'PUBLIC',
      distribution: {
        feedDistribution: 'MAIN_FEED',
        targetEntities: [],
        thirdPartyDistributionChannels: [],
      },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
    };

    if (platformConfig?.documentUrn && typeof platformConfig.documentUrn === 'string') {
      body.content = {
        media: {
          title: (platformConfig.documentTitle as string) || 'Document',
          id: platformConfig.documentUrn,
        },
      };
    }

    const res = await fetch(`${this.baseUrl}/posts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${account.accessToken}`,
        'LinkedIn-Version': '202401',
        'X-Restli-Protocol-Version': '2.0.0',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errorText = await res.text();
      this.logger.error(`LinkedIn publish failed: ${errorText}`);
      throw new Error(`LinkedIn publish failed: ${errorText}`);
    }

    const postUrn = res.headers.get('x-restli-id') ?? `urn:li:share:${Date.now()}`;

    return {
      externalPostId: postUrn,
      postUrl: `https://www.linkedin.com/feed/update/${postUrn}`,
      rawResponse: { urn: postUrn },
    };
  }

  async getMetrics(params: GetMetricsParams): Promise<PostMetrics> {
    const { account, externalPostId } = params;

    try {
      const authorUrn = account.platformAccountId.startsWith('urn:li:')
        ? account.platformAccountId
        : `urn:li:organization:${account.platformAccountId}`;

      const res = await fetch(
        `${this.baseUrl}/organizationalEntityShareStatistics?q=organizationalEntity&organizationalEntity=${encodeURIComponent(
          authorUrn,
        )}&shares=List(${encodeURIComponent(externalPostId)})`,
        {
          headers: {
            Authorization: `Bearer ${account.accessToken}`,
            'LinkedIn-Version': '202401',
            'X-Restli-Protocol-Version': '2.0.0',
          },
        },
      );

      if (!res.ok) return {};

      const data = (await res.json()) as any;
      const stats = data.elements?.[0]?.totalShareStatistics;

      return {
        impressions: stats?.impressionCount ?? 0,
        clicks: stats?.clickCount ?? 0,
        likes: stats?.likeCount ?? 0,
        comments: stats?.commentCount ?? 0,
        shares: stats?.shareCount ?? 0,
        engagementRate: stats?.engagement ?? 0,
        rawMetrics: data,
      };
    } catch {
      return {};
    }
  }

  /**
   * LinkedIn's API exposes no public follower metrics for an organization the caller does not
   * administer, so this network has no numbers — and says so (15a). The alternative is
   * scraping a company page, which is settled as closed.
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
