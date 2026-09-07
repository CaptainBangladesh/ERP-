import type {
  MarketingJobListResponse,
  MarketingJobStatus,
  MarketingJobSummary,
} from '@erp/shared';

export const JOB_QUEUE_TOKEN = Symbol('IJobQueue');

export type JobHandler = (job: MarketingJobSummary) => Promise<void> | void;

export interface ScheduleJobOptions {
  type: string;
  payload: Record<string, unknown>;
  scheduledAt?: Date;
  maxAttempts?: number;
}

export interface JobListFilter {
  status?: MarketingJobStatus;
  type?: string;
  limit?: number;
  offset?: number;
}

export interface IJobQueue {
  /**
   * Schedule a job for async or delayed execution.
   * If scheduledAt is omitted, it is ready to run immediately (now).
   */
  schedule(options: ScheduleJobOptions): Promise<MarketingJobSummary>;

  /**
   * Cancel a pending or scheduled job.
   * Returns true if cancelled, false if not found or already processing/completed.
   */
  cancel(jobId: string): Promise<boolean>;

  /**
   * Atomically claim up to `batchSize` pending jobs that are due for execution.
   * Uses atomic row locking to ensure each job is claimed by exactly one worker.
   */
  poll(batchSize?: number): Promise<MarketingJobSummary[]>;

  /**
   * Mark a claimed job as COMPLETED upon successful execution.
   *
   * `attempts` is the fence token `poll()` returned on the claim. It is required rather than
   * optional so that a caller cannot forget it: a worker that outlived its lease and had its
   * job re-claimed would otherwise overwrite the state of the run that replaced it.
   */
  complete(jobId: string, attempts: number): Promise<void>;

  /**
   * Mark a claimed job as failed, fenced on the same `attempts` token as `complete()`.
   * If attempts < maxAttempts, it is scheduled for retry with exponential backoff.
   * If attempts >= maxAttempts, it is marked as permanently FAILED.
   */
  fail(jobId: string, attempts: number, error: string, retryDelaySeconds?: number): Promise<void>;

  /**
   * Manually retry a failed or cancelled job.
   */
  retry(jobId: string): Promise<MarketingJobSummary>;

  /**
   * Retrieve a job by ID.
   */
  getJob(jobId: string): Promise<MarketingJobSummary | null>;

  /**
   * List jobs for the current tenant.
   */
  listJobs(query: Record<string, unknown>): Promise<MarketingJobListResponse>;

  /**
   * Register a handler function for a given job type.
   */
  registerHandler(type: string, handler: JobHandler): void;
}
