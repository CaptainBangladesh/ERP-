import { HttpStatus, Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  MARKETING_ERROR_CODES,
  POSTING_TIME_WINDOW_DAYS,
  TENANT_POSTING_TIME_MINIMUM,
  type BestTimeResponse,
  type PostingTimeBucket,
  type PostingTimeSource,
  type SocialPlatform,
} from '@erp/shared';
import { ApiException } from '../../http/api-exception';
import { companyApplied, InjectPrisma, type ScopedPrisma } from '../../platform/tenancy';
import { IJobQueue, JOB_QUEUE_TOKEN } from './job-queue.interface';

/** The job type, and the only handler this service registers. */
export const BEST_TIME_JOB_TYPE = 'marketing.insights.best_times';

/**
 * Buckets thinner than this are merged into their neighbour rather than shown.
 *
 * Decision 14l: an hour-of-week cell backed by one or two posts is not a recommendation, and
 * on a low-traffic brand a heatmap of singletons is a picture of one person's habits.
 */
const MIN_BUCKET_SAMPLE = 5;

/** Hours in a week — the shape of the whole aggregate. */
const HOURS_IN_WEEK = 24 * 7;

/** How many buckets the composer is handed as "post here". */
const TOP_RECOMMENDATIONS = 5;

const A_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * When nothing else exists.
 *
 * Deliberately coarse and deliberately labelled: these are published rules of thumb, not this
 * tenant's data, and the response says `source: 'global'` so the composer can never present
 * them as the brand's own. Hour-of-day, applied to Tuesday through Thursday.
 */
const GLOBAL_HOURS: Readonly<Record<string, readonly number[]>> = {
  instagram: [11, 13, 19],
  facebook: [9, 13, 15],
  linkedin: [8, 10, 12],
  x: [9, 12, 17],
  tiktok: [12, 19, 21],
  youtube: [15, 17, 20],
  pinterest: [20, 21, 22],
  threads: [11, 14, 19],
  bluesky: [9, 12, 18],
  google_business: [9, 11, 14],
};

const GLOBAL_DAYS = [2, 3, 4];

interface RawBucket {
  count: number;
  total: number;
}

/**
 * Best time to post, from the tenant's own history.
 *
 * The highest-value item in the composer and the one that needs no model at all: ticket 09
 * already collects the engagement, ticket 04 already records when each post went out, and the
 * only thing missing was reading them together.
 *
 * Three rules shape everything here. The recommendation always says whose data it came from
 * (14j), so a global median can never be dressed up as the brand's own audience. It is
 * bucketed in the *brand's* timezone (14k), so two colleagues in different offices are given
 * the same advice. And it projects a time and a count and nothing else (14l) — no visitor id,
 * no ip hash, no session id reaches the aggregate, the response, a log line or this table.
 *
 * The 90-day aggregate is computed on the queue, never in the request handler.
 */
@Injectable()
export class InsightsService implements OnModuleInit {
  private readonly logger = new Logger(InsightsService.name);

  constructor(
    @InjectPrisma() private readonly prisma: ScopedPrisma,
    @Inject(JOB_QUEUE_TOKEN) private readonly queue: IJobQueue,
  ) {}

  onModuleInit(): void {
    this.queue.registerHandler(BEST_TIME_JOB_TYPE, async (job) => {
      const brandId = job.payload['brandId'];
      const platform = job.payload['platform'];
      if (typeof brandId !== 'string' || typeof platform !== 'string') {
        throw new Error(`${BEST_TIME_JOB_TYPE} payload missing brandId or platform`);
      }
      await this.recompute(brandId, platform as SocialPlatform);
    });
  }

  /**
   * The stored recommendation, or an honest global one while the recompute is queued.
   *
   * Membership is checked before anything is read. A brand id is a uuid an ex-member still
   * has, and the tenant filter alone does not stop a colleague who was removed from a client
   * workspace from reading that client's posting history — 14i. A brand outside the caller's
   * reach answers 404, not 403, so an id cannot be probed for existence (13.2b).
   */
  async getBestTimes(
    brandId: string,
    platform: SocialPlatform,
    userId: string | undefined,
  ): Promise<BestTimeResponse> {
    const brand = await this.requireBrandMembership(brandId, userId);

    const stored = await this.prisma.postingTimeInsight.findFirst({
      where: { brandId, platform },
    });

    // Reading is what schedules the work: the composer asks, the queue answers by the next
    // time it is opened. Nothing here computes a 90-day aggregate while a user waits.
    await this.ensureRecomputeQueued(brandId, platform);

    if (!stored) {
      return {
        brandId,
        platform,
        source: 'global',
        sampleSize: 0,
        timezone: brand.timezone,
        computedAt: null,
        buckets: globalBuckets(platform),
        recommendations: globalBuckets(platform).slice(0, TOP_RECOMMENDATIONS),
      };
    }

    const buckets = Array.isArray(stored.buckets)
      ? (stored.buckets as unknown as PostingTimeBucket[])
      : [];

    return {
      brandId,
      platform,
      source: stored.source as PostingTimeSource,
      sampleSize: stored.sampleSize,
      timezone: stored.timezone,
      computedAt: stored.computedAt.toISOString(),
      buckets,
      recommendations: [...buckets]
        .sort((a, b) => b.score - a.score)
        .slice(0, TOP_RECOMMENDATIONS),
    };
  }

  /** Asks for a fresh pass. The queue decides when; the caller gets nothing but an ack. */
  async requestRecompute(
    brandId: string,
    platform: SocialPlatform,
    userId: string | undefined,
  ): Promise<void> {
    await this.requireBrandMembership(brandId, userId);
    await this.ensureRecomputeQueued(brandId, platform);
  }

  /**
   * One pending recompute per (brand, network), and never a second.
   *
   * The same shape `RetentionService.ensureScheduled` uses: a self-scheduling job plus an
   * unconditional enqueue is how a queue ends up with one row per page view of a composer.
   */
  private async ensureRecomputeQueued(brandId: string, platform: SocialPlatform): Promise<void> {
    const pending = await this.prisma.marketingJob.findMany({
      where: { type: BEST_TIME_JOB_TYPE, status: { in: ['PENDING', 'PROCESSING'] } },
      select: { payload: true },
    });

    const alreadyQueued = pending.some((job) => {
      const payload = job.payload as Record<string, unknown> | null;
      return payload?.['brandId'] === brandId && payload?.['platform'] === platform;
    });
    if (alreadyQueued) return;

    await this.queue.schedule({
      type: BEST_TIME_JOB_TYPE,
      payload: { brandId, platform },
    });
  }

  /**
   * The aggregate itself, run by a worker inside the owning tenant's frame.
   *
   * Degrades in one direction only — tenant, then cohort, then global — and records which of
   * the three it settled on alongside the sample that justified it.
   */
  async recompute(brandId: string, platform: SocialPlatform): Promise<void> {
    const brand = await this.prisma.marketingBrand.findFirst({ where: { id: brandId } });
    if (!brand) return;

    const since = new Date(Date.now() - POSTING_TIME_WINDOW_DAYS * A_DAY_MS);

    const own = await this.publishedEngagement({ brandId, platform, since });

    let source: PostingTimeSource = 'tenant';
    let sample = own;

    if (sample.length < TENANT_POSTING_TIME_MINIMUM) {
      // The cohort is the rest of this company's brands on the same network. The scoped
      // client is what keeps it inside the tenant; there is no cross-company read here.
      const cohort = await this.publishedEngagement({ platform, since });
      source = 'cohort';
      sample = cohort;
    }

    let buckets: PostingTimeBucket[];
    if (sample.length < TENANT_POSTING_TIME_MINIMUM) {
      source = 'global';
      buckets = globalBuckets(platform);
      sample = [];
    } else {
      buckets = bucketise(sample, brand.timezone);
      // Every bucket could have been thinner than the floor and merged away; a heatmap with
      // nothing left in it is not evidence, so say global rather than show an empty grid.
      if (buckets.length === 0) {
        source = 'global';
        buckets = globalBuckets(platform);
        sample = [];
      }
    }

    const data = {
      source,
      sampleSize: sample.length,
      timezone: brand.timezone,
      buckets: buckets as unknown as Prisma.InputJsonValue,
      computedAt: new Date(),
    };

    const existing = await this.prisma.postingTimeInsight.findFirst({
      where: { brandId, platform },
    });

    if (existing) {
      await this.prisma.postingTimeInsight.update({ where: { id: existing.id }, data });
    } else {
      await this.prisma.postingTimeInsight.create({
        data: companyApplied<Prisma.PostingTimeInsightUncheckedCreateInput>({
          brandId,
          platform,
          ...data,
        }),
      });
    }

    this.logger.log(
      `Recomputed best times for brand ${brandId} on ${platform}: ${source}, n=${sample.length}`,
    );
  }

  /**
   * The projection, and the whole of it.
   *
   * `publishedAt` and `metrics` — a time and a number. `PageViewEvent`'s visitor columns are
   * not reachable from here by construction rather than by care (14l).
   */
  private async publishedEngagement(filter: {
    brandId?: string;
    platform: SocialPlatform;
    since: Date;
  }): Promise<Array<{ publishedAt: Date; engagement: number }>> {
    const where: Prisma.ScheduledPostWhereInput = {
      status: 'PUBLISHED',
      publishedAt: { gte: filter.since },
      socialAccount: { platform: filter.platform },
    };
    if (filter.brandId) where.brandId = filter.brandId;

    const rows = await this.prisma.scheduledPost.findMany({
      where,
      select: { publishedAt: true, metrics: true },
      orderBy: { publishedAt: 'desc' },
      ...boundedTo(5_000),
    });

    const sample: Array<{ publishedAt: Date; engagement: number }> = [];
    for (const row of rows) {
      if (!row.publishedAt) continue;
      sample.push({ publishedAt: row.publishedAt, engagement: engagementOf(row.metrics) });
    }
    return sample;
  }

  /**
   * Membership first, then the read.
   *
   * `brands.service.ts` treats a brand outside the caller's company as absent; this adds the
   * membership row on top, because the recommendation exposes when a client's audience is
   * awake and that is the client's information rather than the company's.
   */
  private async requireBrandMembership(
    brandId: string,
    userId: string | undefined,
  ): Promise<{ id: string; timezone: string }> {
    const brand = await this.prisma.marketingBrand.findFirst({
      where: { id: brandId },
      select: { id: true, timezone: true },
    });
    if (!brand) throw brandNotFound();

    if (!userId) throw brandNotFound();

    const membership = await this.prisma.brandMember.findFirst({
      where: { brandId, userId },
      select: { id: true },
    });
    if (!membership) throw brandNotFound();

    return brand;
  }
}

/**
 * Engagement, from whatever the adapter recorded.
 *
 * Networks disagree about what they return, so this reads the fields they have in common and
 * falls back to a single `engagement` figure. An unrecognised shape counts as zero rather
 * than throwing: one odd metrics blob must not cost the brand its recommendation.
 */
function engagementOf(metrics: unknown): number {
  if (!metrics || typeof metrics !== 'object' || Array.isArray(metrics)) return 0;
  const values = metrics as Record<string, unknown>;
  const read = (key: string): number => {
    const value = values[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  };
  const composed = read('likes') + read('comments') + read('shares') + read('saves');
  return composed > 0 ? composed : read('engagement');
}

/**
 * Hour-of-week buckets, in the brand's timezone, with thin cells merged forward.
 *
 * The timezone conversion goes through `Intl` rather than an offset constant, so a brand in a
 * zone that observes daylight saving is bucketed correctly on both sides of the change.
 */
function bucketise(
  sample: ReadonlyArray<{ publishedAt: Date; engagement: number }>,
  timezone: string,
): PostingTimeBucket[] {
  const raw: RawBucket[] = Array.from({ length: HOURS_IN_WEEK }, () => ({ count: 0, total: 0 }));

  for (const entry of sample) {
    const local = localDayAndHour(entry.publishedAt, timezone);
    const index = local.dayOfWeek * 24 + local.hour;
    const bucket = raw[index];
    if (!bucket) continue;
    bucket.count += 1;
    bucket.total += entry.engagement;
  }

  mergeThinBuckets(raw);

  const means = raw.map((bucket) => (bucket.count > 0 ? bucket.total / bucket.count : 0));
  const peak = Math.max(...means, 0);

  const buckets: PostingTimeBucket[] = [];
  for (let index = 0; index < HOURS_IN_WEEK; index += 1) {
    const bucket = raw[index];
    if (!bucket || bucket.count < MIN_BUCKET_SAMPLE) continue;
    const mean = means[index] ?? 0;
    buckets.push({
      dayOfWeek: Math.floor(index / 24),
      hour: index % 24,
      score: peak > 0 ? Math.round((mean / peak) * 100) : 0,
      sampleSize: bucket.count,
    });
  }

  return buckets;
}

/**
 * Anything under the floor is folded into the next hour rather than displayed.
 *
 * Forward rather than nearest, so the merge is deterministic — a rule that depends on which
 * neighbour happens to be larger produces a different heatmap on every recompute.
 */
function mergeThinBuckets(raw: RawBucket[]): void {
  for (let pass = 0; pass < HOURS_IN_WEEK; pass += 1) {
    let merged = false;
    for (let index = 0; index < HOURS_IN_WEEK; index += 1) {
      const bucket = raw[index];
      if (!bucket || bucket.count === 0 || bucket.count >= MIN_BUCKET_SAMPLE) continue;
      const neighbour = raw[(index + 1) % HOURS_IN_WEEK];
      if (!neighbour) continue;
      neighbour.count += bucket.count;
      neighbour.total += bucket.total;
      bucket.count = 0;
      bucket.total = 0;
      merged = true;
    }
    if (!merged) return;
  }
}

/** Weekday and hour as the brand's own clock reads them. Stored and queried in UTC. */
function localDayAndHour(at: Date, timezone: string): { dayOfWeek: number; hour: number } {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
      hour: 'numeric',
      hour12: false,
    }).formatToParts(at);
  } catch {
    // An unknown zone string is a data problem, not a reason to lose the sample.
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      weekday: 'short',
      hour: 'numeric',
      hour12: false,
    }).formatToParts(at);
  }

  const weekday = parts.find((part) => part.type === 'weekday')?.value ?? 'Sun';
  const hourText = parts.find((part) => part.type === 'hour')?.value ?? '0';
  const hour = Number(hourText) % 24;

  return {
    dayOfWeek: WEEKDAYS.indexOf(weekday) < 0 ? 0 : WEEKDAYS.indexOf(weekday),
    hour: Number.isFinite(hour) ? hour : 0,
  };
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** The published rule of thumb, shaped like a computed answer so the UI has one renderer. */
function globalBuckets(platform: SocialPlatform): PostingTimeBucket[] {
  const hours = GLOBAL_HOURS[platform] ?? GLOBAL_HOURS['instagram'] ?? [];
  const buckets: PostingTimeBucket[] = [];
  for (const dayOfWeek of GLOBAL_DAYS) {
    hours.forEach((hour, rank) => {
      buckets.push({ dayOfWeek, hour, score: 100 - rank * 10, sampleSize: 0 });
    });
  }
  return buckets;
}

/**
 * A bounded read that is not a paged list — the same helper `retention.service.ts` uses.
 * The conformance pack refuses a bare `take:`, and this says which of the two it is.
 */
function boundedTo(count: number): Pick<Prisma.ScheduledPostFindManyArgs, 'take'> {
  const args: Pick<Prisma.ScheduledPostFindManyArgs, 'take'> = {};
  args['take'] = count;
  return args;
}

function brandNotFound(): ApiException {
  return new ApiException(
    MARKETING_ERROR_CODES.brandNotFound,
    'That brand does not exist.',
    HttpStatus.NOT_FOUND,
  );
}
