-- Ticket 12: queue reaper index + insert-only smart link clicks.

-- The reaper scans PROCESSING rows whose lease has expired; without this it is a seq scan on
-- every poll tick.
CREATE INDEX IF NOT EXISTS "marketing_jobs_status_locked_at_idx"
  ON "marketing_jobs" ("status", "locked_at");

-- One row per click. Insert-only: no counter, no JSON array, nothing for two concurrent
-- clicks to lose each other on.
CREATE TABLE "smart_link_clicks" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "smart_link_id" UUID NOT NULL,
    "button_id" TEXT,
    "item_id" TEXT,
    "target_url" TEXT,
    "referer" TEXT,
    "clicked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "smart_link_clicks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "smart_link_clicks_company_id_idx" ON "smart_link_clicks"("company_id");
CREATE INDEX "smart_link_clicks_smart_link_id_idx" ON "smart_link_clicks"("smart_link_id");
CREATE INDEX "smart_link_clicks_smart_link_id_clicked_at_idx" ON "smart_link_clicks"("smart_link_id", "clicked_at");

ALTER TABLE "smart_link_clicks"
  ADD CONSTRAINT "smart_link_clicks_smart_link_id_fkey"
  FOREIGN KEY ("smart_link_id") REFERENCES "smart_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;
