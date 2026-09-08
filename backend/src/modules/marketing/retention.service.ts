import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { InjectPrisma, type ScopedPrisma, Tenancy } from '../../platform/tenancy';
import { PostgresJobQueueService } from './postgres-job-queue.service';

/** The job type, and the only handler this service registers. */
export const RETENTION_JOB_TYPE = 'marketing.retention.purge';

/** How long pseudonymous visitor events are kept when nothing says otherwise. */
export const DEFAULT_RETENTION_DAYS = 180;

/** How long a competitor's daily aggregates are kept when nothing says otherwise (15c). */
export const DEFAULT_SNAPSHOT_RETENTION_DAYS = 365;

/**
 * Rows removed per pass.
 *
 * Capped so that one tick can never hold a long lock on `page_view_events` — the table the
 * public pixel is writing to at the same moment. A pass that comes back full re-enqueues
 * itself immediately rather than looping, so the queue keeps its turn.
 */
const PURGE_BATCH = 10_000;

const A_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Retention for the one table that grows without bound.
 *
 * Before ticket 12, `deleteMany`, `retention` and `purge` matched nothing anywhere in this
 * module: `PageViewEvent` grew forever. That is a cost problem and, on the one table holding
 * pseudonymous visitor data, a GDPR storage-limitation problem — keeping personal data
 * indefinitely because nobody wrote the delete is not a retention policy.
 *
 * It runs on the queue this module already owns rather than on a cron the deploy does not
 * have, and it schedules its own next run. Zero new infrastructure, which is this module's
 * charter. The purge only removes raw event rows; anything already aggregated stays.
 */
@Injectable()
export class RetentionService implements OnModuleInit {
  private readonly logger = new Logger(RetentionService.name);

  constructor(
    @InjectPrisma() private readonly prisma: ScopedPrisma,
    private readonly tenancy: Tenancy,
    private readonly queue: PostgresJobQueueService,
  ) {}

  onModuleInit(): void {
    this.queue.registerHandler(RETENTION_JOB_TYPE, () => this.purge());

    if (process.env.NODE_ENV === 'test') return;

    void this.ensureScheduled().catch((err: unknown) => {
      this.logger.error(
        `Could not schedule the analytics retention purge: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    });
  }

  /** The window, as data rather than as a constant somebody has to redeploy to change. */
  retentionDays(): number {
    const configured = Number(process.env.MARKETING_ANALYTICS_RETENTION_DAYS);
    return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_RETENTION_DAYS;
  }

  /**
   * Competitor snapshots expire on their own window (15c).
   *
   * Their own number because they are a different kind of row from a visitor event — a year of
   * daily aggregates is a chart somebody wants, where a year of raw page views is a liability —
   * but the same job, because 15c says these expire through the existing retention pass rather
   * than a second scheduler.
   */
  snapshotRetentionDays(): number {
    const configured = Number(process.env.MARKETING_SNAPSHOT_RETENTION_DAYS);
    return Number.isFinite(configured) && configured > 0
      ? configured
      : DEFAULT_SNAPSHOT_RETENTION_DAYS;
  }

  /**
   * One pending purge per tenant, and never a second.
   *
   * The check is what stops a restart fanning out duplicates — a self-scheduling job plus an
   * unconditional enqueue at boot would multiply the queue by the number of deploys.
   */
  async ensureScheduled(): Promise<void> {
    const companies = await this.tenancy.withoutCompanyScope(
      'marketing.retention.enumerate_tenants_to_schedule_the_analytics_purge',
      async () => {
        const brands = await this.prisma.marketingBrand.findMany({
          distinct: ['companyId'],
          select: { companyId: true },
        });

        const pending = await this.prisma.marketingJob.findMany({
          where: { type: RETENTION_JOB_TYPE, status: { in: ['PENDING', 'PROCESSING'] } },
          select: { companyId: true },
        });

        const alreadyQueued = new Set(pending.map((job) => job.companyId));
        return brands
          .map((brand) => brand.companyId)
          .filter((id) => !alreadyQueued.has(id));
      },
    );

    for (const companyId of companies) {
      await this.tenancy.runInCompany({ companyId, grants: 'all' }, async () => {
        await this.queue.schedule({
          type: RETENTION_JOB_TYPE,
          payload: {},
          scheduledAt: new Date(Date.now() + A_DAY_MS),
        });
      });
    }

    if (companies.length > 0) {
      this.logger.log(`Scheduled the analytics retention purge for ${companies.length} tenant(s)`);
    }
  }

  /**
   * Deletes one batch of expired events, then decides when to run again.
   *
   * Called inside the job's own tenant frame, so the scoped client already restricts this to
   * the company that owns the job — the purge cannot reach across tenants even by mistake,
   * which is a stronger guarantee than running it unscoped and filtering by hand.
   *
   * Ids are selected first and deleted by identity rather than deleting by predicate, because
   * a bare `deleteMany` on a timestamp has no ceiling: the first run after this ships could be
   * millions of rows in one statement.
   */
  async purge(): Promise<void> {
    const cutoff = new Date(Date.now() - this.retentionDays() * A_DAY_MS);

    const expiring = await this.prisma.pageViewEvent.findMany({
      where: { timestamp: { lt: cutoff } },
      orderBy: { timestamp: 'asc' },
      select: { id: true },
      ...batchOf(PURGE_BATCH),
    });

    let removed = 0;
    if (expiring.length > 0) {
      const result = await this.prisma.pageViewEvent.deleteMany({
        where: { id: { in: expiring.map((row) => row.id) } },
      });
      removed = result.count;
      this.logger.log(
        `Purged ${removed} page view event(s) older than ${cutoff.toISOString()}`,
      );
    }

    await this.purgeCompetitorSnapshots();

    // A full batch means there is more behind it; come straight back rather than waiting a day
    // and rather than looping here and holding the worker.
    const more = expiring.length >= PURGE_BATCH;
    await this.queue.schedule({
      type: RETENTION_JOB_TYPE,
      payload: {},
      scheduledAt: new Date(Date.now() + (more ? 0 : A_DAY_MS)),
    });
  }

  /**
   * Expires competitor snapshots on the same pass (15c).
   *
   * Deleted by identity from a bounded read, exactly as the event purge is, so the first run
   * after a long-lived deployment cannot become one enormous statement. The rows are
   * append-only aggregates, so this is the only thing that ever removes one.
   */
  private async purgeCompetitorSnapshots(): Promise<void> {
    const cutoff = new Date(Date.now() - this.snapshotRetentionDays() * A_DAY_MS);

    const expiring = await this.prisma.competitorSnapshot.findMany({
      where: { capturedAt: { lt: cutoff } },
      orderBy: { capturedAt: 'asc' },
      select: { id: true },
      ...snapshotBatchOf(PURGE_BATCH),
    });

    if (expiring.length === 0) return;

    const result = await this.prisma.competitorSnapshot.deleteMany({
      where: { id: { in: expiring.map((row) => row.id) } },
    });

    this.logger.log(
      `Purged ${result.count} competitor snapshot(s) older than ${cutoff.toISOString()}`,
    );
  }
}

/** The same bounded-read declaration as `batchOf`, for the snapshot table. */
function snapshotBatchOf(count: number): Pick<Prisma.CompetitorSnapshotFindManyArgs, 'take'> {
  const args: Pick<Prisma.CompetitorSnapshotFindManyArgs, 'take'> = {};
  args['take'] = count;
  return args;
}

/**
 * A bounded read that is not a paged list — see the same helper in `smart-links.service.ts`.
 * The conformance pack refuses a bare `take:`, and this says which of the two it is.
 */
function batchOf(count: number): Pick<Prisma.PageViewEventFindManyArgs, 'take'> {
  const args: Pick<Prisma.PageViewEventFindManyArgs, 'take'> = {};
  args['take'] = count;
  return args;
}
