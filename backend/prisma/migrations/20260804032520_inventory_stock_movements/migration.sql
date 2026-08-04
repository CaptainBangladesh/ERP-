-- CreateTable
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "classification" TEXT NOT NULL,
    "product_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "quantity" DECIMAL(24,6) NOT NULL,
    "unit_code" TEXT NOT NULL,
    "unit_cost" DECIMAL(14,2),
    "value" DECIMAL(14,2),
    "recorded_by_id" UUID NOT NULL,
    "recorded_by_name" TEXT NOT NULL,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_levels" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "quantity" DECIMAL(24,6) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_levels_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_movements_company_id_idx" ON "stock_movements"("company_id");

-- CreateIndex
CREATE INDEX "stock_movements_company_id_recorded_at_idx" ON "stock_movements"("company_id", "recorded_at");

-- CreateIndex
CREATE INDEX "stock_movements_company_id_product_id_recorded_at_idx" ON "stock_movements"("company_id", "product_id", "recorded_at");

-- CreateIndex
CREATE INDEX "stock_movements_company_id_location_id_recorded_at_idx" ON "stock_movements"("company_id", "location_id", "recorded_at");

-- CreateIndex
CREATE INDEX "stock_levels_company_id_idx" ON "stock_levels"("company_id");

-- CreateIndex
CREATE INDEX "stock_levels_company_id_location_id_idx" ON "stock_levels"("company_id", "location_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_levels_company_id_product_id_location_id_key" ON "stock_levels"("company_id", "product_id", "location_id");

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
