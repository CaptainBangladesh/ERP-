import { randomBytes } from 'node:crypto';
import { Logger } from '@nestjs/common';

/**
 * The four secrets this module cannot do its job without, and one rule about all of them.
 *
 * Before ticket 12 each had a hardcoded fallback: the vault key fell back to
 * `'erp-marketing-oauth-vault-secret-salt-development-key'`, the OAuth state HMAC to a similar
 * constant, and the analytics pepper did not exist at all. Deployed without the environment
 * variables, every stored token was encrypted under a key committed to this repository — which
 * made `CryptoService`'s own docstring ("cannot read tokens without the server's vault
 * secret") false. **A secret that silently defaults is worse than no secret, because it looks
 * fine.**
 *
 * So: in production a missing or short value refuses the boot. Outside production a missing
 * value gets an ephemeral key generated per process, which means development tokens do not
 * survive a restart. That is intended rather than tolerated — a developer who hits it learns
 * the variable is missing on the day it is convenient, and the constant that made the
 * production failure mode reachable no longer exists to be copied.
 *
 * `SESSION_SECRET` is deliberately *not* a fallback for any of them. Reusing the session
 * signing key as an encryption key couples two rotations that have to stay independent: you
 * cannot sign users out and re-key the vault in the same change without meaning to.
 */

const logger = new Logger('MarketingSecrets');

/** Below this, a production secret is refused rather than stretched by scrypt and hoped for. */
export const MIN_SECRET_LENGTH = 32;

export const MARKETING_SECRET_VARS = {
  /** Derives the key that encrypts stored OAuth access and refresh tokens. */
  vault: 'MARKETING_VAULT_SECRET',
  /** Signs the OAuth `state` parameter, so a callback cannot be forged. */
  oauthState: 'MARKETING_OAUTH_STATE_SECRET',
  /** Peppers the daily visitor IP hash. See `tracking.service.ts`. */
  analyticsPepper: 'MARKETING_ANALYTICS_PEPPER',
  /**
   * The model credential behind the composer's generation route (14a).
   *
   * A *platform* secret, not a per-tenant one: it is one shared vendor key, so it does not
   * go through `CryptoService` — per-record encryption of a value every tenant's request
   * uses buys nothing and couples two rotation schedules that have to stay independent
   * (12.3b). A tenant's *own* key is the other thing entirely and does live in the vault
   * (14h, `ai-keys.service.ts`).
   *
   * It is here rather than read at a call site so it inherits the rule above: absent in
   * production refuses the boot, absent in development gets an ephemeral value that cannot
   * accidentally work. It is never sent to the browser, never in a masked-credential list,
   * and never logged (14r) — and every read of it goes through `resolveAiProvider`.
   */
  anthropicApiKey: 'ANTHROPIC_API_KEY',
} as const;

export type MarketingSecretVar =
  (typeof MARKETING_SECRET_VARS)[keyof typeof MARKETING_SECRET_VARS];

/**
 * One ephemeral value per variable per process, so a restart re-keys and a redeploy of the
 * same code twice never produces the same key twice.
 */
const ephemeral = new Map<string, string>();
const warned = new Set<string>();

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

/**
 * The secret behind one variable, or a development stand-in.
 *
 * Never throws outside production, and never returns a constant.
 */
export function marketingSecret(name: MarketingSecretVar): string {
  const configured = process.env[name];
  if (configured && configured.length >= MIN_SECRET_LENGTH) return configured;

  if (isProduction()) {
    // Reached only if the boot check was bypassed — a service constructed outside the Nest
    // lifecycle, say. Refusing here too means there is no path to the old behaviour.
    throw new Error(
      `${name} is required in production and must be at least ${MIN_SECRET_LENGTH} characters.`,
    );
  }

  let value = ephemeral.get(name);
  if (!value) {
    value = `ephemeral-development-key/${randomBytes(32).toString('hex')}`;
    ephemeral.set(name, value);
  }

  if (!warned.has(name)) {
    warned.add(name);
    logger.warn(
      `${name} is not set. Using an ephemeral development key generated for this process — ` +
        `anything encrypted or hashed under it stops being readable when this process exits.`,
    );
  }

  return value;
}

/**
 * The boot check. Called from `CryptoService.onModuleInit`, once, for all four.
 *
 * Deliberately eager rather than lazy: a check on first use would pass every boot and fail on
 * the first customer to connect a social account, which is the wrong end of the deploy to
 * discover a missing environment variable.
 */
export function assertMarketingSecrets(): void {
  if (!isProduction()) {
    for (const name of Object.values(MARKETING_SECRET_VARS)) marketingSecret(name);
    return;
  }

  const missing: string[] = [];
  for (const name of Object.values(MARKETING_SECRET_VARS)) {
    const value = process.env[name];
    if (!value || value.length < MIN_SECRET_LENGTH) missing.push(name);
  }

  if (missing.length > 0) {
    throw new Error(
      `Refusing to start: ${missing.join(', ')} must be set to at least ` +
        `${MIN_SECRET_LENGTH} characters in production. There is no default; a marketing ` +
        `vault encrypted under a key from this repository would protect nothing.`,
    );
  }
}

/** For tests that change the environment between cases. */
export function forgetMarketingSecrets(): void {
  ephemeral.clear();
  warned.clear();
}
