/**
 * How long any SMTP connection this system opens is allowed to hang.
 *
 * Nodemailer's own defaults are two minutes to connect and no socket deadline at all, which
 * is fine on a laptop where a wrong host answers immediately and wrong on a hosting platform
 * where outbound SMTP is silently dropped rather than refused. There the send does not fail —
 * it waits, past the platform's own request timeout, and the browser gets a gateway error page
 * instead of this system's JSON. That is what turns "the mail host would not take it" into
 * "Something went wrong. Please try again."
 *
 * So the deadline is ours, not the platform's, and it is short enough that a refusal reaches
 * the user as a refusal — with the reason on it — while still leaving room for a slow but
 * working host.
 */
export const SMTP_TIMEOUTS = {
  /** TCP connect. A blocked outbound port spends its whole life here. */
  connectionTimeout: 15_000,
  /** The server's opening banner, once connected. */
  greetingTimeout: 10_000,
  /** Any single read or write afterwards. */
  socketTimeout: 25_000,
} as const;
