import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

const SALT_BYTES = 16;
const KEY_BYTES = 64;

/**
 * Password storage: one-way, salted, and slow on purpose.
 *
 * scrypt comes with Node, so there is no native module to build on three platforms and no
 * dependency to keep patched — which matters more than it sounds, because a password hash
 * that is awkward to install is a password hash somebody eventually swaps for something
 * faster. It is memory-hard by design, so a stolen table cannot be attacked with a GPU the
 * way a bare SHA-256 table can.
 *
 * The salt is per user and stored alongside the hash. Without it, two people who chose the
 * same password would store identically, and cracking one would crack both.
 *
 * There is no verb here for reading a password back, because there is no way to write one.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = await scryptAsync(password, salt, KEY_BYTES);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

/**
 * Whether this password produces that hash.
 *
 * Compared in constant time: a comparison that returns early on the first wrong byte leaks,
 * through how long it took, how much of a guess was right.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;

  let expected: Buffer;
  try {
    expected = Buffer.from(hashHex, 'hex');
  } catch {
    return false;
  }

  const derived = await scryptAsync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
