-- Ticket 14 phase 1: best-time-to-post insights and the per-brand snippet library.

CREATE TABLE "posting_time_insights" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "platform" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sample_size" INTEGER NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "buckets" JSONB NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "posting_time_insights_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "posting_time_insights_brand_id_platform_key" ON "posting_time_insights"("brand_id", "platform");
CREATE INDEX "posting_time_insights_company_id_idx" ON "posting_time_insights"("company_id");
CREATE INDEX "posting_time_insights_brand_id_idx" ON "posting_time_insights"("brand_id");

ALTER TABLE "posting_time_insights" ADD CONSTRAINT "posting_time_insights_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "marketing_brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "composer_snippets" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "composer_snippets_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "composer_snippets_company_id_idx" ON "composer_snippets"("company_id");
CREATE INDEX "composer_snippets_brand_id_idx" ON "composer_snippets"("brand_id");
CREATE INDEX "composer_snippets_company_id_label_idx" ON "composer_snippets"("company_id", "label");

ALTER TABLE "composer_snippets" ADD CONSTRAINT "composer_snippets_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "marketing_brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
