-- The Timeline shows one email-open entry whose count climbs, rather than one entry per fetch:
-- Apple Mail Privacy Protection pre-fetches, so an entry per fetch would bury the history it is
-- part of. Raising the count means finding the entry again, which means remembering it.
ALTER TABLE "lead_email_sends" ADD COLUMN "open_activity_id" UUID;
