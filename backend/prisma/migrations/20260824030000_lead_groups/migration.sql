-- CreateTable
CREATE TABLE "lead_groups" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#579bfc',
    "order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_groups_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "leads" ADD COLUMN "group_id" UUID;

-- CreateIndex
CREATE INDEX "lead_groups_company_id_idx" ON "lead_groups"("company_id");

-- CreateIndex
CREATE INDEX "lead_groups_company_id_order_idx" ON "lead_groups"("company_id", "order");

-- CreateIndex
CREATE INDEX "leads_company_id_group_id_idx" ON "leads"("company_id", "group_id");

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "lead_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;
