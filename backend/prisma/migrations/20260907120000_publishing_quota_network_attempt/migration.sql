-- A publish attempt that reached the platform spent its quota, whether or not it succeeded.
-- Recorded, so the rolling window can count it instead of guessing from the failure message.
ALTER TABLE "scheduled_posts" ADD COLUMN "network_attempted_at" TIMESTAMP(3);

-- The quota query: one account, published or network-attempted, inside a rolling window.
CREATE INDEX "scheduled_posts_social_account_id_status_published_at_idx"
  ON "scheduled_posts"("social_account_id", "status", "published_at");
