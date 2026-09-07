import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  MarketingJobListResponse,
  MarketingJobStatus,
  MarketingJobSummary,
} from '@erp/shared';
import { ApiException } from '../../http/api-exception';
import { listQuery } from '../../platform/list';
import { companyApplied, InjectPrisma, ScopedPrisma, Tenancy } from '../../platform/tenancy';
import type {
  IJobQueue,
  JobHandler,
  ScheduleJobOptions,
} from './job-queue.interface';
import { JOB_LIST } from './schemas';

/**
 * How long a claim is good for.
 *
 * Compared against `lockedAt` and nothing else — never `updatedAt`, never a heartbeat a
 * handler has to remember to send, because a liveness signal somebody can forget to emit is a
 * liveness signal that reports health for dead work.
 *
 * This number and `JOB_CONCURRENCY` in `job-queue-worker.service.ts` are a pair: the lease has
 * to stay comfortably longer than the slowest job takes when `JOB_CONCURRENCY` of them are in
 * flight at once, or a merely-slow worker gets fenced out of its own job on every run. Five
 * minutes against five concurrent outbound social API calls has a wide margin; change either
 * number and re-read the other.
 */
export const JOB_LEASE_MS = 5 * 60 * 1000;

/**
 * PostgreSQL-backed job queue implementation.
 *
 * Concurrency & Collision-Free Guarantees (ADR 0003 & ADR 0009):
 * - ADR 0003 and check-tenancy.mjs strictly prohibit raw SQL ($queryRaw) in `src/` to prevent
 *   accidental cross-tenant leaks.
 * - Concurrency protection is achieved via PostgreSQL's atomic row-locking conditional write:
 *     UPDATE "marketing_jobs"
 *     SET status = 'PROCESSING', locked_at = NOW(), attempts = attempts + 1
 *     WHERE id = $id AND status = 'PENDING'
 *   If two worker instances attempt to claim the same job, PostgreSQL's row-level lock serializes
 *   the evaluation. Exactly one worker sees `status = 'PENDING'` and receives `count === 1`.
 *   The competing worker sees `status = 'PROCESSING'` and receives `count === 0`, advancing to
 *   the next candidate without colliding or blocking.
 * - This is *not* `FOR UPDATE SKIP LOCKED`, whatever the map used to say: it is an atomic
 *   conditional `updateMany` per candidate, over-fetching `batchSize * 2` so that a lost race
 *   still leaves work in the batch. Correct under READ COMMITTED, at the cost of one round-trip
 *   per candidate. See the note at `poll()` for when that cost becomes worth revisiting.
 *
 * Liveness (ticket 12):
 * - `lockedAt` used to be written and never read, so a worker that died mid-execution stranded
 *   its job in `PROCESSING` forever — for a scheduled-posting product, posts that silently
 *   never go out while the dashboard stays green. A janitor pass on every poll tick now
 *   reclaims those by clock alone.
 * - A lease on its own makes that worse rather than better, so `attempts` doubles as a fencing
 *   token: `complete()` and `fail()` match on the value the worker was handed at claim time,
 *   and a stale worker returning after its lease expired finds `count === 0` and writes
 *   nothing. The two changes are one change; neither ships without the other.
 */
@Injectable()
export class PostgresJobQueueService implements IJobQueue {
  private readonly logger = new Logger(PostgresJobQueueService.name);
  private readonly handlers = new Map<string, JobHandler>();

  constructor(
    @InjectPrisma() private readonly prisma: ScopedPrisma,
    private readonly tenancy: Tenancy,
  ) {}

  /**
   * Registers an execution handler for a specific job type.
   */
  registerHandler(type: string, handler: JobHandler): void {
    if (this.handlers.has(type)) {
      this.logger.warn(`Overwriting job handler for type: "${type}"`);
    }
    this.handlers.set(type, handler);
  }

  /**
   * Retrieves the registered handler for a job type.
   */
  getHandler(type: string): JobHandler | undefined {
    return this.handlers.get(type);
  }

  /**
   * Enqueues a job for immediate or future scheduled execution.
   */
  async schedule(options: ScheduleJobOptions): Promise<MarketingJobSummary> {
    const scheduledAt = options.scheduledAt ?? new Date();
    const maxAttempts = options.maxAttempts ?? 3;

    const row = await this.prisma.marketingJob.create({
      data: companyApplied<Prisma.MarketingJobUncheckedCreateInput>({
        type: options.type,
        payload: (options.payload ?? {}) as Prisma.InputJsonValue,
        scheduledAt,
        status: 'PENDING',
        attempts: 0,
        maxAttempts,
      }),
    });

    this.logger.log(`Enqueued job ${row.id} (${row.type}) for ${row.scheduledAt.toISOString()}`);
    return this.toSummary(row);
  }

  /**
   * Cancels a pending job.
   */
  async cancel(jobId: string): Promise<boolean> {
    const job = await this.prisma.marketingJob.findUnique({
      where: { id: jobId },
    });

    if (!job) {
      throw new ApiException('marketing_job_not_found', 'Job not found', 404);
    }

    if (job.status !== 'PENDING') {
      return false;
    }

    const updated = await this.prisma.marketingJob.updateMany({
      where: {
        id: jobId,
        status: 'PENDING',
      },
      data: {
        status: 'CANCELLED',
      },
    });

    return updated.count === 1;
  }

  /**
   * Manually retries a failed or cancelled job.
   */
  async retry(jobId: string): Promise<MarketingJobSummary> {
    const job = await this.prisma.marketingJob.findUnique({
      where: { id: jobId },
    });

    if (!job) {
      throw new ApiException('marketing_job_not_found', 'Job not found', 404);
    }

    if (job.status !== 'FAILED' && job.status !== 'CANCELLED') {
      throw new ApiException(
        'job_not_retriable',
        `Cannot retry a job in status "${job.status}". Only FAILED or CANCELLED jobs may be retried.`,
        400,
      );
    }

    const updated = await this.prisma.marketingJob.update({
      where: { id: jobId },
      data: {
        status: 'PENDING',
        attempts: 0,
        scheduledAt: new Date(),
        lastError: null,
        lockedAt: null,
      },
    });

    return this.toSummary(updated);
  }

  /**
   * Retrieves a single job by ID.
   */
  async getJob(jobId: string): Promise<MarketingJobSummary | null> {
    const job = await this.prisma.marketingJob.findUnique({
      where: { id: jobId },
    });

    return job ? this.toSummary(job) : null;
  }

  /**
   * Lists jobs for the acting company using the standardized list query parser.
   */
  async listJobs(query: Record<string, unknown>): Promise<MarketingJobListResponse> {
    const slice = listQuery(query, JOB_LIST);

    const [rows, total] = await Promise.all([
      this.prisma.marketingJob.findMany(slice.findMany<Prisma.MarketingJobFindManyArgs>()),
      this.prisma.marketingJob.count(slice.count<Prisma.MarketingJobCountArgs>()),
    ]);

    return slice.respond(rows.map((row) => this.toSummary(row)), total);
  }

  /**
   * Returns jobs whose worker died holding the lease.
   *
   * By the clock alone: a job in `PROCESSING` whose `lockedAt` is older than `JOB_LEASE_MS` is
   * assumed abandoned. Two `updateMany`s, one per outcome, rather than a read-then-write loop —
   * the whole point is that this is cheap enough to run on every tick.
   *
   * `attempts` is deliberately *not* reset. An expired lease is a spent attempt; a job that
   * reliably kills whatever runs it would otherwise retry forever, which is the failure this
   * pass exists to end rather than to relocate.
   */
  private async reclaimExpiredLeases(now: Date): Promise<void> {
    const expiredBefore = new Date(now.getTime() - JOB_LEASE_MS);
    const expired = {
      status: 'PROCESSING',
      lockedAt: { lt: expiredBefore },
    } as const;

    // Spent its attempts while the lease ran out: there is nothing left to retry with.
    const dead = await this.prisma.marketingJob.updateMany({
      where: {
        ...expired,
        attempts: { gte: this.prisma.marketingJob.fields.maxAttempts },
      },
      data: {
        status: 'FAILED',
        lockedAt: null,
        lastError: 'lease expired: worker did not report back within the lease window',
      },
    });

    const requeued = await this.prisma.marketingJob.updateMany({
      where: {
        ...expired,
        attempts: { lt: this.prisma.marketingJob.fields.maxAttempts },
      },
      data: {
        status: 'PENDING',
        lockedAt: null,
        lastError: 'lease expired: worker did not report back within the lease window',
      },
    });

    if (dead.count > 0 || requeued.count > 0) {
      this.logger.warn(
        `Reclaimed expired job leases: ${requeued.count} returned to PENDING, ${dead.count} marked FAILED`,
      );
    }
  }

  /**
   * Atomically claims up to `batchSize` pending jobs ready to execute across all companies.
   *
   * Claiming costs one round-trip per candidate, so a tick is `1 + batchSize * 2` queries at
   * worst. That is fine at this module's volume and is the reason there is no raw
   * `FOR UPDATE SKIP LOCKED` here — `$queryRaw` is refused by `check-tenancy.mjs` under
   * ADR 0003, and a performance nicety is the wrong thing to spend the first exemption on.
   * Revisit when either is true: a tick's claim phase runs longer than the poll interval, or
   * the deploy runs a second worker instance.
   */
  async poll(batchSize = 10): Promise<MarketingJobSummary[]> {
    return this.tenancy.withoutCompanyScope(
      'Polling pending background marketing jobs across tenants',
      async () => {
        const now = new Date();

        // 0. Return abandoned work to the pool before looking for new work.
        await this.reclaimExpiredLeases(now);

        // 1. Fetch candidate jobs that are due for execution
        const queryArgs: Prisma.MarketingJobFindManyArgs = {
          where: {
            status: 'PENDING',
            scheduledAt: { lte: now },
          },
          orderBy: { scheduledAt: 'asc' },
        };
        queryArgs['take'] = batchSize * 2; // Over-fetch to allow for concurrent competitor claims

        const candidates = await this.prisma.marketingJob.findMany(queryArgs);

        const claimed: MarketingJobSummary[] = [];

        // 2. Perform atomic conditional update for each candidate
        for (const candidate of candidates) {
          if (claimed.length >= batchSize) break;

          const claimResult = await this.prisma.marketingJob.updateMany({
            where: {
              id: candidate.id,
              status: 'PENDING',
            },
            data: {
              status: 'PROCESSING',
              lockedAt: now,
              attempts: { increment: 1 },
            },
          });

          if (claimResult.count === 1) {
            // Successfully claimed! Read the latest row state
            claimed.push({
              ...this.toSummary(candidate),
              status: 'PROCESSING',
              attempts: candidate.attempts + 1,
              lockedAt: now.toISOString(),
            });
          }
        }

        return claimed;
      },
    );
  }

  /**
   * Marks a job as successfully completed.
   *
   * `attempts` is the fence token the caller was handed by `poll()`. A worker that outlived its
   * lease and came back to find its job re-claimed matches nothing here and writes nothing —
   * which is the entire reason the parameter exists and the reason it is not optional.
   */
  async complete(jobId: string, attempts: number): Promise<void> {
    await this.tenancy.withoutCompanyScope(
      'Marking background marketing job as COMPLETED',
      async () => {
        const updated = await this.prisma.marketingJob.updateMany({
          where: {
            id: jobId,
            status: 'PROCESSING',
            attempts,
          },
          data: {
            status: 'COMPLETED',
            lockedAt: null,
          },
        });

        if (updated.count === 0) this.staleWorker(jobId, attempts, 'complete');
      },
    );
  }

  /**
   * A write that lost its fence.
   *
   * Normal, not exceptional: the job is already being run again by somebody who holds the
   * current claim, and the right response is to drop this result on the floor and say so.
   * Throwing here would turn a handled race into an error the caller would be tempted to
   * retry, which is how you get the double-execution the fence was added to prevent.
   */
  private staleWorker(jobId: string, attempts: number, operation: string): void {
    this.logger.warn(
      `Stale worker, job re-claimed: ignoring ${operation}() for job ${jobId} at attempt ${attempts}`,
    );
  }

  /**
   * Marks a job as failed, scheduling an exponential backoff retry if attempts < maxAttempts.
   *
   * Fenced on `attempts` exactly as `complete()` is.
   */
  async fail(
    jobId: string,
    attempts: number,
    error: string,
    retryDelaySeconds?: number,
  ): Promise<void> {
    await this.tenancy.withoutCompanyScope(
      'Handling background marketing job failure and backoff retry',
      async () => {
        const job = await this.prisma.marketingJob.findUnique({
          where: { id: jobId },
        });

        if (!job) return;

        if (job.attempts < job.maxAttempts) {
          // Calculate exponential backoff: 2^attempts * 10s (capped at 1 hour)
          const delaySeconds =
            retryDelaySeconds ??
            Math.min(3600, Math.max(10, Math.pow(2, job.attempts) * 10));

          const nextRun = new Date(Date.now() + delaySeconds * 1000);

          const updated = await this.prisma.marketingJob.updateMany({
            where: { id: jobId, status: 'PROCESSING', attempts },
            data: {
              status: 'PENDING',
              scheduledAt: nextRun,
              lockedAt: null,
              lastError: error,
            },
          });

          if (updated.count === 0) {
            this.staleWorker(jobId, attempts, 'fail');
            return;
          }

          this.logger.warn(
            `Job ${jobId} failed (attempt ${job.attempts}/${job.maxAttempts}). Retrying in ${delaySeconds}s at ${nextRun.toISOString()}. Error: ${error}`,
          );
        } else {
          // Permanently failed
          const updated = await this.prisma.marketingJob.updateMany({
            where: { id: jobId, status: 'PROCESSING', attempts },
            data: {
              status: 'FAILED',
              lockedAt: null,
              lastError: error,
            },
          });

          if (updated.count === 0) {
            this.staleWorker(jobId, attempts, 'fail');
            return;
          }

          this.logger.error(
            `Job ${jobId} permanently FAILED after ${job.attempts} attempts. Error: ${error}`,
          );
        }
      },
    );
  }

  /**
   * Executes a claimed job within its tenant scope.
   */
  async executeJob(job: MarketingJobSummary): Promise<void> {
    const handler = this.getHandler(job.type);

    if (!handler) {
      this.logger.warn(`No handler registered for job type "${job.type}". Failing job ${job.id}`);
      await this.fail(job.id, job.attempts, `No handler registered for job type "${job.type}"`);
      return;
    }

    await this.tenancy.runInCompany(
      { companyId: job.companyId, grants: 'all' },
      async () => {
        try {
          this.logger.log(`Executing job ${job.id} (${job.type}) for tenant ${job.companyId}`);
          await handler(job);
          await this.complete(job.id, job.attempts);
          this.logger.log(`Completed job ${job.id} (${job.type})`);
        } catch (err: unknown) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          this.logger.warn(`Job ${job.id} handler threw: ${errorMsg}`);
          await this.fail(job.id, job.attempts, errorMsg);
        }
      },
    );
  }


  private toSummary(row: {
    id: string;
    companyId: string;
    type: string;
    payload: unknown;
    scheduledAt: Date;
    status: string;
    attempts: number;
    maxAttempts: number;
    lastError: string | null;
    lockedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): MarketingJobSummary {
    return {
      id: row.id,
      companyId: row.companyId,
      type: row.type,
      payload: (row.payload as Record<string, unknown>) ?? {},
      scheduledAt: row.scheduledAt.toISOString(),
      status: row.status as MarketingJobStatus,
      attempts: row.attempts,
      maxAttempts: row.maxAttempts,
      lastError: row.lastError,
      lockedAt: row.lockedAt ? row.lockedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
