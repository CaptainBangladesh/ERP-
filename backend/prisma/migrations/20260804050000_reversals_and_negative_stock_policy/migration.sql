-- AlterTable
ALTER TABLE "stock_movements" ADD COLUMN "reversed_movement_id" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "stock_movements_reversed_movement_id_key" ON "stock_movements"("reversed_movement_id");

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_reversed_movement_id_fkey" FOREIGN KEY ("reversed_movement_id") REFERENCES "stock_movements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "inventory_settings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "allow_negative_stock" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "inventory_settings_company_id_key" ON "inventory_settings"("company_id");

-- AddForeignKey
ALTER TABLE "inventory_settings" ADD CONSTRAINT "inventory_settings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
