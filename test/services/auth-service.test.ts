import { describe, it, expect } from 'vitest';
import {
  hashPassword,
  verifyPassword,
  validateAuthToken,
  getStoredPasswordHash,
  setStoredPasswordHash,
  clearStoredPasswordHash,
} from '../../src/services/auth-service';

/**
 * In-memory D1 stub backed by a Map, enough for the config key-value queries
 * the auth service issues.
 */
function memoryDb(): D1Database {
  const store = new Map<string, string>();
  return {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => ({
        first: async () => {
          const key = args[0] as string;
          if (sql.includes('SELECT value FROM config')) {
            return store.has(key) ? { value: store.get(key)! } : null;
          }
          return null;
        },
        run: async () => {
          if (sql.includes('INSERT OR REPLACE')) {
            store.set(args[0] as string, args[1] as string);
          } else if (sql.includes('DELETE FROM config')) {
            store.delete(args[0] as string);
          }
          return {};
        },
      }),
    }),
  } as unknown as D1Database;
}

describe('auth-service', () => {
  describe('hashPassword / verifyPassword', () => {
    it('verifies the correct password', async () => {
      const record = await hashPassword('correct horse battery');
      expect(await verifyPassword('correct horse battery', record)).toBe(true);
    });

    it('rejects a wrong password', async () => {
      const record = await hashPassword('correct horse battery');
      expect(await verifyPassword('wrong password', record)).toBe(false);
    });

    it('produces a salted record with a unique salt each time', async () => {
      const a = await hashPassword('same-password');
      const b = await hashPassword('same-password');
      expect(a).not.toBe(b);
      // Both still verify independently
      expect(await verifyPassword('same-password', a)).toBe(true);
      expect(await verifyPassword('same-password', b)).toBe(true);
    });

    it('never embeds the plaintext password', async () => {
      const record = await hashPassword('my-secret-value');
      expect(record).not.toContain('my-secret-value');
    });

    it('rejects malformed records without throwing', async () => {
      expect(await verifyPassword('x', 'not-a-record')).toBe(false);
      expect(await verifyPassword('x', 'pbkdf2$abc$salt$hash')).toBe(false);
      expect(await verifyPassword('x', '')).toBe(false);
    });
  });

  describe('stored password CRUD', () => {
    it('round-trips a stored record', async () => {
      const db = memoryDb();
      expect(await getStoredPasswordHash(db)).toBeNull();

      const record = await hashPassword('abc123');
      await setStoredPasswordHash(db, record);
      expect(await getStoredPasswordHash(db)).toBe(record);

      await clearStoredPasswordHash(db);
      expect(await getStoredPasswordHash(db)).toBeNull();
    });
  });

  describe('validateAuthToken', () => {
    it('falls back to the env token when no custom password is stored', async () => {
      const db = memoryDb();
      expect(await validateAuthToken(db, 'env-token', 'env-token')).toBe(true);
      expect(await validateAuthToken(db, 'env-token', 'other')).toBe(false);
    });

    it('returns false when neither a stored password nor an env token exists', async () => {
      const db = memoryDb();
      expect(await validateAuthToken(db, undefined, 'anything')).toBe(false);
    });

    it('prefers the stored password over the env token', async () => {
      const db = memoryDb();
      await setStoredPasswordHash(db, await hashPassword('custom-pass'));

      expect(await validateAuthToken(db, 'env-token', 'custom-pass')).toBe(true);
      expect(await validateAuthToken(db, 'env-token', 'env-token')).toBe(false);
    });
  });
});
