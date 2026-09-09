import { Logger } from '@nestjs/common';

const logger = new Logger('SmtpRelay');

export interface SmtpRelayConfig {
  host: string;
  port: number;
  secure?: boolean;
  username?: string;
  password?: string;
}

export interface SmtpRelayMessage {
  from: string;
  to: string;
  subject: string;
  body?: string;
  html?: string;
}

export function isSmtpRelayConfigured(): boolean {
  return Boolean(process.env.SMTP_RELAY_URL);
}

function getRelayHeaders(): Record<string, string> {
  const secret = process.env.SMTP_RELAY_SECRET || process.env.SESSION_SECRET;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (secret) {
    headers['x-relay-secret'] = secret;
  }
  return headers;
}

export async function verifyThroughRelay(smtp: SmtpRelayConfig): Promise<void> {
  const url = process.env.SMTP_RELAY_URL!;
  logger.log(`Verifying SMTP connection for ${smtp.username || 'user'}@${smtp.host} via relay ${url}`);

  const response = await fetch(url, {
    method: 'POST',
    headers: getRelayHeaders(),
    body: JSON.stringify({
      action: 'verify',
      smtp,
    }),
  }).catch((err) => {
    throw new Error(
      `Could not reach Vercel SMTP relay at ${url}: ${err instanceof Error ? err.message : String(err)}`,
    );
  });

  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || `SMTP relay refused connection verification (HTTP ${response.status})`);
  }
}

export async function sendThroughRelay(smtp: SmtpRelayConfig, message: SmtpRelayMessage): Promise<void> {
  const url = process.env.SMTP_RELAY_URL!;
  logger.log(`Sending email "${message.subject}" to ${message.to} via relay ${url}`);

  const response = await fetch(url, {
    method: 'POST',
    headers: getRelayHeaders(),
    body: JSON.stringify({
      action: 'send',
      smtp,
      message,
    }),
  }).catch((err) => {
    throw new Error(
      `Could not reach Vercel SMTP relay at ${url}: ${err instanceof Error ? err.message : String(err)}`,
    );
  });

  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || `SMTP relay failed to send email (HTTP ${response.status})`);
  }
}
