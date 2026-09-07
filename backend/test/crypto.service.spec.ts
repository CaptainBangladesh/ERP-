import { CryptoService } from '../src/modules/marketing/crypto.service';

describe('CryptoService', () => {
  it('encrypts and decrypts with AES-256-GCM authentication', () => {
    const crypto = new CryptoService();
    const secret = 'test-oauth-access-token-123456789';

    const encrypted = crypto.encrypt(secret);
    expect(encrypted).not.toBe(secret);
    expect(encrypted.split('.').length).toBe(4); // kid.iv.ciphertext.tag

    const decrypted = crypto.decrypt(encrypted);
    expect(decrypted).toBe(secret);
  });

  it('produces different ciphertexts for identical plaintext due to random IVs', () => {
    const crypto = new CryptoService();
    const secret = 'same-token';

    const enc1 = crypto.encrypt(secret);
    const enc2 = crypto.encrypt(secret);
    expect(enc1).not.toBe(enc2);
    expect(crypto.decrypt(enc1)).toBe(secret);
    expect(crypto.decrypt(enc2)).toBe(secret);
  });

  it('detects tampering and throws when ciphertext or auth tag is modified', () => {
    const crypto = new CryptoService();
    const encrypted = crypto.encrypt('sensitive-data');
    const [kid, iv, ciphertext, tag] = encrypted.split('.') as [string, string, string, string];

    // Tamper ciphertext
    const tamperedCiphertext = Buffer.from(ciphertext, 'base64url');
    tamperedCiphertext[0] = tamperedCiphertext[0]! ^ 0xff;
    const tampered = [kid, iv, tamperedCiphertext.toString('base64url'), tag].join('.');

    expect(() => crypto.decrypt(tampered)).toThrow();
  });

  it('detects auth tag tampering and throws', () => {
    const crypto = new CryptoService();
    const encrypted = crypto.encrypt('sensitive-data');
    const [kid, iv, ciphertext, tag] = encrypted.split('.') as [string, string, string, string];

    // Tamper auth tag
    const tamperedTag = Buffer.from(tag, 'base64url');
    tamperedTag[0] = tamperedTag[0]! ^ 0xff;
    const tampered = [iv, ciphertext, tamperedTag.toString('base64url')].join('.');

    expect(() => crypto.decrypt(tampered)).toThrow();
  });

  it('safely masks tokens for public responses', () => {
    const crypto = new CryptoService();
    expect(crypto.maskToken('gho_1234567890abcdef')).toBe('••••••••cdef');
    expect(crypto.maskToken('abc')).toBe('••••••••abc');
    expect(crypto.maskToken('')).toBe('••••••••');
  });

  it('refuses invalid format strings gracefully', () => {
    const crypto = new CryptoService();
    expect(() => crypto.decrypt('invalid-format')).toThrow();
    expect(() => crypto.decrypt('a.b')).toThrow();
  });
});
