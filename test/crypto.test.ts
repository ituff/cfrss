import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { encrypt, decrypt } from '../src/utils/crypto';
import { FC_OPTIONS } from './setup';

describe('Crypto utilities', () => {
  const TEST_KEY = 'test-encryption-key-for-unit-tests';

  describe('encrypt', () => {
    it('should return a non-empty base64 string', async () => {
      const result = await encrypt('hello', TEST_KEY);
      expect(result).toBeTruthy();
      expect(typeof result).toBe('string');
      // Verify it's valid base64
      expect(() => atob(result)).not.toThrow();
    });

    it('should produce different ciphertexts for the same plaintext (random IV)', async () => {
      const result1 = await encrypt('same-value', TEST_KEY);
      const result2 = await encrypt('same-value', TEST_KEY);
      expect(result1).not.toBe(result2);
    });

    it('should throw on empty plaintext', async () => {
      await expect(encrypt('', TEST_KEY)).rejects.toThrow('Cannot encrypt empty plaintext');
    });

    it('should throw on empty key', async () => {
      await expect(encrypt('hello', '')).rejects.toThrow('Encryption key must not be empty');
    });
  });

  describe('decrypt', () => {
    it('should correctly decrypt an encrypted value', async () => {
      const original = 'sk-my-api-key-12345';
      const encrypted = await encrypt(original, TEST_KEY);
      const decrypted = await decrypt(encrypted, TEST_KEY);
      expect(decrypted).toBe(original);
    });

    it('should throw on empty ciphertext', async () => {
      await expect(decrypt('', TEST_KEY)).rejects.toThrow('Cannot decrypt empty ciphertext');
    });

    it('should throw on empty key', async () => {
      await expect(decrypt('abc', '')).rejects.toThrow('Encryption key must not be empty');
    });

    it('should throw on invalid base64', async () => {
      await expect(decrypt('not!valid!base64!!!', TEST_KEY)).rejects.toThrow('Invalid ciphertext');
    });

    it('should throw on data too short', async () => {
      // Less than 13 bytes (12 IV + at least 1 byte ciphertext)
      const shortData = btoa('short');
      await expect(decrypt(shortData, TEST_KEY)).rejects.toThrow('Invalid ciphertext: data too short');
    });

    it('should throw on wrong key', async () => {
      const encrypted = await encrypt('secret', TEST_KEY);
      await expect(decrypt(encrypted, 'wrong-key')).rejects.toThrow('Decryption failed');
    });

    it('should throw on corrupted ciphertext', async () => {
      const encrypted = await encrypt('secret', TEST_KEY);
      // Corrupt the ciphertext by modifying characters in the middle
      const chars = encrypted.split('');
      const midpoint = Math.floor(chars.length / 2);
      chars[midpoint] = chars[midpoint] === 'A' ? 'B' : 'A';
      chars[midpoint + 1] = chars[midpoint + 1] === 'A' ? 'B' : 'A';
      const corrupted = chars.join('');
      await expect(decrypt(corrupted, TEST_KEY)).rejects.toThrow();
    });
  });

  describe('Property 11: API key encrypt/decrypt roundtrip', () => {
    /**
     * **Validates: Requirements 11.5**
     *
     * For any API key string, encrypting it for D1 storage and then
     * decrypting should produce the original key string.
     */
    it('encrypt then decrypt should return the original string', async () => {
      await fc.assert(
        fc.asyncProperty(
          // Generate non-empty strings as API keys
          fc.string({ minLength: 1, maxLength: 500 }),
          // Generate non-empty strings as encryption keys
          fc.string({ minLength: 1, maxLength: 200 }),
          async (apiKey, encKey) => {
            const encrypted = await encrypt(apiKey, encKey);
            const decrypted = await decrypt(encrypted, encKey);
            return decrypted === apiKey;
          }
        ),
        FC_OPTIONS
      );
    });
  });
});
