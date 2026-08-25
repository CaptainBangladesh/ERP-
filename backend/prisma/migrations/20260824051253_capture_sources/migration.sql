-- CreateTable
CREATE TABLE "capture_sources" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB NOT NULL,
    "default_source_id" UUID,
    "default_group_id" UUID,
    "default_assigned_to_user_id" UUID,
    "submission_count" INTEGER NOT NULL DEFAULT 0,
    "last_submission_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "capture_sources_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "capture_sources_token_key" ON "capture_sources"("token");

-- CreateIndex
CREATE INDEX "capture_sources_company_id_idx" ON "capture_sources"("company_id");
