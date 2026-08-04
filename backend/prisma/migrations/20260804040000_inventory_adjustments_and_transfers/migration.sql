-- AlterTable
ALTER TABLE "stock_movements" ADD COLUMN "reason" TEXT,
ADD COLUMN "transfer_id" UUID;

-- CreateIndex
CREATE INDEX "stock_movements_company_id_transfer_id_idx" ON "stock_movements"("company_id", "transfer_id");
