-- CreateTable
CREATE TABLE "marketing" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "marketing_company_id_idx" ON "marketing"("company_id");

-- CreateIndex
CREATE INDEX "marketing_company_id_name_idx" ON "marketing"("company_id", "name");
