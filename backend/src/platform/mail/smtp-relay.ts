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

/**
 * How long the API waits on the relay before giving up on it.
 *
 * Shorter than the platform's own request timeout on purpose. `fetch` has no default deadline
 * at all, so a relay that accepts a connection and then stops answering would hold this
 * request open until the hosting platform killed it — and the browser would get the
 * platform's gateway page instead of this system's JSON, which is the difference between "the
 * relay is not answering" and "Something went wrong. Please try again."
 *
 * The relay's own function deadline is 30s (see `vercel.json`), so this sits just past it:
 * long enough that the relay's real answer wins the race and reaches the user, short enough
 * that nothing here outlives the request it belongs to.
 */
const RELAY_TIMEOUT_MS = 35_000;

export function isSmtpRelayConfigured(): boolean {
  return Boolean(process.env.SMTP_RELAY_URL);
}

/** The relay's URL with any trailing slash removed, or `undefined` when none is configured. */
export function smtpRelayUrl(): string | undefined {
  return process.env.SMTP_RELAY_URL?.trim().replace(/\/$/, '') || undefined;
}

/**
 * The shared secret, which both ends derive the same way.
 *
 * `SESSION_SECRET` is the fallback so that a deployment which already has one does not need a
 * second variable to get a working relay — but the relay refuses when neither is set rather
 * than serving anybody who finds the URL, so an unset pair fails closed on both ends.
 */
function relaySecret(): string | undefined {
  return process.env.SMTP_RELAY_SECRET || process.env.SESSION_SECRET || undefined;
}

function relayHeaders(): Record<string, string> {
  const secret = relaySecret();
  return {
    'Content-Type': 'application/json',
    ...(secret ? { 'x-relay-secret': secret } : {}),
  };
}

/** What the relay said went wrong, with the mail host's own code kept where it gave one. */
export interface SmtpRelayFailure {
  error?: string;
  code?: string;
  responseCode?: number;
}

/**
 * One request to the relay, with every way it can fail turned into a sentence that names the
 * half at fault.
 *
 * Three failures look alike from here and are nothing alike to fix: the relay was never
 * deployed (the fetch itself fails), the relay is deployed but rejects this API (401, wrong
 * or missing secret), and the relay reached the mail host and the mail host said no (502 with
 * the host's own message). Collapsing those into one message is what turns a five-minute fix
 * into an afternoon, so each gets its own.
 */
async function callRelay(payload: unknown): Promise<SmtpRelayFailure | undefined> {
  const url = smtpRelayUrl();
  if (!url) throw new Error('SMTP_RELAY_URL is not set on this server.');

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: relayHeaders(),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(RELAY_TIMEOUT_MS),
    });
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    const timedOut = cause instanceof Error && cause.name === 'TimeoutError';
    throw new Error(
      timedOut
        ? `The SMTP relay at ${url} did not answer within ${RELAY_TIMEOUT_MS / 1000}s. ` +
          'It may be deployed but unable to reach the mail host.'
        : `Could not reach the SMTP relay at ${url}: ${detail}. Check that SMTP_RELAY_URL ` +
          'points at a deployed relay and includes the full path, e.g. ' +
          'https://your-project.vercel.app/api/smtp-relay',
    );
  }

  if (response.ok) return undefined;

  const failure = (await response.json().catch(() => ({}))) as SmtpRelayFailure;

  if (response.status === 401) {
    throw new Error(
      'The SMTP relay rejected this server’s credentials. SMTP_RELAY_SECRET must be set to ' +
        'the same value on the relay and on this API.',
    );
  }

  if (response.status === 503) {
    throw new Error(
      failure.error ||
        'The SMTP relay is deployed but has no SMTP_RELAY_SECRET set, so it refuses every request.',
    );
  }

  const error = new Error(
    failure.error || `The SMTP relay could not complete the request (HTTP ${response.status}).`,
  );
  // Carried through so callers can tell a rejected password from an unreachable mail host.
  Object.assign(error, { code: failure.code, responseCode: failure.responseCode });
  throw error;
}

export async function verifyThroughRelay(smtp: SmtpRelayConfig): Promise<void> {
  logger.log(
    `Verifying SMTP settings for ${smtp.username || 'user'}@${smtp.host} through the relay.`,
  );
  await callRelay({ action: 'verify', smtp });
}

export async function sendThroughRelay(
  smtp: SmtpRelayConfig,
  message: SmtpRelayMessage,
): Promise<void> {
  logger.log(`Sending "${message.subject}" to ${message.to} through the relay.`);
  await callRelay({ action: 'send', smtp, message });
}

/**
 * Whether the relay is deployed and answering, without sending anything.
 *
 * A `GET` rather than a send, so this is safe to call from a diagnostics screen as often as
 * somebody presses the button. Answers rather than throws: "the relay is not reachable" is
 * the finding here, not an error to handle.
 */
export async function checkRelayReachable(): Promise<{ reachable: boolean; detail: string }> {
  const url = smtpRelayUrl();
  if (!url) return { reachable: false, detail: 'SMTP_RELAY_URL is not set on this server.' };

  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      return { reachable: false, detail: `The relay answered HTTP ${response.status}.` };
    }

    const body = (await response.json().catch(() => ({}))) as { secretConfigured?: boolean };

    if (body.secretConfigured === false) {
      return {
        reachable: false,
        detail:
          'The relay is deployed but has no SMTP_RELAY_SECRET set, so it will refuse every send.',
      };
    }

    return { reachable: true, detail: 'The relay is deployed and answering.' };
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return { reachable: false, detail: `Could not reach ${url}: ${detail}` };
  }
}
