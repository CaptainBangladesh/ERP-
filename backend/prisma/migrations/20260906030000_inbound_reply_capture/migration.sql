-- The inbound half of lead email. `lead_email_receipts` records a reply received into the
-- company mailbox and matched to a lead; it is also the dedup key — one row per Message-ID per
-- company — so re-polling the same message never doubles a Timeline entry. `inbound_mail_cursors`
-- remembers where each company's last poll stopped (an IMAP UID), so the next read fetches only
-- what arrived after it rather than re-reading the mailbox from the top.

CREATE TABLE "lead_email_receipts" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "activity_id" UUID,
    "message_id" TEXT NOT NULL,
    "from_address" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_email_receipts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "lead_email_receipts_company_id_idx" ON "lead_email_receipts"("company_id");

CREATE INDEX "lead_email_receipts_company_id_lead_id_idx" ON "lead_email_receipts"("company_id", "lead_id");

CREATE UNIQUE INDEX "lead_email_receipts_company_id_message_id_key" ON "lead_email_receipts"("company_id", "message_id");

ALTER TABLE "lead_email_receipts" ADD CONSTRAINT "lead_email_receipts_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "inbound_mail_cursors" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "last_seen_uid" INTEGER NOT NULL DEFAULT 0,
    "last_polled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inbound_mail_cursors_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "inbound_mail_cursors_company_id_key" ON "inbound_mail_cursors"("company_id");
