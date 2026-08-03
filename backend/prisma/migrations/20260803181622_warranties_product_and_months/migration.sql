/*
  Warnings:

  - You are about to drop the column `name` on the `warranties` table. All the data in the column will be lost.
  - Added the required column `months` to the `warranties` table without a default value. This is not possible if the table is not empty.
  - Added the required column `product_id` to the `warranties` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "warranties_company_id_name_idx";

-- AlterTable
ALTER TABLE "warranties" DROP COLUMN "name",
ADD COLUMN     "months" INTEGER NOT NULL,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "product_id" UUID NOT NULL;

-- CreateIndex
CREATE INDEX "warranties_company_id_created_at_idx" ON "warranties"("company_id", "created_at");

-- CreateIndex
CREATE INDEX "warranties_company_id_product_id_idx" ON "warranties"("company_id", "product_id");
