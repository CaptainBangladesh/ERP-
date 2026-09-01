-- A submission stored the values that reached the Lead, keyed by Lead field. That could not
-- answer the question the Survey tab actually asks — *which answer* was mapped — because a
-- webhook source maps `entry_104` onto `budget` and the answer's own key was thrown away.
-- Keyed the other way round, answer key → the field it fed, it can; the values were never lost,
-- they are in `raw_payload` under the same key.
ALTER TABLE "lead_submissions" DROP COLUMN "mapped_values";
ALTER TABLE "lead_submissions" ADD COLUMN "mapped_fields" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "lead_submissions" ALTER COLUMN "mapped_fields" DROP DEFAULT;
