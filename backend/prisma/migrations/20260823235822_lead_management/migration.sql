/*
  Warnings:

  - You are about to drop the `crm` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_reversed_movement_id_fkey";

-- AlterTable
ALTER TABLE "inventory_settings" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- DropTable
DROP TABLE "crm";

-- CreateTable
CREATE TABLE "leads" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "organisation_name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'new',
    "prior_status" TEXT,
    "assigned_to_user_id" UUID,
    "party_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "leads_company_id_idx" ON "leads"("company_id");

-- CreateIndex
CREATE INDEX "leads_company_id_name_idx" ON "leads"("company_id", "name");

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_reversed_movement_id_fkey" FOREIGN KEY ("reversed_movement_id") REFERENCES "stock_movements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
