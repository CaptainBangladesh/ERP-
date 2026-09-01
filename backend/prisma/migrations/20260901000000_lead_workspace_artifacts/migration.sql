-- Everything that happens to a lead is an artifact of that lead, so each gets a table it can
-- be found in: a file with real bytes behind it, a capture-form response with every answer it
-- carried, and a 1:1 send with whatever its tracking pixel has since reported.

-- CreateTable
CREATE TABLE "lead_attachments" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "filename" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "storage_key" TEXT NOT NULL,
    "uploaded_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_submissions" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "capture_source_id" UUID,
    "form_name" TEXT NOT NULL,
    "raw_payload" JSONB NOT NULL,
    "mapped_values" JSONB NOT NULL,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_email_sends" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "activity_id" UUID,
    "sent_by_user_id" UUID NOT NULL,
    "subject" TEXT NOT NULL,
    "open_token" TEXT NOT NULL,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "opened_at" TIMESTAMP(3),
    "open_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "lead_email_sends_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lead_attachments_company_id_idx" ON "lead_attachments"("company_id");

-- CreateIndex
CREATE INDEX "lead_attachments_company_id_lead_id_idx" ON "lead_attachments"("company_id", "lead_id");

-- CreateIndex
CREATE INDEX "lead_submissions_company_id_idx" ON "lead_submissions"("company_id");

-- CreateIndex
CREATE INDEX "lead_submissions_company_id_lead_id_idx" ON "lead_submissions"("company_id", "lead_id");

-- CreateIndex
CREATE INDEX "lead_email_sends_company_id_idx" ON "lead_email_sends"("company_id");

-- CreateIndex
CREATE INDEX "lead_email_sends_company_id_lead_id_idx" ON "lead_email_sends"("company_id", "lead_id");

-- The pixel is fetched with no session, so the token is the only way back to the send.
-- CreateIndex
CREATE UNIQUE INDEX "lead_email_sends_open_token_key" ON "lead_email_sends"("open_token");

-- AddForeignKey
ALTER TABLE "lead_attachments" ADD CONSTRAINT "lead_attachments_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_submissions" ADD CONSTRAINT "lead_submissions_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_email_sends" ADD CONSTRAINT "lead_email_sends_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
