-- CreateTable
CREATE TABLE "social_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "social_account_id" UUID,
    "conversation_id" TEXT NOT NULL,
    "sender_id" TEXT NOT NULL,
    "sender_name" TEXT,
    "sender_avatar" TEXT,
    "recipient_id" TEXT,
    "content" TEXT NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'inbound',
    "status" TEXT NOT NULL DEFAULT 'unread',
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dm_automation_flows" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "social_account_id" UUID,
    "name" TEXT NOT NULL,
    "trigger_keyword" TEXT NOT NULL,
    "match_type" TEXT NOT NULL DEFAULT 'EXACT',
    "response_template" TEXT NOT NULL,
    "lead_magnet_url" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "trigger_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dm_automation_flows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "social_messages_company_id_idx" ON "social_messages"("company_id");
CREATE INDEX "social_messages_brand_id_idx" ON "social_messages"("brand_id");
CREATE INDEX "social_messages_conversation_id_idx" ON "social_messages"("conversation_id");
CREATE INDEX "social_messages_social_account_id_idx" ON "social_messages"("social_account_id");
CREATE INDEX "social_messages_status_idx" ON "social_messages"("status");

-- CreateIndex
CREATE INDEX "dm_automation_flows_company_id_idx" ON "dm_automation_flows"("company_id");
CREATE INDEX "dm_automation_flows_brand_id_idx" ON "dm_automation_flows"("brand_id");
CREATE INDEX "dm_automation_flows_trigger_keyword_idx" ON "dm_automation_flows"("trigger_keyword");

-- AddForeignKey
ALTER TABLE "social_messages" ADD CONSTRAINT "social_messages_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "marketing_brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "social_messages" ADD CONSTRAINT "social_messages_social_account_id_fkey" FOREIGN KEY ("social_account_id") REFERENCES "social_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dm_automation_flows" ADD CONSTRAINT "dm_automation_flows_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "marketing_brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
