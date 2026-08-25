-- CreateTable
CREATE TABLE "campaigns" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "mailbox_connection_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "segment_config" JSONB NOT NULL DEFAULT '{}',
    "total_leads_count" INTEGER NOT NULL DEFAULT 0,
    "excluded_count" INTEGER NOT NULL DEFAULT 0,
    "sent_count" INTEGER NOT NULL DEFAULT 0,
    "opened_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_recipients" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "email_address" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "exclude_reason" TEXT,
    "sent_at" TIMESTAMP(3),
    "open_token" TEXT NOT NULL,
    "opened_at" TIMESTAMP(3),
    "open_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaign_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unsubscribes" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "email_address" TEXT NOT NULL,
    "campaign_id" UUID,
    "unsubscribed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "unsubscribes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "campaigns_company_id_idx" ON "campaigns"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_recipients_open_token_key" ON "campaign_recipients"("open_token");

-- CreateIndex
CREATE INDEX "campaign_recipients_company_id_idx" ON "campaign_recipients"("company_id");

-- CreateIndex
CREATE INDEX "campaign_recipients_campaign_id_idx" ON "campaign_recipients"("campaign_id");

-- CreateIndex
CREATE INDEX "campaign_recipients_lead_id_idx" ON "campaign_recipients"("lead_id");

-- CreateIndex
CREATE INDEX "unsubscribes_company_id_idx" ON "unsubscribes"("company_id");

-- CreateIndex
CREATE INDEX "unsubscribes_email_address_idx" ON "unsubscribes"("email_address");

-- CreateIndex
CREATE UNIQUE INDEX "unsubscribes_company_id_email_address_key" ON "unsubscribes"("company_id", "email_address");

-- AddForeignKey
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
