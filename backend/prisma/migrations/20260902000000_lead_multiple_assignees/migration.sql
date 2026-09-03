-- A Lead could be assigned to exactly one person — `assigned_to_user_id`. It can now be worked
-- by several at once, so ownership becomes a set of rows. The scalar column stays as the
-- *primary* owner (kept equal to the first assignee by `LeadsService.syncAssignees`), so every
-- single-owner read written before co-ownership keeps working untouched.
CREATE TABLE "lead_assignees" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_assignees_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "lead_assignees_lead_id_user_id_key" ON "lead_assignees"("lead_id", "user_id");
CREATE INDEX "lead_assignees_company_id_idx" ON "lead_assignees"("company_id");
CREATE INDEX "lead_assignees_company_id_lead_id_idx" ON "lead_assignees"("company_id", "lead_id");
CREATE INDEX "lead_assignees_company_id_user_id_idx" ON "lead_assignees"("company_id", "user_id");

ALTER TABLE "lead_assignees"
    ADD CONSTRAINT "lead_assignees_lead_id_fkey"
    FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: every lead that already has a primary owner gets that person as its first assignee,
-- so no existing assignment is lost and the set agrees with the scalar from day one.
INSERT INTO "lead_assignees" ("id", "company_id", "lead_id", "user_id", "created_at")
SELECT gen_random_uuid(), "company_id", "id", "assigned_to_user_id", CURRENT_TIMESTAMP
FROM "leads"
WHERE "assigned_to_user_id" IS NOT NULL;
