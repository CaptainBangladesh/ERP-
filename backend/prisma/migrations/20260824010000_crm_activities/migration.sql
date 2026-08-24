-- CreateTable
CREATE TABLE "activities" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "notes" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "due_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_by_user_id" UUID NOT NULL,
    "created_by_name" TEXT NOT NULL,
    "lead_id" UUID,
    "deal_id" UUID,
    "party_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "activities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "activities_company_id_idx" ON "activities"("company_id");

-- CreateIndex
CREATE INDEX "activities_company_id_lead_id_occurred_at_idx" ON "activities"("company_id", "lead_id", "occurred_at");

-- CreateIndex
CREATE INDEX "activities_company_id_deal_id_occurred_at_idx" ON "activities"("company_id", "deal_id", "occurred_at");

-- CreateIndex
CREATE INDEX "activities_company_id_party_id_occurred_at_idx" ON "activities"("company_id", "party_id", "occurred_at");

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
