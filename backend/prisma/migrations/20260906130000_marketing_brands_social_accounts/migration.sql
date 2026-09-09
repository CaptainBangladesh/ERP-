-- CreateTable
CREATE TABLE "marketing_brands" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "logo_url" TEXT,
    "brand_colors" JSONB,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "custom_domain" TEXT,
    "storage_quota_mb" INTEGER NOT NULL DEFAULT 1000,
    "settings" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketing_brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brand_members" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'editor',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brand_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_accounts" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "platform" TEXT NOT NULL,
    "account_name" TEXT NOT NULL,
    "platform_account_id" TEXT NOT NULL,
    "encrypted_access_token" TEXT NOT NULL,
    "encrypted_refresh_token" TEXT,
    "token_expires_at" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'active',
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "marketing_brands_company_id_slug_key" ON "marketing_brands"("company_id", "slug");

-- CreateIndex
CREATE INDEX "marketing_brands_company_id_idx" ON "marketing_brands"("company_id");

-- CreateIndex
CREATE INDEX "marketing_brands_company_id_name_idx" ON "marketing_brands"("company_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "brand_members_brand_id_user_id_key" ON "brand_members"("brand_id", "user_id");

-- CreateIndex
CREATE INDEX "brand_members_company_id_idx" ON "brand_members"("company_id");

-- CreateIndex
CREATE INDEX "brand_members_brand_id_idx" ON "brand_members"("brand_id");

-- CreateIndex
CREATE INDEX "brand_members_user_id_idx" ON "brand_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "social_accounts_brand_id_platform_platform_account_id_key" ON "social_accounts"("brand_id", "platform", "platform_account_id");

-- CreateIndex
CREATE INDEX "social_accounts_company_id_idx" ON "social_accounts"("company_id");

-- CreateIndex
CREATE INDEX "social_accounts_brand_id_idx" ON "social_accounts"("brand_id");

-- AddForeignKey
ALTER TABLE "brand_members" ADD CONSTRAINT "brand_members_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "marketing_brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "marketing_brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
