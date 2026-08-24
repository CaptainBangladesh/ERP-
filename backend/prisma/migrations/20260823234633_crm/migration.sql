-- CreateTable
CREATE TABLE "crm" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "crm_company_id_idx" ON "crm"("company_id");

-- CreateIndex
CREATE INDEX "crm_company_id_name_idx" ON "crm"("company_id", "name");
