-- Mailbox connections gain a second kind: SMTP, alongside the OAuth providers.
--
-- Every column is nullable because each kind uses one set and not the other -- an OAuth
-- mailbox has tokens and no host, an SMTP mailbox has a host and no tokens. The unique
-- constraint on (company, user, provider) is unchanged, so one person may hold one mailbox
-- per provider: a personal Gmail and a company SMTP account at the same time.
ALTER TABLE "mailbox_connections"
  ADD COLUMN "token_expires_at" TIMESTAMP(3),
  ADD COLUMN "smtp_host" TEXT,
  ADD COLUMN "smtp_port" INTEGER,
  ADD COLUMN "smtp_secure" BOOLEAN,
  ADD COLUMN "smtp_username" TEXT,
  -- Encrypted at rest, never the password as typed. See crm/mailbox-secrets.ts.
  ADD COLUMN "smtp_password" TEXT;
