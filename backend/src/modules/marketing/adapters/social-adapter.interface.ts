import type { SocialPlatform } from '@erp/shared';

export interface PublishPostParams {
  account: {
    platform: SocialPlatform;
    platformAccountId: string;
    accountName: string;
    accessToken: string;
  };
  content: string;
  mediaUrls?: string[];
  platformConfig?: Record<string, unknown>;
}

export interface PublishPostResult {
  externalPostId: string;
  postUrl?: string;
  rawResponse?: Record<string, unknown>;
}

export interface PostMetrics {
  impressions?: number;
  reach?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  clicks?: number;
  saved?: number;
  views?: number;
  engagementRate?: number;
  rawMetrics?: Record<string, unknown>;
}

export interface GetMetricsParams {
  account: {
    platform: SocialPlatform;
    platformAccountId: string;
    accessToken: string;
  };
  externalPostId: string;
}

/**
 * What a competitor snapshot may hold (15c).
 *
 * Aggregates and nothing else: no post bodies, no commenter names, no profile photo to mirror
 * into our storage. Competitor post content is third-party copyright and its commenters never
 * dealt with us, so a richer shape here is what would turn a metrics feature into a
 * personal-data processor — the type is the enforcement.
 */
export interface PublicProfileMetrics {
  readonly followerCount?: number;
  readonly postCount?: number;
  readonly engagementRate?: number;
}

export interface PublicProfileParams {
  /** The brand's *own* connected account, whose token authorizes the read (15b). */
  readonly account: {
    platform: SocialPlatform;
    platformAccountId: string;
    accessToken: string;
  };
  /** An identifier, never a URL (15d). Passed to the adapter's own fixed endpoint. */
  readonly handle: string;
}

/**
 * A vendor said "too many requests" (15f).
 *
 * Distinct from every other adapter failure because the answer to it is different: the token
 * being throttled belongs to the brand's real publishing account, so the next benchmark read
 * on that account waits out the platform's own window through the limiter this module already
 * owns, rather than being retried at poll cadence against a network that is refusing.
 */
export class SocialRateLimitError extends Error {
  constructor(
    readonly platform: SocialPlatform,
    /** The vendor's own `Retry-After`, in seconds, when it sent one. */
    readonly retryAfterSeconds?: number,
  ) {
    super(`${platform} refused the read: rate limited.`);
    this.name = 'SocialRateLimitError';
  }
}

/**
 * A `429` response as the error above, carrying `Retry-After` when the vendor sent a usable one.
 *
 * Written once so two adapters cannot disagree about which header they read or what an
 * unparseable value means — an absent or nonsense `Retry-After` falls back to the limiter's
 * own window rather than to a number somebody guessed.
 */
export function rateLimited(
  platform: SocialPlatform,
  response: { headers: { get(name: string): string | null } },
): SocialRateLimitError {
  const header = response.headers.get('retry-after');
  const seconds = header === null ? Number.NaN : Number(header);
  return new SocialRateLimitError(
    platform,
    Number.isFinite(seconds) && seconds > 0 ? seconds : undefined,
  );
}

/**
 * Common contract implemented by third-party social network publishing adapters.
 */
export interface ISocialNetworkAdapter {
  supports(platform: SocialPlatform): boolean;
  /**
   * Whether this network's official API exposes public profile metrics at all (15a).
   *
   * The adapter answers, not a list kept beside the UI: "not supported on this network" is a
   * claim about what the adapter implements, and a second copy of that claim drifts from it
   * the first time a network's API changes. LinkedIn answers only for organizations the caller
   * administers and TikTok's Display API only for the authorized user's own account, so both
   * say `false` here — the settled answer, not a gap waiting for a scraper.
   */
  supportsProfileMetrics(platform: SocialPlatform): boolean;
  publishPost(params: PublishPostParams): Promise<PublishPostResult>;
  getMetrics(params: GetMetricsParams): Promise<PostMetrics>;
  /**
   * Public profile aggregates for a competitor handle, through the network's official API
   * (15a). `undefined` means this network's API exposes no such metrics — which the UI shows
   * as "not supported on this network", an honest empty state. There is deliberately no
   * HTML-parsing fallback anywhere in this module: scraping was settled as closed, not
   * deferred, so a network without an endpoint simply has no numbers.
   *
   * Throws `SocialRateLimitError` when the vendor answers `429`, which is the one failure the
   * caller must not treat as a plain network error (15f).
   */
  fetchPublicProfileMetrics(params: PublicProfileParams): Promise<PublicProfileMetrics | undefined>;
}
