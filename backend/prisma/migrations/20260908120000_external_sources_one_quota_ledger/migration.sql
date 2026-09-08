-- Ticket 15 follow-ups: one quota ledger, and a feed entry that actually reaches a person.
--
-- Two corrections to 20260907160000, both of which are about a promise the schema did not keep.
--
-- 1. `social_quota_reservations` was a counter no publishing path ever read, so a benchmark
--    read never shrank the 50/24h budget 15b says it shares. It is replaced by
--    `social_quota_ledger`, which `publishing-quota.ts` adds to the posts it counts — one
--    total behind the publish guard, the account screen and a snapshot's reservation.
-- 2. 16b says an entry can never produce a second `ScheduledPost`; there was no such column
--    and no such index, because nothing created a post at all. The provenance 16h asks for
--    (feed, entry key, canonical link, fetch timestamp) lands on `scheduled_posts`, and the
--    unique index over it is what makes the ingest create-if-absent.

DROP TABLE "social_quota_reservations";

CREATE TABLE "social_quota_ledger" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "social_account_id" UUID NOT NULL,
    "window_started_at" TIMESTAMP(3) NOT NULL,
    "competitor_reads" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_quota_ledger_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "social_quota_ledger_social_account_id_key"
    ON "social_quota_ledger"("social_account_id");
CREATE INDEX "social_quota_ledger_company_id_idx" ON "social_quota_ledger"("company_id");

ALTER TABLE "social_quota_ledger" ADD CONSTRAINT "social_quota_ledger_social_account_id_fkey"
    FOREIGN KEY ("social_account_id") REFERENCES "social_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "scheduled_posts" ADD COLUMN "source_feed_id" UUID;
ALTER TABLE "scheduled_posts" ADD COLUMN "source_entry_key" TEXT;
ALTER TABLE "scheduled_posts" ADD COLUMN "source_link" TEXT;
ALTER TABLE "scheduled_posts" ADD COLUMN "source_fetched_at" TIMESTAMP(3);

-- 16b's "never a second `ScheduledPost` for the same entry", as a constraint. Rows a person
-- wrote carry NULLs here, and Postgres does not consider two NULLs equal, so they are
-- untouched by it.
CREATE UNIQUE INDEX "scheduled_posts_brand_id_source_feed_id_source_entry_key_key"
    ON "scheduled_posts"("brand_id", "source_feed_id", "source_entry_key");

-- An entry waits for an account to be drafted against rather than pretending it already has
-- one. Existing rows predate the drafting path entirely, so they start where it starts.
ALTER TABLE "content_feed_entries" ALTER COLUMN "status" SET DEFAULT 'AWAITING_ACCOUNT';
UPDATE "content_feed_entries" SET "status" = 'AWAITING_ACCOUNT' WHERE "status" = 'DRAFT';
