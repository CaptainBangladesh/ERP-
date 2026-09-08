import type { SocialPlatform } from '@erp/shared';
import { companyApplied } from '../../platform/tenancy';

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

/**
 * The other half of the ledger: what a competitor read has taken out of this window.
 *
 * A benchmark read is not a post, so it cannot be counted from `scheduled_posts` — but it is
 * spent against the same platform limit (15b), so it has to be counted *somewhere the
 * publishing paths look*. This is that place, and `quotaSpentInWindow` below is the only
 * number any of them ask for.
 */
interface QuotaLedgerRow {
  windowStartedAt: Date;
  competitorReads: number;
}

interface LedgerStore {
  findFirst(args: {
    where: Record<string, unknown>;
    select?: Record<string, boolean>;
  }): Promise<QuotaLedgerRow | null>;
  create(args: { data: Record<string, unknown> }): Promise<unknown>;
  updateMany(args: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }): Promise<{ count: number }>;
}

/** The two tables the one ledger is spread across. Any scoped client satisfies it. */
export interface QuotaClient {
  scheduledPost: PostCounter;
  socialQuotaLedger: LedgerStore;
}

/**
 * Everything spent against this account's platform window: posts **and** benchmark reads.
 *
 * This is *the* ledger. The publish guard, the remaining-quota number on the accounts screen
 * and a snapshot's own reservation all read it, so a benchmarking poll visibly shrinks the
 * brand's 50/24h rather than drawing on a private counter of its own — which is what 15b
 * means by "the same quota ledger as publishing", and what the predecessor of this function
 * did not do.
 */
export async function quotaSpentInWindow(
  prisma: QuotaClient,
  socialAccountId: string,
  window: PublishingWindow,
  now: number = Date.now(),
): Promise<number> {
  const [published, reads] = await Promise.all([
    countAgainstQuota(prisma.scheduledPost, socialAccountId, window.windowSeconds, now),
    competitorReadsInWindow(prisma, socialAccountId, window, now),
  ]);

  return published + reads;
}

async function competitorReadsInWindow(
  prisma: QuotaClient,
  socialAccountId: string,
  window: PublishingWindow,
  now: number,
): Promise<number> {
  const row = await prisma.socialQuotaLedger.findFirst({
    where: { socialAccountId },
    select: { windowStartedAt: true, competitorReads: true },
  });
  if (!row) return 0;

  // A stale window has already expired; its reads are spent history, not current spend. The
  // row is rolled on the next reservation rather than here, because a read does not write.
  const windowStart = now - window.windowSeconds * 1000;
  return row.windowStartedAt.getTime() < windowStart ? 0 : row.competitorReads;
}

/**
 * Reserve one unit of this account's window for a competitor read, or refuse (15e).
 *
 * The refusal is a zero-rows-affected conditional update rather than a read followed by a
 * decision — that difference is the whole of 14p, and it matters more here than at a composer
 * click because this caller runs unattended. Reserving happens *before* the adapter call and
 * is reconciled to zero when the call does not happen.
 */
export async function reserveCompetitorRead(
  prisma: QuotaClient,
  socialAccountId: string,
  window: PublishingWindow,
  now: number = Date.now(),
): Promise<boolean> {
  const published = await countAgainstQuota(
    prisma.scheduledPost,
    socialAccountId,
    window.windowSeconds,
    now,
  );

  const headroom = competitorHeadroom(window, published);
  if (headroom <= 0) return false;

  await ensureLedgerRow(prisma, socialAccountId, new Date(now));

  // Roll first, so a window that has already elapsed does not count against this one.
  await prisma.socialQuotaLedger.updateMany({
    where: {
      socialAccountId,
      windowStartedAt: { lt: new Date(now - window.windowSeconds * 1000) },
    },
    data: { windowStartedAt: new Date(now), competitorReads: 0 },
  });

  const claimed = await prisma.socialQuotaLedger.updateMany({
    where: { socialAccountId, competitorReads: { lt: headroom } },
    data: { competitorReads: { increment: 1 } },
  });

  return claimed.count > 0;
}

/** Reconcile to zero: the call did not reach the network, so nothing was spent. */
export async function releaseCompetitorRead(
  prisma: QuotaClient,
  socialAccountId: string,
): Promise<void> {
  await prisma.socialQuotaLedger.updateMany({
    where: { socialAccountId, competitorReads: { gt: 0 } },
    data: { competitorReads: { decrement: 1 } },
  });
}

/**
 * The counter row, seeded **at now**.
 *
 * Seeding it a whole window in the past — which is what this did first — meant the very next
 * reservation saw `windowStartedAt < windowStart`, rolled the row, and reset the count it had
 * just taken: the first read of every window was free and invisible. The window a counter
 * starts is the moment it starts, not the moment it would have started had it existed.
 */
async function ensureLedgerRow(
  prisma: QuotaClient,
  socialAccountId: string,
  startedAt: Date,
): Promise<void> {
  const existing = await prisma.socialQuotaLedger.findFirst({
    where: { socialAccountId },
    select: { windowStartedAt: true, competitorReads: true },
  });
  if (existing) return;

  try {
    await prisma.socialQuotaLedger.create({
      data: companyApplied({
        socialAccountId,
        windowStartedAt: startedAt,
        competitorReads: 0,
      }),
    });
  } catch {
    // Two first reads of the window racing. The unique index decided; either row will do.
  }
}

/**
 * How long a vendor `429` puts this account's competitor reads to sleep (15f).
 *
 * "Back off through the publishing adapter's existing limiter" means the wait is the
 * platform's own window from `publishingWindowFor` — the number this module already holds for
 * how long a throttled token stays throttled — rather than a flat day invented at the call
 * site. A `Retry-After` the vendor actually sent wins when it asks for longer.
 */
export function rateLimitBackoffMs(
  window: PublishingWindow,
  retryAfterSeconds?: number,
): number {
  const limiterWait = window.windowSeconds * 1000;
  const vendorWait = retryAfterSeconds !== undefined ? retryAfterSeconds * 1000 : 0;
  return Math.max(limiterWait, vendorWait);
}

/**
 * The share of a window that only publishing may draw on (15e).
 *
 * Competitor benchmarking spends this same ledger, because Meta and X count a profile read
 * against the same limit as a post. But unlike a composer click, a benchmarking poll runs
 * unattended and can quietly consume the budget a scheduled post needs at 9am — so half the
 * window is fenced off, and an exhausted benchmark budget degrades to "snapshot skipped,
 * quota reserved for publishing" rather than to a failed post.
 */
export const PUBLISHING_FLOOR_RATIO = 0.5;

export function publishingFloor(window: PublishingWindow): number {
  return Math.ceil(window.cap * PUBLISHING_FLOOR_RATIO);
}

/**
 * How many competitor reads may still be reserved in this window.
 *
 * Zero is a refusal, not an error: the caller records "skipped" and tries again next window.
 */
export function competitorHeadroom(window: PublishingWindow, publishedInWindow: number): number {
  return Math.max(0, window.cap - publishingFloor(window) - publishedInWindow);
}
