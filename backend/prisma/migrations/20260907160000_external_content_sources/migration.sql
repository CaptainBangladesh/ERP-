-- Ticket 15: external content sources — RSS ingest (15.2) and competitor benchmarking (15.3).
-- The fetch guard (15.1) is code, not schema; what it protects is `content_feeds.url`.

CREATE TABLE "content_feeds" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "last_polled_at" TIMESTAMP(3),
    "last_success_at" TIMESTAMP(3),
    "last_reason" TEXT,
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_feeds_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "content_feeds_brand_id_url_key" ON "content_feeds"("brand_id", "url");
CREATE INDEX "content_feeds_company_id_idx" ON "content_feeds"("company_id");
CREATE INDEX "content_feeds_brand_id_idx" ON "content_feeds"("brand_id");

ALTER TABLE "content_feeds" ADD CONSTRAINT "content_feeds_brand_id_fkey"
    FOREIGN KEY ("brand_id") REFERENCES "marketing_brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "content_feed_entries" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "feed_id" UUID NOT NULL,
    "entry_key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "excerpt" TEXT NOT NULL,
    "link" TEXT NOT NULL,
    "enclosure_url" TEXT,
    "published_at" TIMESTAMP(3),
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_feed_entries_pkey" PRIMARY KEY ("id")
);

-- The whole dedupe mechanism (16b, 16g). Ingest is create-if-absent against this key.
CREATE UNIQUE INDEX "content_feed_entries_brand_id_feed_id_entry_key_key"
    ON "content_feed_entries"("brand_id", "feed_id", "entry_key");
CREATE INDEX "content_feed_entries_company_id_idx" ON "content_feed_entries"("company_id");
CREATE INDEX "content_feed_entries_brand_id_idx" ON "content_feed_entries"("brand_id");
CREATE INDEX "content_feed_entries_feed_id_idx" ON "content_feed_entries"("feed_id");

ALTER TABLE "content_feed_entries" ADD CONSTRAINT "content_feed_entries_feed_id_fkey"
    FOREIGN KEY ("feed_id") REFERENCES "content_feeds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "competitors" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "network" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "competitors_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "competitors_brand_id_network_handle_key"
    ON "competitors"("brand_id", "network", "handle");
CREATE INDEX "competitors_company_id_idx" ON "competitors"("company_id");
CREATE INDEX "competitors_brand_id_idx" ON "competitors"("brand_id");

ALTER TABLE "competitors" ADD CONSTRAINT "competitors_brand_id_fkey"
    FOREIGN KEY ("brand_id") REFERENCES "marketing_brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "competitor_snapshots" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "competitor_id" UUID NOT NULL,
    "network" TEXT NOT NULL,
    "capture_date" DATE NOT NULL,
    "follower_count" INTEGER,
    "post_count" INTEGER,
    "engagement_rate" DECIMAL(8,4),
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "competitor_snapshots_pkey" PRIMARY KEY ("id")
);

-- One snapshot per competitor per day (15f), enforced here rather than in the poller.
CREATE UNIQUE INDEX "competitor_snapshots_brand_id_competitor_id_network_capture_date_key"
    ON "competitor_snapshots"("brand_id", "competitor_id", "network", "capture_date");
CREATE INDEX "competitor_snapshots_company_id_idx" ON "competitor_snapshots"("company_id");
CREATE INDEX "competitor_snapshots_brand_id_idx" ON "competitor_snapshots"("brand_id");
CREATE INDEX "competitor_snapshots_captured_at_idx" ON "competitor_snapshots"("captured_at");

ALTER TABLE "competitor_snapshots" ADD CONSTRAINT "competitor_snapshots_competitor_id_fkey"
    FOREIGN KEY ("competitor_id") REFERENCES "competitors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "social_quota_reservations" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "social_account_id" UUID NOT NULL,
    "window_started_at" TIMESTAMP(3) NOT NULL,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_quota_reservations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "social_quota_reservations_social_account_id_key"
    ON "social_quota_reservations"("social_account_id");
CREATE INDEX "social_quota_reservations_company_id_idx" ON "social_quota_reservations"("company_id");

ALTER TABLE "social_quota_reservations" ADD CONSTRAINT "social_quota_reservations_social_account_id_fkey"
    FOREIGN KEY ("social_account_id") REFERENCES "social_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
