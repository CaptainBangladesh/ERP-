-- CreateTable
CREATE TABLE "mailbox_connections" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "email_address" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "access_token" TEXT,
    "refresh_token" TEXT,
    "connected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mailbox_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mailbox_auth_states" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "state_token" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mailbox_auth_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_templates" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mailbox_connections_company_id_idx" ON "mailbox_connections"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "mailbox_connections_company_id_user_id_provider_key" ON "mailbox_connections"("company_id", "user_id", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "mailbox_auth_states_state_token_key" ON "mailbox_auth_states"("state_token");

-- CreateIndex
CREATE INDEX "mailbox_auth_states_company_id_idx" ON "mailbox_auth_states"("company_id");

-- CreateIndex
CREATE INDEX "email_templates_company_id_idx" ON "email_templates"("company_id");
