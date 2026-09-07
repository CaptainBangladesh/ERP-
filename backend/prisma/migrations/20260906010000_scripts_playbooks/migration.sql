-- The content-and-guidance track: a company's spoken scripts, the playbooks that sequence them,
-- and the per-lead pointer that walks a rep through a play. Scripts are distinct from
-- email_templates (which are for sending) and carry the same merge-tags. Nothing here is
-- immutable — editing a script, reordering a play, or advancing a lead's position are ordinary
-- edits — and everything is company-scoped like the rest of crm.

-- CreateTable
CREATE TABLE "scripts" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "lead_status" TEXT,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scripts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "playbooks" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "playbooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "playbook_steps" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "playbook_id" UUID NOT NULL,
    "order" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "instruction" TEXT NOT NULL,
    "script_id" UUID,
    "activity_type" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "playbook_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "playbook_enrollments" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "playbook_id" UUID NOT NULL,
    "completed_steps" INTEGER NOT NULL DEFAULT 0,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "playbook_enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "scripts_company_id_idx" ON "scripts"("company_id");

-- CreateIndex
CREATE INDEX "playbooks_company_id_idx" ON "playbooks"("company_id");

-- CreateIndex
CREATE INDEX "playbook_steps_company_id_idx" ON "playbook_steps"("company_id");

-- CreateIndex
CREATE INDEX "playbook_steps_playbook_id_order_idx" ON "playbook_steps"("playbook_id", "order");

-- CreateIndex
CREATE INDEX "playbook_enrollments_company_id_idx" ON "playbook_enrollments"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "playbook_enrollments_company_id_lead_id_key" ON "playbook_enrollments"("company_id", "lead_id");

-- AddForeignKey
ALTER TABLE "playbook_steps" ADD CONSTRAINT "playbook_steps_playbook_id_fkey" FOREIGN KEY ("playbook_id") REFERENCES "playbooks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playbook_steps" ADD CONSTRAINT "playbook_steps_script_id_fkey" FOREIGN KEY ("script_id") REFERENCES "scripts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playbook_enrollments" ADD CONSTRAINT "playbook_enrollments_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playbook_enrollments" ADD CONSTRAINT "playbook_enrollments_playbook_id_fkey" FOREIGN KEY ("playbook_id") REFERENCES "playbooks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
