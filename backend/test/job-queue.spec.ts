import {
  JOB_LEASE_MS,
  PostgresJobQueueService,
} from '../src/modules/marketing/postgres-job-queue.service';
import {
  JOB_CONCURRENCY,
  JobQueueWorkerService,
} from '../src/modules/marketing/job-queue-worker.service';
import { Tenancy } from '../src/platform/tenancy';
import type { MarketingJobSummary } from '@erp/shared';

describe('PostgresJobQueueService & JobQueueWorkerService', () => {
  let mockJobs: Array<{
    id: string;
    companyId: string;
    type: string;
    payload: Record<string, unknown>;
    scheduledAt: Date;
    status: string;
    attempts: number;
    maxAttempts: number;
    lastError: string | null;
    lockedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }>;

  let mockPrisma: any;
  let tenancy: Tenancy;
  let queueService: PostgresJobQueueService;
  let workerService: JobQueueWorkerService;

  beforeEach(() => {
    mockJobs = [];
    tenancy = new Tenancy();

    mockPrisma = {
      marketingJob: {
        create: jest.fn(async ({ data }: any) => {
          const row = {
            id: `job-${mockJobs.length + 1}`,
            companyId: data.companyId ?? 'company-1',
            type: data.type,
            payload: data.payload ?? {},
            scheduledAt: data.scheduledAt,
            status: data.status ?? 'PENDING',
            attempts: data.attempts ?? 0,
            maxAttempts: data.maxAttempts ?? 3,
            lastError: data.lastError ?? null,
            lockedAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          mockJobs.push(row);
          return row;
        }),

        findUnique: jest.fn(async ({ where }: any) => {
          return mockJobs.find((j) => j.id === where.id) ?? null;
        }),

        findMany: jest.fn(async ({ where, orderBy }: any) => {
          let filtered = [...mockJobs];
          if (where?.status) {
            filtered = filtered.filter((j) => j.status === where.status);
          }
          if (where?.scheduledAt?.lte) {
            const cutoff = where.scheduledAt.lte.getTime();
            filtered = filtered.filter((j) => j.scheduledAt.getTime() <= cutoff);
          }
          if (orderBy?.scheduledAt === 'asc') {
            filtered.sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
          }
          return filtered.map((j) => ({ ...j }));
        }),

        updateMany: jest.fn(async ({ where, data }: any) => {
          let count = 0;
          for (const job of mockJobs) {
            const matchesId = !where?.id || job.id === where.id;
            const matchesStatus = !where?.status || job.status === where.status;
            const matchesLock =
              where?.lockedAt?.lt === undefined ||
              (job.lockedAt !== null && job.lockedAt.getTime() < where.lockedAt.lt.getTime());
            // `attempts` arrives either as the fence token (a number) or as a comparison
            // against the row's own `maxAttempts` (a Prisma field reference, which the mock
            // stands in for with the sentinel below).
            const matchesAttempts =
              where?.attempts === undefined ||
              (typeof where.attempts === 'number'
                ? job.attempts === where.attempts
                : where.attempts.gte !== undefined
                  ? job.attempts >= job.maxAttempts
                  : job.attempts < job.maxAttempts);

            if (matchesId && matchesStatus && matchesLock && matchesAttempts) {
              if (data.status) job.status = data.status;
              if (data.lockedAt !== undefined) job.lockedAt = data.lockedAt;
              if (data.attempts?.increment) job.attempts += data.attempts.increment;
              if (data.scheduledAt) job.scheduledAt = data.scheduledAt;
              if (data.lastError !== undefined) job.lastError = data.lastError;
              job.updatedAt = new Date();
              count++;
            }
          }
          return { count };
        }),

        update: jest.fn(async ({ where, data }: any) => {
          const job = mockJobs.find((j) => j.id === where.id);
          if (!job) throw new Error('Not found');
          if (data.status) job.status = data.status;
          if (data.attempts !== undefined) job.attempts = data.attempts;
          if (data.scheduledAt) job.scheduledAt = data.scheduledAt;
          if (data.lastError !== undefined) job.lastError = data.lastError;
          if (data.lockedAt !== undefined) job.lockedAt = data.lockedAt;
          job.updatedAt = new Date();
          return job;
        }),

        count: jest.fn(async () => mockJobs.length),

        // Prisma's field-reference accessor. The reaper compares `attempts` against the row's
        // own `maxAttempts`; the mock only needs the marker, not the real reference object.
        fields: { maxAttempts: { _ref: 'maxAttempts' } },
      },
    };

    queueService = new PostgresJobQueueService(mockPrisma, tenancy);
    workerService = new JobQueueWorkerService(queueService);
  });

  it('schedules a job for delayed execution', async () => {
    const future = new Date(Date.now() + 60000);
    const job = await queueService.schedule({
      type: 'publish_social_post',
      payload: { postId: 'post-100' },
      scheduledAt: future,
      maxAttempts: 5,
    });

    expect(job.id).toBeDefined();
    expect(job.type).toBe('publish_social_post');
    expect(job.status).toBe('PENDING');
    expect(job.attempts).toBe(0);
    expect(job.maxAttempts).toBe(5);
    expect(job.payload).toEqual({ postId: 'post-100' });
    expect(new Date(job.scheduledAt).getTime()).toBe(future.getTime());
  });

  it('cancels a pending job and refuses already processed jobs', async () => {
    const job = await queueService.schedule({
      type: 'sync_social_inbox',
      payload: {},
    });

    const cancelled = await queueService.cancel(job.id);
    expect(cancelled).toBe(true);

    const cancelledJob = await queueService.getJob(job.id);
    expect(cancelledJob?.status).toBe('CANCELLED');

    // Cancelling again should return false
    const cancelledAgain = await queueService.cancel(job.id);
    expect(cancelledAgain).toBe(false);
  });

  it('polls only due jobs and transitions status to PROCESSING atomically', async () => {
    const now = Date.now();
    // Due job (scheduled 5 seconds ago)
    await queueService.schedule({
      type: 'sync_ad_metrics',
      payload: { platform: 'meta' },
      scheduledAt: new Date(now - 5000),
    });

    // Future job (scheduled 1 hour from now)
    await queueService.schedule({
      type: 'publish_social_post',
      payload: { platform: 'linkedin' },
      scheduledAt: new Date(now + 3600000),
    });

    const claimed = await queueService.poll(10);
    expect(claimed.length).toBe(1);
    expect(claimed[0]!.type).toBe('sync_ad_metrics');
    expect(claimed[0]!.status).toBe('PROCESSING');
    expect(claimed[0]!.attempts).toBe(1);
  });

  it('simulates concurrent workers and guarantees zero collision claims', async () => {
    const past = new Date(Date.now() - 10000);
    for (let i = 0; i < 5; i++) {
      await queueService.schedule({
        type: 'cycle_autolist',
        payload: { listId: `list-${i}` },
        scheduledAt: past,
      });
    }

    // Two worker poll operations racing simultaneously
    const [workerAClaims, workerBClaims] = await Promise.all([
      queueService.poll(5),
      queueService.poll(5),
    ]);

    const allClaimedIds = [
      ...workerAClaims.map((j) => j.id),
      ...workerBClaims.map((j) => j.id),
    ];

    // Every claimed ID must be distinct (zero duplicate claims)
    const uniqueIds = new Set(allClaimedIds);
    expect(uniqueIds.size).toBe(allClaimedIds.length);
    expect(allClaimedIds.length).toBe(5);
  });

  it('implements exponential backoff on failure and transitions to FAILED at maxAttempts', async () => {
    const job = await queueService.schedule({
      type: 'send_drip_email',
      payload: { email: 'test@example.com' },
      maxAttempts: 3,
    });

    // Attempt 1 fails. A failure is only ever reported by the worker holding the claim, so
    // the row is PROCESSING at attempt 1 and the fence token matches.
    mockJobs[0]!.status = 'PROCESSING';
    mockJobs[0]!.attempts = 1;
    await queueService.fail(job.id, 1, 'Connection timeout');
    let current = await queueService.getJob(job.id);
    expect(current?.status).toBe('PENDING');
    expect(current?.lastError).toBe('Connection timeout');

    // Simulate poll incrementing attempt to 2
    mockJobs[0]!.status = 'PROCESSING';
    mockJobs[0]!.attempts = 2;
    await queueService.fail(job.id, 2, '503 Service Unavailable');
    current = await queueService.getJob(job.id);
    expect(current?.status).toBe('PENDING');

    // Simulate poll incrementing attempt to 3 (reaches maxAttempts)
    mockJobs[0]!.status = 'PROCESSING';
    mockJobs[0]!.attempts = 3;
    await queueService.fail(job.id, 3, 'Fatal authentication failure');
    current = await queueService.getJob(job.id);
    expect(current?.status).toBe('FAILED');
    expect(current?.lastError).toBe('Fatal authentication failure');
  });

  it('retries a failed job by resetting attempts and status to PENDING', async () => {
    const job = await queueService.schedule({
      type: 'publish_social_post',
      payload: {},
      maxAttempts: 1,
    });

    mockJobs[0]!.status = 'PROCESSING';
    mockJobs[0]!.attempts = 1;
    await queueService.fail(job.id, 1, 'Rate limit exceeded');
    expect((await queueService.getJob(job.id))?.status).toBe('FAILED');

    const retried = await queueService.retry(job.id);
    expect(retried.status).toBe('PENDING');
    expect(retried.attempts).toBe(0);
    expect(retried.lastError).toBeNull();
  });

  it('executes jobs via JobQueueWorkerService inside the job tenant context', async () => {
    let handlerExecutedWithTenant: string | null = null;

    queueService.registerHandler('publish_social_post', async (j) => {
      handlerExecutedWithTenant = tenancy.current()?.companyId ?? null;
    });

    await queueService.schedule({
      type: 'publish_social_post',
      payload: { text: 'Hello world' },
      scheduledAt: new Date(Date.now() - 1000),
    });

    // Run one tick of the worker
    const processed = await workerService.processNextBatch();
    expect(processed).toBe(1);
    expect(handlerExecutedWithTenant).toBe('company-1');

    const completed = await queueService.getJob('job-1');
    expect(completed?.status).toBe('COMPLETED');
  });

  it('reclaims a job whose worker died holding the lease, without resetting attempts', async () => {
    // Scheduled a little ahead, so the same tick that reclaims it does not immediately
    // re-claim it and obscure what the janitor wrote.
    await queueService.schedule({
      type: 'publish_social_post',
      payload: {},
      scheduledAt: new Date(Date.now() + 60_000),
      maxAttempts: 3,
    });

    // A worker claimed this and never came back.
    mockJobs[0]!.status = 'PROCESSING';
    mockJobs[0]!.attempts = 1;
    mockJobs[0]!.lockedAt = new Date(Date.now() - JOB_LEASE_MS - 1000);

    await queueService.poll(10);

    const reclaimed = await queueService.getJob('job-1');
    expect(reclaimed?.status).toBe('PENDING');
    // An expired lease is a spent attempt: a job that kills its worker must not retry forever.
    expect(reclaimed?.attempts).toBe(1);
    expect(reclaimed?.lockedAt).toBeNull();
    expect(reclaimed?.lastError).toContain('lease expired');
  });

  it('fails a reclaimed job outright once its attempts are spent', async () => {
    await queueService.schedule({ type: 'publish_social_post', payload: {}, maxAttempts: 2 });

    mockJobs[0]!.status = 'PROCESSING';
    mockJobs[0]!.attempts = 2;
    mockJobs[0]!.lockedAt = new Date(Date.now() - JOB_LEASE_MS - 1000);

    await queueService.poll(10);

    const dead = await queueService.getJob('job-1');
    expect(dead?.status).toBe('FAILED');
    expect(dead?.attempts).toBe(2);
  });

  it('leaves a job alone while its lease is still running', async () => {
    await queueService.schedule({ type: 'publish_social_post', payload: {}, maxAttempts: 3 });

    mockJobs[0]!.status = 'PROCESSING';
    mockJobs[0]!.attempts = 1;
    mockJobs[0]!.lockedAt = new Date(Date.now() - 1000);

    await queueService.poll(10);

    expect((await queueService.getJob('job-1'))?.status).toBe('PROCESSING');
  });

  it('fences a stale worker out of a job that was re-claimed under it', async () => {
    await queueService.schedule({ type: 'publish_social_post', payload: {}, maxAttempts: 5 });

    // The slow worker claimed attempt 1 and is still running.
    mockJobs[0]!.status = 'PROCESSING';
    mockJobs[0]!.attempts = 1;

    // Its lease expired and somebody else re-claimed it: attempt 2 is now in flight.
    mockJobs[0]!.attempts = 2;

    // The stale worker finally returns, holding the token it was given at claim time.
    await queueService.complete('job-1', 1);
    expect((await queueService.getJob('job-1'))?.status).toBe('PROCESSING');

    await queueService.fail('job-1', 1, 'the network call the stale worker made');
    const current = await queueService.getJob('job-1');
    expect(current?.status).toBe('PROCESSING');
    expect(current?.lastError).toBeNull();

    // The worker that actually holds the claim writes normally.
    await queueService.complete('job-1', 2);
    expect((await queueService.getJob('job-1'))?.status).toBe('COMPLETED');
  });

  it('executes a batch concurrently rather than one job after another', async () => {
    let inFlight = 0;
    let peak = 0;

    queueService.registerHandler('publish_social_post', async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
    });

    for (let i = 0; i < JOB_CONCURRENCY; i++) {
      await queueService.schedule({
        type: 'publish_social_post',
        payload: { i },
        scheduledAt: new Date(Date.now() - 1000),
      });
    }

    const processed = await workerService.processNextBatch(10);
    expect(processed).toBe(JOB_CONCURRENCY);
    expect(peak).toBeGreaterThan(1);
  });
});
