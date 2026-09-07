import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { HttpStatus, Injectable, OnModuleInit } from '@nestjs/common';
import { MARKETING_ERROR_CODES } from '@erp/shared';
import { ApiException } from '../../http/api-exception';
import {
  MARKETING_SECRET_VARS,
  assertMarketingSecrets,
  forgetMarketingSecrets,
  marketingSecret,
} from './vault-secrets';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;
const KEY_SALT = 'erp.marketing.oauth-vault-key-salt';

/** The key id written when none is configured, and the one legacy ciphertext is read as. */
const DEFAULT_KEY_ID = 'v1';

/**
 * AES-256-GCM authenticated encryption for third-party OAuth access and refresh tokens.
 *
 * Stored values are `<kid>.<iv>.<ciphertext>.<tag>`, each part base64url. The key id is the
 * whole of ticket 12's change here and it exists for one reason: without it, rotating
 * `MARKETING_VAULT_SECRET` bricks every stored token and the only recovery is re-authorising
 * every social account by hand. In practice that means the key never gets rotated — and a key
 * that cannot be rotated is the actual defect, not the ciphertext format.
 *
 * With a kid, rotation is: set `MARKETING_VAULT_KEY_ID=v2` and a new `MARKETING_VAULT_SECRET`,
 * and move the old secret into `MARKETING_VAULT_RETIRED_KEYS` as `v1:<old secret>`. New writes
 * use v2; v1 rows keep opening until something rewrites them. A three-part string with no kid
 * is read as `v1` for exactly one release, so nothing already in the database is stranded.
 *
 * **Envelope encryption is the recorded end state** — a per-record data key wrapped by a key
 * encryption key, so that rotating the KEK re-wraps a few small keys and never touches bulk
 * ciphertext. Its trigger is a second secret store or a scheduled-rotation compliance
 * requirement; neither exists yet, and this format is the step that makes rotation possible at
 * all rather than the step that makes it cheap.
 *
 * The secret itself has no fallback: see `vault-secrets.ts`.
 */
@Injectable()
export class CryptoService implements OnModuleInit {
  private readonly keys = new Map<string, Buffer>();

  /**
   * The one boot-time check for all three of this module's secrets.
   *
   * On `onModuleInit` rather than on first use, because a lazy check passes every boot and
   * fails on the first customer to connect an account.
   */
  onModuleInit(): void {
    assertMarketingSecrets();
  }

  /** The key id new ciphertext is written under. */
  private activeKeyId(): string {
    return process.env.MARKETING_VAULT_KEY_ID?.trim() || DEFAULT_KEY_ID;
  }

  /**
   * Decrypt-only keys, as `kid:secret` pairs separated by commas or semicolons.
   *
   * A secret may not contain the separators; that is a documented constraint rather than a
   * parser, because a quoting scheme here would be a second thing to get wrong at 3am.
   */
  private retiredSecrets(): Map<string, string> {
    const raw = process.env.MARKETING_VAULT_RETIRED_KEYS ?? '';
    const pairs = new Map<string, string>();

    for (const entry of raw.split(/[,;]/)) {
      const trimmed = entry.trim();
      if (!trimmed) continue;
      const separator = trimmed.indexOf(':');
      if (separator <= 0) continue;
      const kid = trimmed.slice(0, separator).trim();
      const secret = trimmed.slice(separator + 1).trim();
      if (kid && secret) pairs.set(kid, secret);
    }

    return pairs;
  }

  private deriveKey(secret: string): Buffer {
    return scryptSync(secret, KEY_SALT, KEY_BYTES);
  }

  /** The key for one id, or nothing — "nothing" is an operational fact, not a tampering one. */
  private keyFor(kid: string): Buffer | undefined {
    const cached = this.keys.get(kid);
    if (cached) return cached;

    const secret =
      kid === this.activeKeyId()
        ? marketingSecret(MARKETING_SECRET_VARS.vault)
        : this.retiredSecrets().get(kid);

    if (!secret) return undefined;

    const key = this.deriveKey(secret);
    this.keys.set(kid, key);
    return key;
  }

  /** Clears cached keys and ephemeral secrets (used in tests changing environment variables). */
  forgetKey(): void {
    this.keys.clear();
    forgetMarketingSecrets();
  }

  /**
   * Encrypts plaintext using AES-256-GCM.
   * Returns `kid.iv.ciphertext.tag`, all parts after the key id base64url encoded.
   */
  encrypt(plaintext: string): string {
    const kid = this.activeKeyId();
    const key = this.keyFor(kid);
    if (!key) throw unknownKey(kid);

    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, key, iv);

    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    return [
      kid,
      iv.toString('base64url'),
      ciphertext.toString('base64url'),
      tag.toString('base64url'),
    ].join('.');
  }

  /**
   * Decrypts a stored credential back to plaintext.
   *
   * Two failures, two codes. A ciphertext naming a key id we do not hold is
   * `vault_key_unknown` — somebody rotated a secret out of the environment, and the fix is to
   * put it back in `MARKETING_VAULT_RETIRED_KEYS`. A GCM tag that does not verify is
   * `vault_decryption_failed` — the row was modified. Reporting both as the latter is how an
   * ordinary configuration mistake gets investigated as an attack.
   */
  decrypt(stored: string): string {
    const parts = stored.split('.');

    // Three parts is pre-rotation ciphertext, from before the key id existed.
    const [kid, ivPart, ciphertextPart, tagPart] =
      parts.length === 3 ? [DEFAULT_KEY_ID, ...parts] : parts;

    if (
      (parts.length !== 3 && parts.length !== 4) ||
      !kid ||
      !ivPart ||
      !ciphertextPart ||
      !tagPart
    ) {
      throw new ApiException(
        MARKETING_ERROR_CODES.vaultDecryptionFailed,
        'Stored credential is in an invalid format.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    const key = this.keyFor(kid);
    if (!key) throw unknownKey(kid);

    try {
      const iv = Buffer.from(ivPart, 'base64url');
      const ciphertext = Buffer.from(ciphertextPart, 'base64url');
      const tag = Buffer.from(tagPart, 'base64url');

      const decipher = createDecipheriv(ALGORITHM, key, iv);
      decipher.setAuthTag(tag);

      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    } catch {
      throw new ApiException(
        MARKETING_ERROR_CODES.vaultDecryptionFailed,
        'Decryption failed: stored credential is invalid or has been tampered with.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Masks a token for safe display in API responses without revealing the secret.
   * E.g. 'gho_1234567890abcdef' -> '••••••••cdef'
   */
  maskToken(token: string): string {
    if (!token) return '••••••••';
    const last4 = token.length >= 4 ? token.slice(-4) : token;
    return `••••••••${last4}`;
  }
}

function unknownKey(kid: string): ApiException {
  return new ApiException(
    MARKETING_ERROR_CODES.vaultKeyUnknown,
    `This credential was encrypted under key '${kid}', which this server does not hold. ` +
      `Add it to MARKETING_VAULT_RETIRED_KEYS to read it again.`,
    HttpStatus.INTERNAL_SERVER_ERROR,
  );
}
