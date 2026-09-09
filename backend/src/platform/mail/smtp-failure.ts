/**
 * Telling "the mail host said no" apart from "nothing answered at all".
 *
 * The two arrive at the same `catch` and read alike in a log, and they have opposite fixes: a
 * rejected password is fixed by the person who typed it, on a screen, in seconds; an
 * unreachable host is fixed only by whoever runs the server, and no amount of retyping the
 * password touches it. A message that does not distinguish them sends people to correct the
 * one thing that was already correct — which is precisely how outbound SMTP being blocked on
 * a hosting platform gets mistaken for a wrong password for weeks.
 */

/** Socket-level failures: the connection never got far enough for the host to have an opinion. */
const UNREACHABLE_CODES = new Set([
  'ETIMEDOUT',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'EDNS',
  'ESOCKET',
  'EAI_AGAIN',
]);

/** Whether the mail host was never reached, as opposed to reached and having refused. */
export function isUnreachableMailHost(cause: unknown): boolean {
  const code = (cause as { code?: unknown })?.code;
  if (typeof code === 'string' && UNREACHABLE_CODES.has(code)) return true;

  // Nodemailer reports its own connection deadline as a message rather than a code.
  const message = cause instanceof Error ? cause.message : String(cause ?? '');
  return /connection timeout|greeting never received|timed out/i.test(message);
}

/**
 * `ENOTFOUND` and `EAI_AGAIN` are DNS, not a blocked port — the name did not resolve, so the
 * host is probably misspelled. Worth separating, because "your host is blocked" sends somebody
 * to change their hosting plan over a typo.
 */
export function isNameResolutionFailure(cause: unknown): boolean {
  const code = (cause as { code?: unknown })?.code;
  return code === 'ENOTFOUND' || code === 'EAI_AGAIN';
}
