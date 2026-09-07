-- The planner & notes surfaces of Sales Enablement & Planning — the "where we put our intent"
-- layer, distinct from the activity timeline (which is history). Three ordinary company-scoped
-- tables: a lead's approach plan (one per lead), a rep's personal planner notes (one per rep),
-- and the team's shared plan (one per company). Nothing immutable — all edited in place.

-- CreateTable
CREATE TABLE "approach_plans" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "angle" TEXT,
    "decision_makers" TEXT,
    "objections" TEXT,
    "next_steps" TEXT,
    "notes" TEXT,
    "updated_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approach_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "planner_notes" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "planner_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_plans" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "team_plans_pkey" PRIMARY KEY ("id")
);

-- CreateUniqueIndex
CREATE UNIQUE INDEX "approach_plans_lead_id_key" ON "approach_plans"("lead_id");

-- CreateIndex
CREATE INDEX "approach_plans_company_id_idx" ON "approach_plans"("company_id");

-- CreateIndex
CREATE INDEX "planner_notes_company_id_idx" ON "planner_notes"("company_id");

-- CreateUniqueIndex
CREATE UNIQUE INDEX "planner_notes_company_id_user_id_key" ON "planner_notes"("company_id", "user_id");

-- CreateUniqueIndex
CREATE UNIQUE INDEX "team_plans_company_id_key" ON "team_plans"("company_id");

-- CreateIndex
CREATE INDEX "team_plans_company_id_idx" ON "team_plans"("company_id");

-- AddForeignKey
ALTER TABLE "approach_plans" ADD CONSTRAINT "approach_plans_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
