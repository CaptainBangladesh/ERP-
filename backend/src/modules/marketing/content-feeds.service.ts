import { HttpStatus, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import {
  FEED_EXCERPT_MAX_CHARS,
  FEED_FAILURES_BEFORE_DISABLE,
  MARKETING_ERROR_CODES,
  MAX_FEEDS_PER_BRAND,
  type ContentFeedEntryListResponse,
  type ContentFeedEntrySummary,
  type ContentFeedListResponse,
  type ContentFeedStatus,
  type ContentFeedSummary,
  type OutboundFetchReason,
} from '@erp/shared';
import { ApiException } from '../../http/api-exception';
import { listQuery } from '../../platform/list';
import { companyApplied, InjectPrisma, type ScopedPrisma, Tenancy } from '../../platform/tenancy';
import type { Valid } from '../../platform/validation';
import { parseFeed, type ParsedFeedEntry } from './feed-parser';
import { OutboundFetchService } from './outbound-fetch.service';
import { PostgresJobQueueService } from './postgres-job-queue.service';
import { CONTENT_FEED_ENTRY_LIST, CONTENT_FEED_LIST, CreateContentFeedBody, readLinkUrl } from './schemas';

/** The one job type this service registers. One poll job per feed, and never a second (16c). */
export const FEED_POLL_JOB_TYPE = 'marketing.feeds.poll';

/** How often a healthy feed is re-read. */
export const FEED_POLL_INTERVAL_MS = 30 * 60 * 1000;

/** 16f: consecutive failures raise the delay geometrically, to a ceiling of a day. */
export const FEED_BACKOFF_CEILING_MS = 24 * 60 * 60 * 1000;

/**
 * RSS ingest.
 *
 * Every rule here exists because the same three things are true of a feed: the URL is an
 * operator's, the document is a stranger's, and the poller is at-least-once.
 *
 *  - The URL is validated twice (16a) — for shape at write time, for destination on every
 *    poll through `OutboundFetchService`. Neither substitutes for the other.
 *  - Ingest is create-if-absent against a unique `(brandId, feedId, entryKey)` (16b), with
 *    `entryKey` always a sha256 of a canonical string (16g), so a re-poll, a retry after the
 *    fence rejects a stale worker, or a feed that renumbers its items cannot produce a second
 *    draft. The constraint violation *is* the success path.
 *  - Entries land as `DRAFT` (16b). Auto-publishing from a feed is out of scope, not a flag:
 *    "auto-enqueue into scheduling queues" plus at-least-once delivery is a double-publish
 *    generator, and this module has shipped that bug once already.
 *  - Titles and descriptions are stored and rendered as text (16d); an entry whose link fails
 *    `readLinkUrl` is dropped rather than stored with a broken href.
 *  - A feed that keeps failing backs off and is then disabled visibly (16f), rather than
 *    hammering somebody else's dead host at poll cadence forever.
 */
@Injectable()
export class ContentFeedsService implements OnModuleInit {
  private readonly logger = new Logger('MarketingFeeds');

  constructor(
    @InjectPrisma() private readonly prisma: ScopedPrisma,
    private readonly tenancy: Tenancy,
    private readonly queue: PostgresJobQueueService,
    private readonly outbound: OutboundFetchService,
  ) {}

  onModuleInit(): void {
    this.queue.registerHandler(FEED_POLL_JOB_TYPE, async (job) => {
      const feedId = job.payload['feedId'];
      if (typeof feedId === 'string') await this.pollFeed(feedId);
    });

    if (process.env.NODE_ENV === 'test') return;

    void this.ensureScheduled().catch((err: unknown) => {
      this.logger.error(
        `Could not schedule feed polling: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  }

  // ── The operator's side ────────────────────────────────────────────────────────

  async listFeeds(query: Record<string, unknown>): Promise<ContentFeedListResponse> {
    const slice = listQuery(query, CONTENT_FEED_LIST);

    const [rows, total] = await Promise.all([
      this.prisma.contentFeed.findMany({
        ...slice.findMany<Prisma.ContentFeedFindManyArgs>(),
        include: { _count: { select: { entries: true } } },
      }),
      this.prisma.contentFeed.count(slice.count<Prisma.ContentFeedCountArgs>()),
    ]);

    return slice.respond(rows.map(describeFeed), total);
  }

  async createFeed(input: Valid<typeof CreateContentFeedBody>): Promise<ContentFeedSummary> {
    await this.requireBrand(input.brandId);

    // 14-17.0e: a plain count check, refusing with a message rather than silently. A list of
    // operator-supplied URLs with no ceiling is a small DoS engine pointed at a third party.
    const existing = await this.prisma.contentFeed.count({ where: { brandId: input.brandId } });
    if (existing >= MAX_FEEDS_PER_BRAND) {
      throw new ApiException(
        MARKETING_ERROR_CODES.externalSourceLimitReached,
        `A brand watches at most ${MAX_FEEDS_PER_BRAND} feeds. Remove one to add another.`,
        HttpStatus.CONFLICT,
      );
    }

    const duplicate = await this.prisma.contentFeed.findFirst({
      where: { brandId: input.brandId, url: input.url },
    });
    if (duplicate) {
      throw new ApiException(
        MARKETING_ERROR_CODES.contentFeedAlreadyExists,
        'That feed is already on this brand.',
        HttpStatus.CONFLICT,
      );
    }

    const row = await this.prisma.contentFeed.create({
      data: companyApplied<Prisma.ContentFeedUncheckedCreateInput>({
        brandId: input.brandId,
        name: input.name,
        url: input.url,
        status: 'ACTIVE',
      }),
      include: { _count: { select: { entries: true } } },
    });

    await this.enqueuePoll(row.id, new Date());
    return describeFeed(row);
  }

  async deleteFeed(id: string): Promise<void> {
    const feed = await this.prisma.contentFeed.findFirst({ where: { id } });
    if (!feed) throw feedNotFound();
    await this.prisma.contentFeed.delete({ where: { id: feed.id } });
  }

  /** 16f's re-enable: the counter resets and the feed rejoins the schedule. */
  async enableFeed(id: string): Promise<ContentFeedSummary> {
    const feed = await this.prisma.contentFeed.findFirst({ where: { id } });
    if (!feed) throw feedNotFound();

    const row = await this.prisma.contentFeed.update({
      where: { id: feed.id },
      data: { status: 'ACTIVE', consecutiveFailures: 0, lastReason: null },
      include: { _count: { select: { entries: true } } },
    });

    await this.enqueuePoll(row.id, new Date());
    return describeFeed(row);
  }

  /**
   * "Poll it now" — which enqueues a job and returns. It does not fetch.
   *
   * The fetch happens on the queue, never in this request (14-17.0): a slow remote host must
   * not be able to occupy an HTTP thread, and `OutboundFetchService` refuses outright if
   * anybody forgets and calls it from here.
   */
  async requestPoll(id: string): Promise<ContentFeedSummary> {
    const feed = await this.prisma.contentFeed.findFirst({
      where: { id },
      include: { _count: { select: { entries: true } } },
    });
    if (!feed) throw feedNotFound();

    await this.enqueuePoll(feed.id, new Date());
    return describeFeed(feed);
  }

  async listEntries(query: Record<string, unknown>): Promise<ContentFeedEntryListResponse> {
    const slice = listQuery(query, CONTENT_FEED_ENTRY_LIST);

    const [rows, total] = await Promise.all([
      this.prisma.contentFeedEntry.findMany({
        ...slice.findMany<Prisma.ContentFeedEntryFindManyArgs>(),
        include: { feed: { select: { name: true } } },
      }),
      this.prisma.contentFeedEntry.count(slice.count<Prisma.ContentFeedEntryCountArgs>()),
    ]);

    return slice.respond(rows.map(describeEntry), total);
  }

  // ── The queue's side ───────────────────────────────────────────────────────────

  /**
   * One live poll job per feed (16c), following `RetentionService`'s pattern exactly.
   *
   * The check is what stops N deploys creating N pollers. The lease reaper and the `attempts`
   * fence from 12.1a/12.1b are what make a worker dying mid-ingest safe; there is no cron and
   * no `setInterval` beside the queue.
   */
  async enqueuePoll(feedId: string, scheduledAt: Date): Promise<void> {
    const live = await this.prisma.marketingJob.findFirst({
      where: {
        type: FEED_POLL_JOB_TYPE,
        status: { in: ['PENDING', 'PROCESSING'] },
        payload: { path: ['feedId'], equals: feedId },
      },
      select: { id: true },
    });
    if (live) return;

    await this.queue.schedule({ type: FEED_POLL_JOB_TYPE, payload: { feedId }, scheduledAt });
  }

  /** At boot: every active feed gets a poller if it does not already have one. */
  async ensureScheduled(): Promise<void> {
    const feeds = await this.tenancy.withoutCompanyScope(
      'marketing.feeds.enumerate_active_feeds_to_schedule_polling',
      async () =>
        this.prisma.contentFeed.findMany({
          where: { status: 'ACTIVE' },
          select: { id: true, companyId: true },
        }),
    );

    for (const feed of feeds) {
      await this.tenancy.runInCompany({ companyId: feed.companyId, grants: 'all' }, async () => {
        await this.enqueuePoll(feed.id, new Date(Date.now() + FEED_POLL_INTERVAL_MS));
      });
    }
  }

  /**
   * One poll: fetch, parse, ingest, record the outcome, schedule the next one.
   *
   * Runs inside the job's own tenant frame, so the scoped client already restricts every read
   * and write here to the company that owns the job.
   */
  async pollFeed(feedId: string): Promise<void> {
    const feed = await this.prisma.contentFeed.findFirst({ where: { id: feedId } });
    if (!feed) return;
    if (feed.status !== 'ACTIVE') return;

    const fetched = await this.outbound.fetch({
      url: feed.url,
      accept: 'application/rss+xml, application/atom+xml, application/feed+json, application/xml;q=0.9',
    });

    if (!fetched.ok) {
      await this.recordFailure(feed.id, fetched.reason);
      return;
    }

    const parsed = parseFeed(fetched.body);
    if (!parsed.ok) {
      // A document that fails to parse leaves the feed's last-success state untouched (16e).
      await this.recordFailure(feed.id, 'parse_error');
      return;
    }

    let ingested = 0;
    for (const entry of parsed.feed.entries) {
      if (await this.ingestEntry(feed.brandId, feed.id, entry)) ingested += 1;
    }

    await this.prisma.contentFeed.update({
      where: { id: feed.id },
      data: {
        lastPolledAt: new Date(),
        lastSuccessAt: new Date(),
        lastReason: null,
        consecutiveFailures: 0,
      },
    });

    this.logger.log(`Feed ${feed.id}: ${ingested} new draft(s) from ${parsed.feed.entries.length} entries`);
    await this.enqueuePoll(feed.id, new Date(Date.now() + FEED_POLL_INTERVAL_MS));
  }

  /**
   * One entry, written once (16b, 16g, 16h).
   *
   * Returns whether a row was created, which is `false` both when the entry was already here
   * and when it was dropped for a bad link — the caller only counts, it does not branch.
   */
  private async ingestEntry(
    brandId: string,
    feedId: string,
    entry: ParsedFeedEntry,
  ): Promise<boolean> {
    // Every link from a feed passes `readLinkUrl`, and an entry whose link fails is dropped
    // rather than stored with a broken — or `javascript:` — href (16d).
    const link = entry.link ? readLinkUrl(entry.link, 'link') : undefined;
    if (!link?.ok) return false;

    const enclosure = entry.enclosureUrl ? readLinkUrl(entry.enclosureUrl, 'enclosure') : undefined;

    try {
      await this.prisma.contentFeedEntry.create({
        data: companyApplied<Prisma.ContentFeedEntryUncheckedCreateInput>({
          brandId,
          feedId,
          entryKey: entryKeyFor(entry),
          title: asText(entry.title),
          excerpt: excerptOf(entry.description),
          link: link.value,
          enclosureUrl: enclosure?.ok ? enclosure.value : null,
          publishedAt: entry.publishedAt ?? null,
          status: 'DRAFT',
        }),
      });
      return true;
    } catch (err: unknown) {
      // The unique index answered: this entry is already here. That is the mechanism working,
      // not an error — a re-poll and a re-run after a fenced-out worker both land here.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return false;
      throw err;
    }
  }

  /** Backoff, then a visible disable — never a deletion of the operator's row (16f). */
  private async recordFailure(feedId: string, reason: OutboundFetchReason): Promise<void> {
    const feed = await this.prisma.contentFeed.findFirst({ where: { id: feedId } });
    if (!feed) return;

    const failures = feed.consecutiveFailures + 1;
    const disable = failures >= FEED_FAILURES_BEFORE_DISABLE;

    await this.prisma.contentFeed.update({
      where: { id: feed.id },
      data: {
        lastPolledAt: new Date(),
        // The code, and only the code (14-17.0d).
        lastReason: reason,
        consecutiveFailures: failures,
        ...(disable ? { status: 'DISABLED' } : {}),
      },
    });

    this.logger.warn(`Feed ${feed.id} failed (${reason}), consecutive failures: ${failures}`);

    if (disable) return; // A disabled feed stops being scheduled until a human re-enables it.

    const delay = Math.min(
      FEED_POLL_INTERVAL_MS * 2 ** failures,
      FEED_BACKOFF_CEILING_MS,
    );
    await this.enqueuePoll(feed.id, new Date(Date.now() + delay));
  }

  private async requireBrand(brandId: string): Promise<void> {
    const brand = await this.prisma.marketingBrand.findFirst({ where: { id: brandId } });
    if (!brand) {
      throw new ApiException(
        MARKETING_ERROR_CODES.brandNotFound,
        'That brand does not exist.',
        HttpStatus.NOT_FOUND,
      );
    }
  }
}

/**
 * 16g: always a hash, so the column is a fixed 64 characters and the identity is stable.
 *
 * A `<guid>` is a value an arbitrary publisher controls, unbounded in length, and free to
 * differ by a trailing space or a Unicode normalisation form between polls — which is a
 * duplicate draft or a failed index write depending on which. The `g`/`l` prefix keeps the two
 * derivations from colliding.
 */
export function entryKeyFor(entry: ParsedFeedEntry): string {
  const canonical = entry.guid
    ? `g\n${normalise(entry.guid)}`
    : `l\n${normalise(entry.link ?? '')}\n${normalise(entry.title)}`;
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

function normalise(value: string): string {
  return value.trim().normalize('NFC');
}

/**
 * Feed text on the way into the database (16d).
 *
 * Control characters and bidirectional overrides removed, exactly as model output is treated
 * (14s) and for the same reason: this is a stranger's string heading for a rendering path.
 * Markup is *not* removed — it is not interpreted anywhere, so a title containing `<script>`
 * is stored as those characters and rendered as those characters.
 */
function asText(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[\u202A-\u202E\u2066-\u2069]/g, '')
    .replace(/\r\n?/g, '\n')
    .trim();
}

/** An excerpt, not a reproduction (16h). */
function excerptOf(value: string): string {
  const text = asText(value);
  return text.length > FEED_EXCERPT_MAX_CHARS
    ? `${text.slice(0, FEED_EXCERPT_MAX_CHARS).trimEnd()}…`
    : text;
}

function describeFeed(row: {
  id: string;
  brandId: string;
  name: string;
  url: string;
  status: string;
  lastPolledAt: Date | null;
  lastSuccessAt: Date | null;
  lastReason: string | null;
  consecutiveFailures: number;
  createdAt: Date;
  updatedAt: Date;
  _count?: { entries: number };
}): ContentFeedSummary {
  return {
    id: row.id,
    brandId: row.brandId,
    name: row.name,
    url: row.url,
    status: row.status as ContentFeedStatus,
    ...(row.lastPolledAt ? { lastPolledAt: row.lastPolledAt.toISOString() } : {}),
    ...(row.lastSuccessAt ? { lastSuccessAt: row.lastSuccessAt.toISOString() } : {}),
    ...(row.lastReason ? { lastReason: row.lastReason as OutboundFetchReason } : {}),
    consecutiveFailures: row.consecutiveFailures,
    entryCount: row._count?.entries ?? 0,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function describeEntry(row: {
  id: string;
  brandId: string;
  feedId: string;
  title: string;
  excerpt: string;
  link: string;
  enclosureUrl: string | null;
  publishedAt: Date | null;
  fetchedAt: Date;
  feed?: { name: string };
}): ContentFeedEntrySummary {
  return {
    id: row.id,
    brandId: row.brandId,
    feedId: row.feedId,
    feedName: row.feed?.name ?? '',
    title: row.title,
    excerpt: row.excerpt,
    link: row.link,
    ...(row.enclosureUrl ? { enclosureUrl: row.enclosureUrl } : {}),
    ...(row.publishedAt ? { publishedAt: row.publishedAt.toISOString() } : {}),
    fetchedAt: row.fetchedAt.toISOString(),
    status: 'DRAFT',
  };
}

function feedNotFound(): ApiException {
  return new ApiException(
    MARKETING_ERROR_CODES.contentFeedNotFound,
    'That feed does not exist.',
    HttpStatus.NOT_FOUND,
  );
}
