-- CreateTable
CREATE TABLE "parties" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "organisation_id" UUID,
    "merged_into_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "parties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "party_roles" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "party_id" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "party_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "party_addresses" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "party_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "line1" TEXT NOT NULL,
    "line2" TEXT,
    "city" TEXT NOT NULL,
    "postcode" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "party_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "parties_company_id_idx" ON "parties"("company_id");

-- CreateIndex
CREATE INDEX "parties_company_id_name_idx" ON "parties"("company_id", "name");

-- CreateIndex
CREATE INDEX "parties_organisation_id_idx" ON "parties"("organisation_id");

-- CreateIndex
CREATE INDEX "party_roles_company_id_idx" ON "party_roles"("company_id");

-- CreateIndex
CREATE INDEX "party_roles_company_id_role_idx" ON "party_roles"("company_id", "role");

-- CreateIndex
CREATE UNIQUE INDEX "party_roles_party_id_role_key" ON "party_roles"("party_id", "role");

-- CreateIndex
CREATE INDEX "party_addresses_company_id_idx" ON "party_addresses"("company_id");

-- CreateIndex
CREATE INDEX "party_addresses_party_id_idx" ON "party_addresses"("party_id");

-- AddForeignKey
ALTER TABLE "parties" ADD CONSTRAINT "parties_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "parties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parties" ADD CONSTRAINT "parties_merged_into_id_fkey" FOREIGN KEY ("merged_into_id") REFERENCES "parties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "party_roles" ADD CONSTRAINT "party_roles_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "party_addresses" ADD CONSTRAINT "party_addresses_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
