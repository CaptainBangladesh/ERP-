-- Ticket 14 phase 2: metered generation — the allowance counter, the append-only ledger,
-- the tenant's own key, and the two brand-voice columns the prompt allowlist reads.

ALTER TABLE "marketing_brands" ADD COLUMN "voice_tone" TEXT;
ALTER TABLE "marketing_brands" ADD COLUMN "product_description" TEXT;

CREATE TABLE "ai_generation_allowances" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "period" TEXT NOT NULL,
    "cap_cents" DECIMAL(12,4) NOT NULL,
    "spent_cents" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_generation_allowances_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ai_generation_allowances_company_id_period_key" ON "ai_generation_allowances"("company_id", "period");
CREATE INDEX "ai_generation_allowances_company_id_idx" ON "ai_generation_allowances"("company_id");

CREATE TABLE "ai_generation_ledger" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "brand_id" UUID,
    "user_id" UUID,
    "period" TEXT NOT NULL,
    "entry" TEXT NOT NULL,
    "amount_cents" DECIMAL(12,4) NOT NULL,
    "model" TEXT NOT NULL,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "latency_ms" INTEGER NOT NULL DEFAULT 0,
    "outcome" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_generation_ledger_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_generation_ledger_company_id_idx" ON "ai_generation_ledger"("company_id");
CREATE INDEX "ai_generation_ledger_company_id_period_idx" ON "ai_generation_ledger"("company_id", "period");

CREATE TABLE "tenant_ai_keys" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "encrypted_key" TEXT NOT NULL,
    "masked_key" TEXT NOT NULL,
    "created_by_user_id" UUID,
    "last_validated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_ai_keys_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tenant_ai_keys_company_id_key" ON "tenant_ai_keys"("company_id");
CREATE INDEX "tenant_ai_keys_company_id_idx" ON "tenant_ai_keys"("company_id");
