import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PostgresJobQueueService } from './postgres-job-queue.service';

/**
 * How many claimed jobs run at once.
 *
 * Its own constant rather than `batchSize`, so that raising how much work a tick claims cannot
 * silently raise how hard this module hits Meta, LinkedIn and TikTok at the same instant.
 *
 * Read this next to `JOB_LEASE_MS`: the lease is measured against wall-clock time, so the
 * slowest job in a window of this size has to finish well inside it. Five and five minutes
 * leaves a wide margin for an outbound social API call; move one and check the other.
 */
export const JOB_CONCURRENCY = 5;

/**
 * Background worker service for processing scheduled marketing jobs.
 *
 * Execution Model:
 * - Polls pending jobs whose scheduledAt timestamp has arrived.
 * - Claims jobs atomically using Postgres row-level locks to avoid worker collisions.
 * - Delegates execution to PostgresJobQueueService.executeJob, which runs inside
 *   the job's tenant context.
 * - Handles exponential backoff retries on failure.
 */
@Injectable()
export class JobQueueWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobQueueWorkerService.name);
  private timer: NodeJS.Timeout | null = null;
  private isProcessing = false;

  constructor(private readonly queue: PostgresJobQueueService) {}

  onModuleInit(): void {
    const isTest = process.env.NODE_ENV === 'test';
    const isWorkerDisabled = process.env.MARKETING_WORKER_ENABLED === 'false';

    if (isTest || isWorkerDisabled) {
      this.logger.log('JobQueueWorkerService: background polling loop disabled (test or explicit flag)');
      return;
    }

    const intervalMs = Number(process.env.MARKETING_QUEUE_POLL_INTERVAL_MS ?? 5000);
    this.logger.log(`JobQueueWorkerService: starting polling loop (interval: ${intervalMs}ms)`);

    this.timer = setInterval(() => {
      void this.tick();
    }, intervalMs);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.logger.log('JobQueueWorkerService: stopped polling loop');
    }
  }

  /**
   * One tick of the worker loop.
   */
  async tick(batchSize = 10): Promise<number> {
    if (this.isProcessing) {
      return 0; // Avoid overlapping ticks on the same worker instance
    }

    this.isProcessing = true;
    try {
      return await this.processNextBatch(batchSize);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Error during queue tick: ${errorMsg}`, err instanceof Error ? err.stack : undefined);
      return 0;
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Claims and processes a batch of due jobs.
   * Exposed publicly so tests and manual triggers can drive execution deterministically.
   */
  async processNextBatch(batchSize = 10): Promise<number> {
    const jobs = await this.queue.poll(batchSize);
    if (jobs.length === 0) {
      return 0;
    }

    this.logger.log(`Claimed ${jobs.length} jobs for execution`);

    // Bounded concurrency rather than one-at-a-time. Serially, a batch of ten posts to Meta
    // took the slowest network call times ten — and the lease is measured against that.
    //
    // `allSettled` rather than `all`: `executeJob` already turns a handler throw into that
    // job's own `fail()`, so a rejected settle here is exceptional, and it must not abort the
    // siblings still in flight or the tick around them. Each job keeps its own
    // `tenancy.runInCompany` frame inside `executeJob`, so nothing tenant-scoped is shared
    // across the window.
    for (let i = 0; i < jobs.length; i += JOB_CONCURRENCY) {
      const window = jobs.slice(i, i + JOB_CONCURRENCY);
      const settled = await Promise.allSettled(
        window.map((job) => this.queue.executeJob(job)),
      );

      for (const outcome of settled) {
        if (outcome.status === 'rejected') {
          const reason = outcome.reason;
          this.logger.error(
            `Job execution rejected outside its own error handling: ${
              reason instanceof Error ? reason.message : String(reason)
            }`,
          );
        }
      }
    }

    return jobs.length;
  }
}
