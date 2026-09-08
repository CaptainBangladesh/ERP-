import { HttpStatus, type Logger } from '@nestjs/common';
import { MARKETING_ERROR_CODES } from '@erp/shared';
import { ApiException } from '../../http/api-exception';
import type { Tenancy } from '../../platform/tenancy';
import type { PostgresJobQueueService } from './postgres-job-queue.service';

/**
 * 16c's scheduling policy, written once.
 *
 * Feeds and competitors are the same machine with two payloads: a row an operator created, a
 * job type, and a promise that however many workers boot there is exactly one live job per
 * row. That policy was written out twice — the handler registration, the boot-time enqueue,
 * the `PENDING`/`PROCESSING` `findFirst`, the `withoutCompanyScope` → `runInCompany` loop and
 * the brand check, all near line for line — which means 16c had two implementations to keep in
 * step and would have had a third at the next external source.
 *
 * Nothing here is a second scheduling mechanism: it is the same queue, the same lease reaper
 * and the same `attempts` fence from 12.1a/12.1b. There is no cron and no `setInterval`.
 */
export interface RowJobPolicy {
  /** The queue's job type. */
  readonly type: string;
  /** The payload key holding the row's id — `feedId`, `competitorId`. */
  readonly key: string;
}

/** What this helper needs of a scoped Prisma client: the job table, nothing else. */
interface JobStore {
  marketingJob: {
    findFirst(args: {
      where: Record<string, unknown>;
      select?: Record<string, boolean>;
    }): Promise<{ id: string } | null>;
  };
}

/**
 * Schedule a poll for one row, unless one is already live.
 *
 * The check is what stops N deploys creating N pollers, and it is a query rather than a lock
 * because a duplicate here is wasteful rather than dangerous — the ingest and snapshot paths
 * are both idempotent by index, which is what makes that trade sound.
 */
export async function enqueueOnePerRow(
  prisma: JobStore,
  queue: PostgresJobQueueService,
  policy: RowJobPolicy,
  rowId: string,
  scheduledAt: Date,
): Promise<void> {
  const live = await prisma.marketingJob.findFirst({
    where: {
      type: policy.type,
      status: { in: ['PENDING', 'PROCESSING'] },
      payload: { path: [policy.key], equals: rowId },
    },
    select: { id: true },
  });
  if (live) return;

  await queue.schedule({
    type: policy.type,
    payload: { [policy.key]: rowId },
    scheduledAt,
  });
}

/**
 * The `onModuleInit` body: register the handler, then schedule what already exists.
 *
 * The boot-time pass is deliberately fire-and-forget with its own logged failure — a database
 * that is not ready yet must not take the application down with it, and the next deploy (or
 * the next row an operator creates) schedules the same work again.
 */
export function registerRowPoller(options: {
  queue: PostgresJobQueueService;
  policy: RowJobPolicy;
  logger: Logger;
  /** What one job does. */
  run: (rowId: string) => Promise<unknown>;
  /** Enqueues a poller for every existing row, across companies. */
  scheduleAll: () => Promise<void>;
  /** Named in the log line when the boot-time pass fails. */
  describe: string;
}): void {
  const { queue, policy, logger, run, scheduleAll, describe } = options;

  queue.registerHandler(policy.type, async (job) => {
    const rowId = job.payload[policy.key];
    if (typeof rowId === 'string') await run(rowId);
  });

  // A test drives the queue by hand; a boot-time enqueue there would schedule work no
  // assertion asked for and leave a live job every other test then has to reason about.
  if (process.env.NODE_ENV === 'test') return;

  void scheduleAll().catch((err: unknown) => {
    logger.error(
      `Could not schedule ${describe}: ${err instanceof Error ? err.message : String(err)}`,
    );
  });
}

/**
 * The two columns a scheduler needs: the row to poll, and the tenant to poll it as.
 *
 * Exported so the callers can spell their `select` without spelling `companyId` — the
 * conformance pack refuses a module that writes a company filter anywhere except code that
 * suspends scoping, and this file is that code. It is also the reason the select is not
 * hidden inside the helper: Prisma's delegate types are generic in their arguments, so a
 * findMany issued from here would lose the row type the caller's model gives it.
 */
export const SCHEDULER_SELECT = { id: true, companyId: true } as const;

/**
 * Enumerate rows across every company, then schedule each inside its own company's frame.
 *
 * The enumeration is the one read that has to cross tenants — nobody is signed in at boot —
 * and it is named, so the escape shows up in the tenancy audit as what it is. Everything the
 * scheduling itself touches runs back inside a company frame.
 */
export async function scheduleEveryRow(
  tenancy: Tenancy,
  scope: string,
  load: () => Promise<Array<{ id: string; companyId: string }>>,
  schedule: (rowId: string) => Promise<void>,
): Promise<void> {
  const rows = await tenancy.withoutCompanyScope(scope, load);

  for (const row of rows) {
    await tenancy.runInCompany({ companyId: row.companyId, grants: 'all' }, async () => {
      await schedule(row.id);
    });
  }
}

/** Both external sources hang off a brand, and both refuse the same way when it is not there. */
export async function requireBrand(
  prisma: { marketingBrand: { findFirst(args: { where: { id: string } }): Promise<unknown> } },
  brandId: string,
): Promise<void> {
  const brand = await prisma.marketingBrand.findFirst({ where: { id: brandId } });
  if (!brand) {
    throw new ApiException(
      MARKETING_ERROR_CODES.brandNotFound,
      'That brand does not exist.',
      HttpStatus.NOT_FOUND,
    );
  }
}
