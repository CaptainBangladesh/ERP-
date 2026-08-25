-- Board organisation for Leads: a company-owned source vocabulary, per-company status labels,
-- custom field definitions, and the JSON column their values live in.
--
-- The one step here that is not shape is the `lead_sources` backfill below. `leads.source` held
-- one of five strings fixed at ship time; this turns each company's *own* distinct values into
-- rows and repoints its Leads at them. A company that only ever used 'inbound' ends up with one
-- source, not five: nobody is seeded with a vocabulary they did not already use, and nobody
-- loses the attribution they had.

-- CreateTable
CREATE TABLE "lead_sources" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_status_labels" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_status_labels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_field_definitions" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "options" JSONB NOT NULL DEFAULT '[]',
    "required" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_field_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lead_sources_company_id_idx" ON "lead_sources"("company_id");

-- CreateIndex
CREATE INDEX "lead_sources_company_id_order_idx" ON "lead_sources"("company_id", "order");

-- CreateIndex
CREATE INDEX "lead_status_labels_company_id_idx" ON "lead_status_labels"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "lead_status_labels_company_id_status_key" ON "lead_status_labels"("company_id", "status");

-- CreateIndex
CREATE INDEX "lead_field_definitions_company_id_idx" ON "lead_field_definitions"("company_id");

-- CreateIndex
CREATE INDEX "lead_field_definitions_company_id_order_idx" ON "lead_field_definitions"("company_id", "order");

-- CreateIndex
CREATE UNIQUE INDEX "lead_field_definitions_company_id_key_key" ON "lead_field_definitions"("company_id", "key");

-- AlterTable
ALTER TABLE "leads" ADD COLUMN "source_id" UUID,
ADD COLUMN "custom_values" JSONB NOT NULL DEFAULT '{}';

-- Backfill: each company's own distinct `leads.source` strings become its `lead_sources` rows,
-- ordered alphabetically so the resulting vocabulary is stable rather than insertion-dependent.
INSERT INTO "lead_sources" ("id", "company_id", "name", "order", "created_at", "updated_at")
SELECT
    gen_random_uuid(),
    distinct_sources."company_id",
    distinct_sources."source",
    ROW_NUMBER() OVER (PARTITION BY distinct_sources."company_id" ORDER BY distinct_sources."source"),
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM (SELECT DISTINCT "company_id", "source" FROM "leads") AS distinct_sources;

-- Backfill: repoint every Lead at the row its own string became, within its own company.
UPDATE "leads"
SET "source_id" = "lead_sources"."id"
FROM "lead_sources"
WHERE "lead_sources"."company_id" = "leads"."company_id"
  AND "lead_sources"."name" = "leads"."source";

-- AlterTable
ALTER TABLE "leads" DROP COLUMN "source";

-- CreateIndex
CREATE INDEX "leads_company_id_source_id_idx" ON "leads"("company_id", "source_id");

-- CreateIndex
CREATE INDEX "leads_company_id_created_at_idx" ON "leads"("company_id", "created_at");

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "lead_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A group's position is assigned by the service on every write, never defaulted: a board where
-- two groups both claim position 0 is the shape the default invited.
ALTER TABLE "lead_groups" ALTER COLUMN "order" DROP DEFAULT;

-- `SetNull` would silently empty a Lead's group on a delete that `LeadGroupsService` already
-- refuses. `Restrict` makes the unreachable path unreachable in the database too, matching the
-- Deal/Stage relation.
ALTER TABLE "leads" DROP CONSTRAINT "leads_group_id_fkey";
ALTER TABLE "leads" ADD CONSTRAINT "leads_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "lead_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
