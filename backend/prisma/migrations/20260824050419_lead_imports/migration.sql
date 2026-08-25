-- CreateTable
CREATE TABLE "lead_imports" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "filename" TEXT NOT NULL,
    "row_count" INTEGER NOT NULL,
    "accepted_count" INTEGER NOT NULL,
    "imported_by_user_id" UUID NOT NULL,
    "imported_by_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_imports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lead_imports_company_id_idx" ON "lead_imports"("company_id");
