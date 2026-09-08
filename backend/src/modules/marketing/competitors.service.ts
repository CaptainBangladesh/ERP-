import { HttpStatus, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  MARKETING_ERROR_CODES,
  MAX_COMPETITORS_PER_BRAND,
  type CompetitorListResponse,
  type CompetitorSnapshotListResponse,
  type CompetitorSnapshotSummary,
  type CompetitorSummary,
  type SocialPlatform,
} from '@erp/shared';
import { ApiException } from '../../http/api-exception';
import { listQuery } from '../../platform/list';
import { companyApplied, InjectPrisma, type ScopedPrisma, Tenancy } from '../../platform/tenancy';
import type { Valid } from '../../platform/validation';
import { SocialAdapterResolver } from './adapters/social-adapter.resolver';
import { SocialRateLimitError } from './adapters/social-adapter.interface';
import type { PublicProfileMetrics } from './adapters/social-adapter.interface';
import { boundedRead } from './bounded-read';
import { CryptoService } from './crypto.service';
import { PostgresJobQueueService } from './postgres-job-queue.service';
import {
  UNLIMITED_WINDOW,
  publishingWindowFor,
  rateLimitBackoffMs,
  releaseCompetitorRead,
  reserveCompetitorRead,
  type PublishingWindow,
} from './publishing-quota';
import {
  enqueueOnePerRow,
  registerRowPoller,
  requireBrand,
  SCHEDULER_SELECT,
  scheduleEveryRow,
  type RowJobPolicy,
} from './row-pollers';
import { COMPETITOR_LIST, COMPETITOR_SNAPSHOT_LIST, CreateCompetitorBody } from './schemas';

/** One snapshot job per competitor, on the queue that already exists (15f, 16c's pattern). */
export const COMPETITOR_SNAPSHOT_JOB_TYPE = 'marketing.competitors.snapshot';

const SNAPSHOT_POLICY: RowJobPolicy = {
  type: COMPETITOR_SNAPSHOT_JOB_TYPE,
  key: 'competitorId',
};

const A_DAY_MS = 24 * 60 * 60 * 1000;

/** Why a snapshot did not happen. An outcome the operator reads, not an exception. */
export type SnapshotOutcome =
  | 'captured'
  | 'already_captured_today'
  | 'unsupported_network'
  | 'no_connected_account'
  | 'quota_reserved_for_publishing'
  | 'rate_limited'
  | 'network_error';

/**
 * Competitor benchmarking, through official APIs only (15a).
 *
 * The scraper option is closed rather than deferred: scraping adds an operator-supplied-URL
 * fetch path, breaks on every markup change, sits against the platforms' terms, and provides
 * nothing the connected account's own endpoints do not. So there is **no HTML parsing anywhere
 * in this module**, no competitor code path constructs a URL, and nothing here touches
 * `OutboundFetchService` at all (15d) — a handle is an identifier passed to the adapter's own
 * fixed endpoint.
 *
 * Authorization and metering follow publishing exactly (15b, 15e): the account is loaded by
 * `(companyId, brandId, network)` and never by id alone, the token is decrypted through
 * `CryptoService`, a brand with no connected account on that network is refused rather than
 * falling back to an app-level token, and the read reserves against the publishing ledger
 * *before* the call, above a floor only publishing may draw on.
 */
@Injectable()
export class CompetitorsService implements OnModuleInit {
  private readonly logger = new Logger('MarketingCompetitors');

  constructor(
    @InjectPrisma() private readonly prisma: ScopedPrisma,
    private readonly tenancy: Tenancy,
    private readonly queue: PostgresJobQueueService,
    private readonly adapters: SocialAdapterResolver,
    private readonly crypto: CryptoService,
  ) {}

  /** What a vendor's last `429` asked us to wait, when it asked for anything usable (15f). */
  private lastRetryAfterSeconds?: number;

  onModuleInit(): void {
    registerRowPoller({
      queue: this.queue,
      policy: SNAPSHOT_POLICY,
      logger: this.logger,
      run: (competitorId) => this.captureSnapshot(competitorId),
      scheduleAll: () => this.ensureScheduled(),
      describe: 'competitor snapshots',
    });
  }

  // ── The operator's side ────────────────────────────────────────────────────────

  async listCompetitors(query: Record<string, unknown>): Promise<CompetitorListResponse> {
    const slice = listQuery(query, COMPETITOR_LIST);

    const [rows, total] = await Promise.all([
      this.prisma.competitor.findMany({
        ...slice.findMany<Prisma.CompetitorFindManyArgs>(),
        include: { snapshots: latestSnapshotOnly() },
      }),
      this.prisma.competitor.count(slice.count<Prisma.CompetitorCountArgs>()),
    ]);

    return slice.respond(rows.map((row) => this.describeCompetitor(row)), total);
  }

  async createCompetitor(input: Valid<typeof CreateCompetitorBody>): Promise<CompetitorSummary> {
    await requireBrand(this.prisma, input.brandId);

    // 14-17.0e's other half: a plain count check at create time, refusing with a message.
    const existing = await this.prisma.competitor.count({ where: { brandId: input.brandId } });
    if (existing >= MAX_COMPETITORS_PER_BRAND) {
      throw new ApiException(
        MARKETING_ERROR_CODES.externalSourceLimitReached,
        `A brand tracks at most ${MAX_COMPETITORS_PER_BRAND} competitors. Remove one to add another.`,
        HttpStatus.CONFLICT,
      );
    }

    const duplicate = await this.prisma.competitor.findFirst({
      where: { brandId: input.brandId, network: input.network, handle: input.handle },
    });
    if (duplicate) {
      throw new ApiException(
        MARKETING_ERROR_CODES.competitorAlreadyExists,
        'That handle is already tracked on this network.',
        HttpStatus.CONFLICT,
      );
    }

    const row = await this.prisma.competitor.create({
      data: companyApplied<Prisma.CompetitorUncheckedCreateInput>({
        brandId: input.brandId,
        network: input.network,
        handle: input.handle,
        label: input.label ?? input.handle,
      }),
      include: { snapshots: latestSnapshotOnly() },
    });

    await this.enqueueSnapshot(row.id, new Date());
    return this.describeCompetitor(row);
  }

  async deleteCompetitor(id: string): Promise<void> {
    const competitor = await this.prisma.competitor.findFirst({ where: { id } });
    if (!competitor) throw competitorNotFound();
    await this.prisma.competitor.delete({ where: { id: competitor.id } });
  }

  /**
   * "Snapshot now" enqueues; the network call happens on the queue, as everything does.
   *
   * The one thing it answers immediately is 15b's authorization question: a brand with no
   * connected account on that network can never produce a snapshot, and saying so to the
   * person who asked beats enqueueing a job that records `no_connected_account` where nobody
   * is looking. The *scheduled* poll has no caller to refuse and so keeps the outcome. There
   * is deliberately no companion refusal for the quota floor: 15e settles that case as
   * "snapshot skipped, quota reserved for publishing" — an outcome, not a failure.
   */
  async requestSnapshot(id: string): Promise<CompetitorSummary> {
    const competitor = await this.prisma.competitor.findFirst({
      where: { id },
      include: { snapshots: latestSnapshotOnly() },
    });
    if (!competitor) throw competitorNotFound();

    const account = await this.connectedAccount(competitor.brandId, competitor.network);
    if (!account) {
      throw new ApiException(
        MARKETING_ERROR_CODES.competitorAccountMissing,
        `Connect this brand's ${competitor.network} account first — a competitor read is ` +
          'authorized and metered as that account, never as an app-level token.',
        HttpStatus.CONFLICT,
      );
    }

    await this.enqueueSnapshot(competitor.id, new Date());
    return this.describeCompetitor(competitor);
  }

  async listSnapshots(query: Record<string, unknown>): Promise<CompetitorSnapshotListResponse> {
    const slice = listQuery(query, COMPETITOR_SNAPSHOT_LIST);

    const [rows, total] = await Promise.all([
      this.prisma.competitorSnapshot.findMany(
        slice.findMany<Prisma.CompetitorSnapshotFindManyArgs>(),
      ),
      this.prisma.competitorSnapshot.count(slice.count<Prisma.CompetitorSnapshotCountArgs>()),
    ]);

    return slice.respond(rows.map(describeSnapshot), total);
  }

  // ── The queue's side ───────────────────────────────────────────────────────────

  /** 16c's pattern, applied to competitors: one live job per row, never N per deploy. */
  async enqueueSnapshot(competitorId: string, scheduledAt: Date): Promise<void> {
    await enqueueOnePerRow(this.prisma, this.queue, SNAPSHOT_POLICY, competitorId, scheduledAt);
  }

  async ensureScheduled(): Promise<void> {
    await scheduleEveryRow(
      this.tenancy,
      'marketing.competitors.enumerate_rows_to_schedule_snapshots',
      () => this.prisma.competitor.findMany({ select: SCHEDULER_SELECT }),
      (competitorId) => this.enqueueSnapshot(competitorId, new Date(Date.now() + A_DAY_MS)),
    );
  }

  /**
   * One snapshot: authorize, reserve, read, write one row for today, schedule tomorrow.
   *
   * The order matters and is 14p's: the reservation is committed *before* the adapter call and
   * reconciled to zero when the call does not happen, because a background poll that reads a
   * balance and then spends it has the same two-concurrent-readers hole a composer click has —
   * with the added twist that this one runs while nobody is watching.
   */
  async captureSnapshot(competitorId: string): Promise<SnapshotOutcome> {
    const competitor = await this.prisma.competitor.findFirst({ where: { id: competitorId } });
    if (!competitor) return 'network_error';

    const network = competitor.network as SocialPlatform;
    const window = publishingWindowFor(network) ?? UNLIMITED_WINDOW;
    const outcome = await this.snapshotOnce(
      competitor.id,
      competitor.brandId,
      network,
      competitor.handle,
      window,
    );

    // A network with no endpoint is not retried daily for an answer that will not change.
    if (outcome !== 'unsupported_network') {
      // 15f: the throttled token belongs to the brand's real publishing account, so the next
      // window comes from the limiter this module already owns rather than from a flat day
      // somebody typed at the call site.
      const delay =
        outcome === 'rate_limited'
          ? Math.max(A_DAY_MS, rateLimitBackoffMs(window, this.lastRetryAfterSeconds))
          : A_DAY_MS;
      await this.enqueueSnapshot(competitor.id, new Date(Date.now() + delay));
    }

    this.logger.log(`Competitor ${competitor.id} (${network}): ${outcome}`);
    return outcome;
  }

  private async snapshotOnce(
    competitorId: string,
    brandId: string,
    network: SocialPlatform,
    handle: string,
    window: PublishingWindow,
  ): Promise<SnapshotOutcome> {
    this.lastRetryAfterSeconds = undefined;

    const account = await this.connectedAccount(brandId, network);
    if (!account) return 'no_connected_account';

    // 15b/15e: committed *before* the adapter call, against the ledger publishing draws on,
    // by a conditional update whose zero-rows answer is the refusal.
    const reserved = await reserveCompetitorRead(this.prisma, account.id, window);
    if (!reserved) return 'quota_reserved_for_publishing';

    let metrics: PublicProfileMetrics | undefined;
    try {
      metrics = await this.adapters.getAdapter(network).fetchPublicProfileMetrics({
        account: {
          platform: network,
          platformAccountId: account.platformAccountId,
          accessToken: this.crypto.decrypt(account.encryptedAccessToken),
        },
        handle,
      });
    } catch (err: unknown) {
      if (err instanceof SocialRateLimitError) {
        // The request reached the platform and the platform counted it — exactly as a `FAILED`
        // post that got as far as the network is counted — so the reservation stands.
        this.lastRetryAfterSeconds = err.retryAfterSeconds;
        return 'rate_limited';
      }

      // Otherwise the reservation comes back: a vendor outage must not eat the publish budget.
      await releaseCompetitorRead(this.prisma, account.id);
      return 'network_error';
    }

    if (!metrics) {
      await releaseCompetitorRead(this.prisma, account.id);
      return 'unsupported_network';
    }

    // 15f: the unique index is the mechanism, so a retry writes nothing rather than a second
    // row that every engagement-rate chart would then double-count.
    try {
      await this.prisma.competitorSnapshot.create({
        data: companyApplied<Prisma.CompetitorSnapshotUncheckedCreateInput>({
          brandId,
          competitorId,
          network,
          captureDate: utcDateOf(new Date()),
          followerCount: metrics.followerCount ?? null,
          postCount: metrics.postCount ?? null,
          engagementRate: metrics.engagementRate ?? null,
        }),
      });
      return 'captured';
    } catch (err: unknown) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return 'already_captured_today';
      }
      throw err;
    }
  }

  /**
   * The brand's own connected account for this network (15b).
   *
   * By `(companyId, brandId, network)` and never by id alone: the company comes from the
   * scoped client, so there is no id-only lookup anywhere on this path, no route to another
   * tenant's token, and no fallback to an app-level one.
   */
  private async connectedAccount(brandId: string, network: string) {
    return this.prisma.socialAccount.findFirst({
      where: { brandId, platform: network, status: 'active' },
    });
  }

  private describeCompetitor(row: {
    id: string;
    brandId: string;
    network: string;
    handle: string;
    label: string;
    createdAt: Date;
    updatedAt: Date;
    snapshots?: Array<Parameters<typeof describeSnapshot>[0]>;
  }): CompetitorSummary {
    const network = row.network as SocialPlatform;
    const latest = row.snapshots?.[0];

    return {
      id: row.id,
      brandId: row.brandId,
      network,
      handle: row.handle,
      label: row.label,
      metricsSupported: this.supportsProfileMetrics(network),
      ...(latest ? { latestSnapshot: describeSnapshot(latest) } : {}),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /**
   * Whether this network answers at all — the honest empty state (15a).
   *
   * Asked of the adapter rather than kept as a list here, so "not supported on this network"
   * cannot drift away from what the adapter actually implements.
   */
  private supportsProfileMetrics(network: SocialPlatform): boolean {
    return this.adapters.getAdapter(network).supportsProfileMetrics(network);
  }
}

/** Midnight UTC of the given instant — what makes "one per day" an index, not a convention. */
export function utcDateOf(when: Date): Date {
  return new Date(Date.UTC(when.getUTCFullYear(), when.getUTCMonth(), when.getUTCDate()));
}

function describeSnapshot(row: {
  id: string;
  competitorId: string;
  network: string;
  captureDate: Date;
  followerCount: number | null;
  postCount: number | null;
  engagementRate: Prisma.Decimal | null;
  capturedAt: Date;
}): CompetitorSnapshotSummary {
  return {
    id: row.id,
    competitorId: row.competitorId,
    network: row.network as SocialPlatform,
    captureDate: row.captureDate.toISOString().slice(0, 10),
    ...(row.followerCount !== null ? { followerCount: row.followerCount } : {}),
    ...(row.postCount !== null ? { postCount: row.postCount } : {}),
    // `toFixed`, never `toString`: a Prisma decimal stringifies in exponential notation past a
    // certain size, and a rate that reads `5e-2` on a chart is a rate nobody believes.
    // The canonical string, never `Number(…)`: the column is `numeric(8,4)`, and a decimal is
    // not a JS number at any layer. `toFixed`, never `toString`, because decimal.js prints
    // large values in exponential notation and `Decimal.parse` will not take one back.
    ...(row.engagementRate !== null ? { engagementRate: row.engagementRate.toFixed(4) } : {}),
    capturedAt: row.capturedAt.toISOString(),
  };
}

function competitorNotFound(): ApiException {
  return new ApiException(
    MARKETING_ERROR_CODES.competitorNotFound,
    'That competitor does not exist.',
    HttpStatus.NOT_FOUND,
  );
}

/** The newest snapshot only — a bounded read, not a page. See `bounded-read.ts`. */
function latestSnapshotOnly(): Prisma.Competitor$snapshotsArgs {
  return boundedRead<Prisma.Competitor$snapshotsArgs>(1, { orderBy: { captureDate: 'desc' } });
}
