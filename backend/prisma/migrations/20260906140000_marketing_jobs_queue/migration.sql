-- CreateTable
CREATE TABLE "marketing_jobs" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "scheduled_at" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "last_error" TEXT,
    "locked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketing_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "marketing_jobs_company_id_idx" ON "marketing_jobs"("company_id");

-- CreateIndex
CREATE INDEX "marketing_jobs_status_scheduled_at_idx" ON "marketing_jobs"("status", "scheduled_at");

-- CreatePartialIndex for rapid queue polling
CREATE INDEX "marketing_jobs_scheduled_at_pending_idx" ON "marketing_jobs"("scheduled_at") WHERE status = 'PENDING';
