-- CreateTable
CREATE TABLE "lead_capture_forms" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "schema_fields" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "embed_code" TEXT,
    "submit_count" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_capture_forms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_capture_submissions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "form_id" UUID NOT NULL,
    "raw_payload" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "mapped_fields" JSONB,
    "utm_source" TEXT,
    "utm_medium" TEXT,
    "utm_campaign" TEXT,
    "utm_term" TEXT,
    "utm_content" TEXT,
    "crm_lead_id" UUID,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_capture_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nurture_sequences" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "trigger_event" TEXT NOT NULL,
    "steps" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nurture_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lead_capture_forms_company_id_idx" ON "lead_capture_forms"("company_id");
CREATE INDEX "lead_capture_forms_brand_id_idx" ON "lead_capture_forms"("brand_id");

-- CreateIndex
CREATE INDEX "lead_capture_submissions_company_id_idx" ON "lead_capture_submissions"("company_id");
CREATE INDEX "lead_capture_submissions_form_id_idx" ON "lead_capture_submissions"("form_id");

-- CreateIndex
CREATE INDEX "nurture_sequences_company_id_idx" ON "nurture_sequences"("company_id");
CREATE INDEX "nurture_sequences_brand_id_idx" ON "nurture_sequences"("brand_id");

-- AddForeignKey
ALTER TABLE "lead_capture_forms" ADD CONSTRAINT "lead_capture_forms_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "marketing_brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_capture_submissions" ADD CONSTRAINT "lead_capture_submissions_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "lead_capture_forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nurture_sequences" ADD CONSTRAINT "nurture_sequences_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "marketing_brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
