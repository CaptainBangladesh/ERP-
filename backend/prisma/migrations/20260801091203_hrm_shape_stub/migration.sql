-- CreateTable
CREATE TABLE "employees" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "annual_salary" DECIMAL(14,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pay_runs" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "calculated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pay_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pay_run_lines" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "pay_run_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "gross_pay" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "pay_run_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "employees_company_id_idx" ON "employees"("company_id");

-- CreateIndex
CREATE INDEX "pay_runs_company_id_idx" ON "pay_runs"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "pay_runs_company_id_period_start_period_end_key" ON "pay_runs"("company_id", "period_start", "period_end");

-- CreateIndex
CREATE INDEX "pay_run_lines_company_id_idx" ON "pay_run_lines"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "pay_run_lines_pay_run_id_employee_id_key" ON "pay_run_lines"("pay_run_id", "employee_id");

-- AddForeignKey
ALTER TABLE "pay_run_lines" ADD CONSTRAINT "pay_run_lines_pay_run_id_fkey" FOREIGN KEY ("pay_run_id") REFERENCES "pay_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pay_run_lines" ADD CONSTRAINT "pay_run_lines_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
