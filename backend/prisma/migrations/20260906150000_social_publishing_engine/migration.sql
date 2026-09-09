-- CreateTable
CREATE TABLE "scheduled_posts" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "social_account_id" UUID NOT NULL,
    "campaign_id" UUID,
    "autolist_item_id" UUID,
    "content" TEXT NOT NULL,
    "media_urls" JSONB,
    "platform_config" JSONB,
    "scheduled_at" TIMESTAMP(3) NOT NULL,
    "published_at" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "failure_reason" TEXT,
    "external_post_id" TEXT,
    "metrics" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduled_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "autolists" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "repeat_mode" TEXT NOT NULL DEFAULT 'RECYCLE',
    "traversal_mode" TEXT NOT NULL DEFAULT 'FIFO',
    "active_slots" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "collision_window_minutes" INTEGER NOT NULL DEFAULT 90,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "autolists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "autolist_items" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "autolist_id" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "media_urls" JSONB,
    "platform_config" JSONB,
    "order_index" INTEGER NOT NULL DEFAULT 0,
    "publish_count" INTEGER NOT NULL DEFAULT 0,
    "last_published_at" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "autolist_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "scheduled_posts_company_id_idx" ON "scheduled_posts"("company_id");

-- CreateIndex
CREATE INDEX "scheduled_posts_brand_id_idx" ON "scheduled_posts"("brand_id");

-- CreateIndex
CREATE INDEX "scheduled_posts_social_account_id_idx" ON "scheduled_posts"("social_account_id");

-- CreateIndex
CREATE INDEX "scheduled_posts_status_scheduled_at_idx" ON "scheduled_posts"("status", "scheduled_at");

-- CreateIndex
CREATE INDEX "autolists_company_id_idx" ON "autolists"("company_id");

-- CreateIndex
CREATE INDEX "autolists_brand_id_idx" ON "autolists"("brand_id");

-- CreateIndex
CREATE INDEX "autolist_items_company_id_idx" ON "autolist_items"("company_id");

-- CreateIndex
CREATE INDEX "autolist_items_autolist_id_idx" ON "autolist_items"("autolist_id");

-- AddForeignKey
ALTER TABLE "scheduled_posts" ADD CONSTRAINT "scheduled_posts_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "marketing_brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_posts" ADD CONSTRAINT "scheduled_posts_social_account_id_fkey" FOREIGN KEY ("social_account_id") REFERENCES "social_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_posts" ADD CONSTRAINT "scheduled_posts_autolist_item_id_fkey" FOREIGN KEY ("autolist_item_id") REFERENCES "autolist_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "autolists" ADD CONSTRAINT "autolists_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "marketing_brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "autolist_items" ADD CONSTRAINT "autolist_items_autolist_id_fkey" FOREIGN KEY ("autolist_id") REFERENCES "autolists"("id") ON DELETE CASCADE ON UPDATE CASCADE;
