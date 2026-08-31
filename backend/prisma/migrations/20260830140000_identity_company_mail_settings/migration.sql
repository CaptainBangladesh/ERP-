-- A company's own outgoing mail settings, so invitations and password resets can be
-- configured from inside the application rather than from the server's environment.
--
-- All nullable: a company that has set nothing falls back to whatever the deployment has
-- configured, which is how every existing company keeps working after this migration.
-- The password is stored encrypted (platform/secrets.ts), never as it was typed.
ALTER TABLE "companies"
  ADD COLUMN "mail_from_address" TEXT,
  ADD COLUMN "mail_from_name" TEXT,
  ADD COLUMN "mail_smtp_host" TEXT,
  ADD COLUMN "mail_smtp_port" INTEGER,
  ADD COLUMN "mail_smtp_secure" BOOLEAN,
  ADD COLUMN "mail_smtp_username" TEXT,
  ADD COLUMN "mail_smtp_password" TEXT;
