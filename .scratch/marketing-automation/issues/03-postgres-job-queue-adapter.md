# 03 — Postgres Job Queue Adapter

Type: task
Status: open
Blocked by: 01

## Question

How should scheduled marketing tasks (post publishing, autolist cycling, metric syncing) be queued and processed with high concurrency using PostgreSQL without Redis?

### Requirements
1. Define `IJobQueue` interface (schedule, cancel, poll).
2. Create `MarketingJob` model in Prisma with columns: `id`, `companyId`, `type`, `payload`, `scheduledAt`, `status`, `attempts`, `lastError`.
3. Add a partial index on `"MarketingJob"("scheduledAt") WHERE status = 'PENDING'`.
4. Implement `PostgresJobQueueService` using raw query `SELECT ... FOR UPDATE SKIP LOCKED` to prevent worker collisions.
5. Create a background polling loop (NestJS scheduler / interval) that executes pending jobs and handles exponential backoff retries.
