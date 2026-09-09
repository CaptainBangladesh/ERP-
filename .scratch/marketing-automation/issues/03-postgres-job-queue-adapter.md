# 03 — Postgres Job Queue Adapter

Type: task
Status: closed
Blocked by: 01

## Question

How should scheduled marketing tasks (post publishing, autolist cycling, metric syncing) be queued and processed with high concurrency using PostgreSQL without Redis?

### Requirements
- [x] 1. Define `IJobQueue` interface (schedule, cancel, poll).
- [x] 2. Create `MarketingJob` model in Prisma with columns: `id`, `companyId`, `type`, `payload`, `scheduledAt`, `status`, `attempts`, `lastError`.
- [x] 3. Add a partial index on `"MarketingJob"("scheduledAt") WHERE status = 'PENDING'`.
- [x] 4. Implement `PostgresJobQueueService` with atomic collision-free claim semantics conforming to ADR 0003 and check:tenancy.
- [x] 5. Create a background polling loop (`JobQueueWorkerService`) that executes pending jobs within their tenant scope and handles exponential backoff retries.

## Resolution

- Defined `IJobQueue` port in `backend/src/modules/marketing/job-queue.interface.ts` with `schedule`, `cancel`, `poll`, `complete`, `fail`, `retry`, `listJobs`, and `registerHandler`.
- Added `MarketingJob` model to `backend/prisma/schema.prisma` mapped to `marketing_jobs`, with company tenancy, status tracking, attempts, and error logging.
- Created migration `20260906140000_marketing_jobs_queue` including a partial index:
  `CREATE INDEX "marketing_jobs_scheduled_at_pending_idx" ON "marketing_jobs"("scheduled_at") WHERE status = 'PENDING';`
  and applied it to the PostgreSQL database.
- Classified `MarketingJob` as `{ kind: 'company-owned' }` in `backend/src/platform/tenancy/company-owned.ts` and registered it in `marketing.manifest.ts`.
- Implemented `PostgresJobQueueService` using PostgreSQL atomic conditional write:
  `UPDATE "marketing_jobs" SET status = 'PROCESSING', locked_at = NOW(), attempts = attempts + 1 WHERE id = $id AND status = 'PENDING'`.
  Ensures zero worker collisions and full compliance with `check:tenancy` (ADR 0003 / ADR 0009).
- Implemented `JobQueueWorkerService` providing background polling intervals and tenant-scoped task execution (`tenancy.runInCompany`), plus exponential backoff retries (`2^attempts * 10s`).
- Built `JobsController` (`@Controller(MARKETING_ROUTE)`) for monitoring, scheduling, cancelling, and retrying tasks, guarded with `marketing:jobs:read` and `marketing:jobs:write`.
- Built frontend `JobQueueMonitor` component integrated into `MarketingPage.tsx` under the "Queue & Tasks" tab, featuring live metric cards, real-time polling, and task actions.
- Verified 100% test pass rate across `test/job-queue.spec.ts` (7/7 passed), `MarketingPage.test.tsx` (7/7 passed), all 39 application suites (371/371 passed), and passed `check:modules`, `check:tenancy`, `check:conformance`, and `typecheck`.

