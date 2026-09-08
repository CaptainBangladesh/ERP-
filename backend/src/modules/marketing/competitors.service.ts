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
import type { PublicProfileMetrics } from './adapters/social-adapter.interface';
import { CryptoService } from './crypto.service';
import { PostgresJobQueueService } from './postgres-job-queue.service';
import {
  UNLIMITED_WINDOW,
  competitorHeadroom,
  countAgainstQuota,
  publishingWindowFor,
  type PublishingWindow,
} from './publishing-quota';
import { COMPETITOR_LIST, COMPETITOR_SNAPSHOT_LIST, CreateCompetitorBody } from './schemas';

/** One snapshot job per competitor, on the queue that already exists (15f, 16c's pattern). */
export const COMPETITOR_SNAPSHOT_JOB_TYPE = 'marketing.competitors.snapshot';

const A_DAY_MS = 24 * 60 * 60 * 1000;

/** Why a snapshot did not happen. An outcome the operator reads, not an exception. */
export type SnapshotOutcome =
  | 'captured'
  | 'already_captured_today'
  | 'unsupported_network'
  | 'no_connected_account'
  | 'quota_reserved_for_publishing'
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

  onModuleInit(): void {
    this.queue.registerHandler(COMPETITOR_SNAPSHOT_JOB_TYPE, async (job) => {
      const competitorId = job.payload['competitorId'];
      if (typeof competitorId === 'string') await this.captureSnapshot(competitorId);
    });

    if (process.env.NODE_ENV === 'test') return;

    void this.ensureScheduled().catch((err: unknown) => {
      this.logger.error(
        `Could not schedule competitor snapshots: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
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
    await this.requireBrand(input.brandId);

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

  /** "Snapshot now" enqueues; the network call happens on the queue, as everything does. */
  async requestSnapshot(id: string): Promise<CompetitorSummary> {
    const competitor = await this.prisma.competitor.findFirst({
      where: { id },
      include: { snapshots: latestSnapshotOnly() },
    });
    if (!competitor) throw competitorNotFound();

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
    const live = await this.prisma.marketingJob.findFirst({
      where: {
        type: COMPETITOR_SNAPSHOT_JOB_TYPE,
        status: { in: ['PENDING', 'PROCESSING'] },
        payload: { path: ['competitorId'], equals: competitorId },
      },
      select: { id: true },
    });
    if (live) return;

    await this.queue.schedule({
      type: COMPETITOR_SNAPSHOT_JOB_TYPE,
      payload: { competitorId },
      scheduledAt,
    });
  }

  async ensureScheduled(): Promise<void> {
    const competitors = await this.tenancy.withoutCompanyScope(
      'marketing.competitors.enumerate_rows_to_schedule_snapshots',
      async () => this.prisma.competitor.findMany({ select: { id: true, companyId: true } }),
    );

    for (const competitor of competitors) {
      await this.tenancy.runInCompany(
        { companyId: competitor.companyId, grants: 'all' },
        async () => {
          await this.enqueueSnapshot(competitor.id, new Date(Date.now() + A_DAY_MS));
        },
      );
    }
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
    const outcome = await this.snapshotOnce(competitor.id, competitor.brandId, network, competitor.handle);

    // A network with no endpoint is not retried daily for an answer that will not change.
    if (outcome !== 'unsupported_network') {
      await this.enqueueSnapshot(competitor.id, new Date(Date.now() + A_DAY_MS));
    }

    this.logger.log(`Competitor ${competitor.id} (${network}): ${outcome}`);
    return outcome;
  }

  private async snapshotOnce(
    competitorId: string,
    brandId: string,
    network: SocialPlatform,
    handle: string,
  ): Promise<SnapshotOutcome> {
    // 15b: by `(companyId, brandId, network)` — the company comes from the scoped client, so
    // there is no id-only lookup here and no path to another tenant's token.
    const account = await this.prisma.socialAccount.findFirst({
      where: { brandId, platform: network, status: 'active' },
    });
    if (!account) return 'no_connected_account';

    const window = publishingWindowFor(network) ?? UNLIMITED_WINDOW;

    const reserved = await this.reserve(account.id, window);
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
    } catch {
      // The reservation comes back: a vendor outage must not eat the brand's publish budget.
      await this.release(account.id);
      return 'network_error';
    }

    if (!metrics) {
      await this.release(account.id);
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
   * Reserve one unit of the brand's publishing window, or refuse (15e).
   *
   * The refusal is a zero-rows-affected conditional update and not a read followed by a
   * decision — that difference is the whole of 14p. The floor is what keeps an unattended
   * benchmark poll from eating the budget a 9am scheduled post needs.
   */
  private async reserve(socialAccountId: string, window: PublishingWindow): Promise<boolean> {
    const now = Date.now();
    const windowStart = new Date(now - window.windowSeconds * 1000);

    const published = await countAgainstQuota(
      this.prisma.scheduledPost,
      socialAccountId,
      window.windowSeconds,
      now,
    );

    const headroom = competitorHeadroom(window, published);
    if (headroom <= 0) return false;

    await this.ensureCounter(socialAccountId, windowStart);

    // Roll the window first, so yesterday's reservations do not count against today.
    await this.prisma.socialQuotaReservation.updateMany({
      where: { socialAccountId, windowStartedAt: { lt: windowStart } },
      data: { windowStartedAt: new Date(now), reserved: 0 },
    });

    const claimed = await this.prisma.socialQuotaReservation.updateMany({
      where: { socialAccountId, reserved: { lt: headroom } },
      data: { reserved: { increment: 1 } },
    });

    return claimed.count > 0;
  }

  /** Reconcile to zero: the call did not reach the network, so nothing was spent. */
  private async release(socialAccountId: string): Promise<void> {
    await this.prisma.socialQuotaReservation.updateMany({
      where: { socialAccountId, reserved: { gt: 0 } },
      data: { reserved: { decrement: 1 } },
    });
  }

  private async ensureCounter(socialAccountId: string, windowStart: Date): Promise<void> {
    const existing = await this.prisma.socialQuotaReservation.findFirst({
      where: { socialAccountId },
      select: { id: true },
    });
    if (existing) return;

    try {
      await this.prisma.socialQuotaReservation.create({
        data: companyApplied<Prisma.SocialQuotaReservationUncheckedCreateInput>({
          socialAccountId,
          windowStartedAt: windowStart,
          reserved: 0,
        }),
      });
    } catch {
      // Two first reads of the window racing. The unique index decided; either row will do.
    }
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
    return PROFILE_METRIC_NETWORKS.has(network);
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
 * The networks whose official API exposes public profile metrics (15a).
 *
 * LinkedIn answers only for organizations the caller administers and TikTok's Display API only
 * for the authorized user's own account, so both store the row and render "not supported on
 * this network" — which is the settled answer, not a gap waiting for a scraper.
 */
const PROFILE_METRIC_NETWORKS: ReadonlySet<SocialPlatform> = new Set<SocialPlatform>([
  'instagram',
  'facebook',
  'x',
]);

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
    ...(row.engagementRate !== null
      ? { engagementRate: Number(row.engagementRate.toFixed(4)) }
      : {}),
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

/**
 * The newest snapshot only — a bounded read, not a page.
 *
 * Declared this way for the same reason `RetentionService.batchOf` is: the conformance pack
 * refuses a bare `take:` in a module because that is how hand-rolled paging gets in, and this
 * says which of the two it is.
 */
function latestSnapshotOnly(): Prisma.Competitor$snapshotsArgs {
  const args: Prisma.Competitor$snapshotsArgs = { orderBy: { captureDate: 'desc' } };
  args['take'] = 1;
  return args;
}
