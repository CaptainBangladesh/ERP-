-- AlterTable
ALTER TABLE "products" ADD COLUMN     "code" TEXT NOT NULL,
ADD COLUMN     "cost" DECIMAL(14,2),
ADD COLUMN     "stockable" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "unit_id" UUID NOT NULL;

-- CreateTable
CREATE TABLE "unit_groups" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "unit_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "units_of_measure" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "group_id" UUID,
    "ratio" DECIMAL(24,12) NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "units_of_measure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_suppliers" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "party_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "unit_groups_company_id_idx" ON "unit_groups"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "unit_groups_company_id_name_key" ON "unit_groups"("company_id", "name");

-- CreateIndex
CREATE INDEX "units_of_measure_company_id_idx" ON "units_of_measure"("company_id");

-- CreateIndex
CREATE INDEX "units_of_measure_group_id_idx" ON "units_of_measure"("group_id");

-- CreateIndex
CREATE UNIQUE INDEX "units_of_measure_company_id_code_key" ON "units_of_measure"("company_id", "code");

-- CreateIndex
CREATE INDEX "product_suppliers_company_id_idx" ON "product_suppliers"("company_id");

-- CreateIndex
CREATE INDEX "product_suppliers_party_id_idx" ON "product_suppliers"("party_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_suppliers_product_id_party_id_key" ON "product_suppliers"("product_id", "party_id");

-- CreateIndex
CREATE INDEX "products_company_id_code_idx" ON "products"("company_id", "code");

-- CreateIndex
CREATE INDEX "products_unit_id_idx" ON "products"("unit_id");

-- CreateIndex
CREATE UNIQUE INDEX "products_company_id_code_key" ON "products"("company_id", "code");

-- AddForeignKey
ALTER TABLE "units_of_measure" ADD CONSTRAINT "units_of_measure_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "unit_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units_of_measure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_suppliers" ADD CONSTRAINT "product_suppliers_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

