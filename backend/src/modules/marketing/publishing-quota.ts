import type { SocialPlatform } from '@erp/shared';

/**
 * What a platform's publishing quota is, and how much of it has been spent.
 *
 * One helper because there were two, and they disagreed. `SocialPublisherService` enforced a
 * limit and `SocialAccountsService` displayed one, each counting by `createdAt` with a status
 * filter of `IN ('PUBLISHED','SCHEDULED')` — which is wrong in both directions at once. Bulk
 * schedule sixty posts for next month and today is blocked having published nothing; schedule
 * fifty last week that fire this morning and Meta's real 50/24h limit is blown with no guard at
 * all. The number in the UI was decorative because it was computed the same wrong way twice.
 *
 * A quota is spent when a post reaches the platform, so that is what gets counted: `PUBLISHED`
 * rows by `publishedAt`, plus `FAILED` rows that got as far as the network — the platform
 * counted those, whatever it then did with them. Whether an attempt reached the network is
 * *recorded* (`networkAttemptedAt`) rather than inferred from the failure message.
 */
export interface PublishingWindow {
  /**
   * Posts allowed inside the window.
   *
   * `cap` rather than `limit` because `limit:` is the platform's paging word and the conformance
   * pack refuses it in a module — see `hand-rolled-paging`.
   */
  readonly cap: number;
  readonly windowSeconds: number;
  /** What a caller is told when they exceed it. */
  readonly refusal: string;
}

/** The limits ticket 10 verified against each platform's published documentation. */
export function publishingWindowFor(platform: SocialPlatform): PublishingWindow | undefined {
  if (platform === 'instagram' || platform === 'facebook') {
    return {
      cap: 50,
      windowSeconds: 24 * 60 * 60,
      refusal:
        'Publishing rate limit exceeded: maximum 50 posts per 24 hours for Meta accounts.',
    };
  }

  if (platform === 'x') {
    return {
      cap: 100,
      windowSeconds: 15 * 60,
      refusal:
        'Publishing rate limit exceeded: maximum 100 posts per 15-minute window for X accounts.',
    };
  }

  return undefined;
}

/** Platforms with no modelled quota still report a status, so the UI has one shape. */
export const UNLIMITED_WINDOW: PublishingWindow = {
  cap: 1000,
  windowSeconds: 24 * 60 * 60,
  refusal: 'Publishing rate limit exceeded.',
};

interface PostCounter {
  count(args: { where: Record<string, unknown> }): Promise<number>;
}

/**
 * How many posts this account has actually put in front of the platform inside the window.
 *
 * Both the guard and the number on screen call this, so the enforced limit and the displayed
 * one cannot drift apart again.
 */
export async function countAgainstQuota(
  posts: PostCounter,
  socialAccountId: string,
  windowSeconds: number,
  now: number = Date.now(),
): Promise<number> {
  const since = new Date(now - windowSeconds * 1000);

  return posts.count({
    where: {
      socialAccountId,
      OR: [
        { status: 'PUBLISHED', publishedAt: { gte: since } },
        { status: 'FAILED', networkAttemptedAt: { gte: since } },
      ],
    },
  });
}
