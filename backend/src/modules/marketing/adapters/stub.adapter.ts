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
import { SocialRateLimitError } from './social-adapter.interface';

/** Networks whose official API exposes public profile metrics (15a). */
const PROFILE_METRIC_NETWORKS: ReadonlySet<SocialPlatform> = new Set<SocialPlatform>([
  'instagram',
  'facebook',
  'x',
]);

export interface RecordedPublishedPost {
  platform: SocialPlatform;
  platformAccountId: string;
  accountName: string;
  content: string;
  mediaUrls?: string[];
  platformConfig?: Record<string, unknown>;
  externalPostId: string;
  publishedAt: Date;
}

@Injectable()
export class StubSocialNetworkAdapter implements ISocialNetworkAdapter {
  private readonly logger = new Logger(StubSocialNetworkAdapter.name);

  readonly publishedPosts: RecordedPublishedPost[] = [];
  /** Every competitor handle this sandbox was asked about, for the metering assertions. */
  readonly profileReads: Array<{ platform: SocialPlatform; handle: string }> = [];
  private failNextPlatform?: SocialPlatform;
  private failNextError?: string;
  private rateLimitNextPlatform?: SocialPlatform;
  private rateLimitRetryAfter?: number;

  static readonly SIMULATED_ERROR_CONTENT = 'simulate_publish_error';

  supports(_platform: SocialPlatform): boolean {
    return true; // Supports all platforms in test / sandbox
  }

  /**
   * The sandbox's answer to "does this network publish public profile metrics?" (15a).
   *
   * The same set the read below uses, so the honest empty state the UI renders and the
   * `undefined` the read returns cannot say different things.
   */
  supportsProfileMetrics(platform: SocialPlatform): boolean {
    return PROFILE_METRIC_NETWORKS.has(platform);
  }

  setFailNext(platform?: SocialPlatform, error = 'Network publishing rejected by third-party API.'): void {
    this.failNextPlatform = platform;
    this.failNextError = error;
  }

  /** Makes the next profile read on this platform answer `429`, as a throttled vendor does. */
  rateLimitNext(platform: SocialPlatform, retryAfterSeconds?: number): void {
    this.rateLimitNextPlatform = platform;
    this.rateLimitRetryAfter = retryAfterSeconds;
  }

  reset(): void {
    this.publishedPosts.length = 0;
    this.profileReads.length = 0;
    this.failNextPlatform = undefined;
    this.failNextError = undefined;
    this.rateLimitNextPlatform = undefined;
    this.rateLimitRetryAfter = undefined;
  }

  async publishPost(params: PublishPostParams): Promise<PublishPostResult> {
    const { account, content, mediaUrls, platformConfig } = params;

    if (
      content.includes(StubSocialNetworkAdapter.SIMULATED_ERROR_CONTENT) ||
      (this.failNextPlatform && this.failNextPlatform === account.platform)
    ) {
      const error = this.failNextError ?? 'Simulated social network publishing error';
      this.failNextPlatform = undefined;
      this.failNextError = undefined;
      this.logger.warn(`StubSocialNetworkAdapter: rejecting post on ${account.platform}: ${error}`);
      throw new Error(error);
    }

    const externalPostId = `stub_${account.platform}_post_${this.publishedPosts.length + 1}`;
    const postUrl = `https://${account.platform}.example.com/posts/${externalPostId}`;

    const record: RecordedPublishedPost = {
      platform: account.platform,
      platformAccountId: account.platformAccountId,
      accountName: account.accountName,
      content,
      mediaUrls,
      platformConfig,
      externalPostId,
      publishedAt: new Date(),
    };

    this.publishedPosts.push(record);
    this.logger.log(`StubSocialNetworkAdapter: published to ${account.platform} as ${externalPostId}`);

    return {
      externalPostId,
      postUrl,
      rawResponse: { stub: true, id: externalPostId, timestamp: record.publishedAt.toISOString() },
    };
  }

  /**
   * The sandbox's answer for a competitor handle.
   *
   * `undefined` for a network with no public profile endpoint, so the "not supported on this
   * network" empty state (15a) is exercised by the same code path production takes rather than
   * by a branch that only the UI knows about.
   */
  async fetchPublicProfileMetrics(
    params: PublicProfileParams,
  ): Promise<PublicProfileMetrics | undefined> {
    if (this.rateLimitNextPlatform === params.account.platform) {
      const retryAfter = this.rateLimitRetryAfter;
      this.rateLimitNextPlatform = undefined;
      this.rateLimitRetryAfter = undefined;
      throw new SocialRateLimitError(params.account.platform, retryAfter);
    }

    if (this.failNextPlatform && this.failNextPlatform === params.account.platform) {
      const error = this.failNextError ?? 'Simulated public profile read error';
      this.failNextPlatform = undefined;
      this.failNextError = undefined;
      throw new Error(error);
    }

    if (!PROFILE_METRIC_NETWORKS.has(params.account.platform)) return undefined;

    this.profileReads.push({ platform: params.account.platform, handle: params.handle });

    // Deterministic from the handle, so a test can assert a number without asserting a fixture.
    const seed = [...params.handle].reduce((total, char) => total + char.charCodeAt(0), 0);
    return {
      followerCount: 1000 + (seed % 9000),
      postCount: 10 + (seed % 400),
      engagementRate: Number(((seed % 700) / 10000).toFixed(4)),
    };
  }

  async getMetrics(params: GetMetricsParams): Promise<PostMetrics> {
    const { account, externalPostId } = params;

    return {
      impressions: 500,
      reach: 420,
      likes: 35,
      comments: 7,
      shares: 3,
      clicks: 18,
      engagementRate: 0.09,
      rawMetrics: {
        stub: true,
        platform: account.platform,
        postId: externalPostId,
      },
    };
  }
}
