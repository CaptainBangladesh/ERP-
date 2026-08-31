import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

/**
 * Encrypting secrets this system has to be able to read back — today, SMTP passwords.
 *
 * In the platform rather than in one module because two of them need it: the CRM keeps a
 * salesperson's mailbox password, and identity keeps the company's own. One implementation,
 * so a change to how secrets are stored is one edit rather than a search.
 *
 * A password to somebody's company mail account cannot be stored the way a user password is —
 * a one-way hash would be useless, because sending requires presenting the password itself.
 * So it is encrypted rather than hashed, and the trade that comes with that is honest: anyone
 * holding both the database and the key can read it. What this protects against is the
 * ordinary case — a leaked dump, a backup on a laptop, a query run by somebody who should not
 * have — where the key is not in the same place as the rows.
 *
 * AES-256-GCM, so the ciphertext is authenticated: a row somebody edited fails to decrypt
 * rather than decrypting to something else. Every value gets a fresh random IV, which is what
 * stops two accounts with the same password storing identically.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;

/**
 * The key, derived once per process.
 *
 * `MAILBOX_SECRET` when it is set, and `SESSION_SECRET` otherwise, because every deployment
 * already has to have one of those and a second required variable is a second thing to forget
 * on the day mail stops working. Derived through scrypt rather than used raw, so a short or
 * low-entropy secret still yields a full-length key.
 *
 * Rotating the secret it derives from makes stored SMTP passwords undecryptable, and the
 * mailbox has to be added again. That is the cost of not keeping a second key store, and it
 * is worth writing down rather than discovering.
 */
let cachedKey: Buffer | undefined;

function key(): Buffer {
  if (cachedKey) return cachedKey;

  const secret =
    process.env.MAILBOX_SECRET ||
    process.env.SESSION_SECRET ||
    'local-development-only-not-a-secret-0123456789abcdef';

  // A fixed salt: the derivation has to produce the same key on every boot, or yesterday's
  // rows stop opening. The randomness that matters per value is the IV below.
  cachedKey = scryptSync(secret, 'erp.crm.mailbox-smtp-password', KEY_BYTES);
  // The label stays as it was written: changing it would re-derive a different key and make
  // every password already in the database undecryptable.
  return cachedKey;
}

/** For tests that change the environment between cases. */
export function forgetSecretKey(): void {
  cachedKey = undefined;
}

/** `iv.ciphertext.tag`, each base64url — one column, no schema for the parts. */
export function encryptSmtpPassword(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key(), iv);

  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

  return [
    iv.toString('base64url'),
    ciphertext.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
  ].join('.');
}

/**
 * Reads a stored password back, or throws.
 *
 * Throwing rather than answering `undefined` on a value that will not open: the only callers
 * are about to send mail with it, and a send that quietly proceeds without a password would
 * fail at the mail host with something unrecognisable instead of here, where the cause is
 * plain — the row is corrupt, or the secret it was encrypted under has changed.
 */
export function decryptSmtpPassword(stored: string): string {
  const [ivPart, ciphertextPart, tagPart] = stored.split('.');
  if (!ivPart || !ciphertextPart || !tagPart) {
    throw new Error('Stored SMTP password is not in the expected format.');
  }

  const decipher = createDecipheriv(ALGORITHM, key(), Buffer.from(ivPart, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextPart, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
