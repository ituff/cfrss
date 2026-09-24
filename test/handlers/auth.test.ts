import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import app from '../../src/index';
import { setupTestDatabase } from '../setup';
import type { Env } from '../../src/types';

const BOOTSTRAP_TOKEN = 'test-auth-token';

const TEST_ENV: Env = {
  DB: null as unknown as D1Database,
  ENCRYPTION_KEY: 'test-encryption-key-32bytes-long!',
  AUTH_TOKEN: BOOTSTRAP_TOKEN,
};

function makeRequest(method: string, path: string, body?: unknown, token = BOOTSTRAP_TOKEN) {
  const init: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  return new Request(`http://localhost${path}`, init);
}

/** Hit an authenticated endpoint with the given token to check validity. */
async function tokenWorks(token: string): Promise<boolean> {
  const res = await app.fetch(makeRequest('GET', '/api/config/theme', undefined, token), TEST_ENV);
  return res.status === 200;
}

describe('Password API', () => {
  beforeEach(async () => {
    TEST_ENV.DB = env.DB;
    await setupTestDatabase(env.DB);
    await env.DB.prepare("DELETE FROM config WHERE key = 'auth_hash'").run();
  });

  describe('GET /api/auth/password/status', () => {
    it('reports no custom password by default', async () => {
      const res = await app.fetch(makeRequest('GET', '/api/auth/password/status'), TEST_ENV);
      expect(res.status).toBe(200);
      const body = await res.json() as { hasCustomPassword: boolean; minLength: number };
      expect(body.hasCustomPassword).toBe(false);
      expect(body.minLength).toBeGreaterThan(0);
    });

    it('never leaks secret material', async () => {
      const res = await app.fetch(makeRequest('GET', '/api/auth/password/status'), TEST_ENV);
      const text = await res.text();
      expect(text).not.toContain(BOOTSTRAP_TOKEN);
    });
  });

  describe('PUT /api/auth/password', () => {
    it('changes the password with the correct current password', async () => {
      const res = await app.fetch(
        makeRequest('PUT', '/api/auth/password', {
          currentPassword: BOOTSTRAP_TOKEN,
          newPassword: 'brand-new-secret',
        }),
        TEST_ENV,
      );
      expect(res.status).toBe(200);

      // New password works, bootstrap token no longer does
      expect(await tokenWorks('brand-new-secret')).toBe(true);
      expect(await tokenWorks(BOOTSTRAP_TOKEN)).toBe(false);
    });

    it('stores a hash rather than the plaintext', async () => {
      await app.fetch(
        makeRequest('PUT', '/api/auth/password', {
          currentPassword: BOOTSTRAP_TOKEN,
          newPassword: 'plaintext-check',
        }),
        TEST_ENV,
      );
      const row = await env.DB.prepare("SELECT value FROM config WHERE key = 'auth_hash'")
        .first<{ value: string }>();
      expect(row?.value).toBeDefined();
      expect(row!.value).not.toContain('plaintext-check');
      expect(row!.value.startsWith('pbkdf2$')).toBe(true);
    });

    it('rejects a wrong current password with 401', async () => {
      const res = await app.fetch(
        makeRequest('PUT', '/api/auth/password', {
          currentPassword: 'not-the-password',
          newPassword: 'whatever123',
        }),
        TEST_ENV,
      );
      expect(res.status).toBe(401);
    });

    it('rejects a too-short new password with 400', async () => {
      const res = await app.fetch(
        makeRequest('PUT', '/api/auth/password', {
          currentPassword: BOOTSTRAP_TOKEN,
          newPassword: 'abc',
        }),
        TEST_ENV,
      );
      expect(res.status).toBe(400);
    });

    it('rejects a missing current password with 400', async () => {
      const res = await app.fetch(
        makeRequest('PUT', '/api/auth/password', { newPassword: 'long-enough-pw' }),
        TEST_ENV,
      );
      expect(res.status).toBe(400);
    });

    it('rejects reusing the current password with 400', async () => {
      const res = await app.fetch(
        makeRequest('PUT', '/api/auth/password', {
          currentPassword: BOOTSTRAP_TOKEN,
          newPassword: BOOTSTRAP_TOKEN,
        }),
        TEST_ENV,
      );
      expect(res.status).toBe(400);
    });

    it('allows rotating a custom password again', async () => {
      await app.fetch(
        makeRequest('PUT', '/api/auth/password', {
          currentPassword: BOOTSTRAP_TOKEN,
          newPassword: 'first-custom-pw',
        }),
        TEST_ENV,
      );

      const res = await app.fetch(
        makeRequest('PUT', '/api/auth/password', {
          currentPassword: 'first-custom-pw',
          newPassword: 'second-custom-pw',
        }, 'first-custom-pw'),
        TEST_ENV,
      );
      expect(res.status).toBe(200);
      expect(await tokenWorks('second-custom-pw')).toBe(true);
      expect(await tokenWorks('first-custom-pw')).toBe(false);
    });
  });

  describe('POST /api/auth/password/reset', () => {
    it('restores the bootstrap token', async () => {
      await app.fetch(
        makeRequest('PUT', '/api/auth/password', {
          currentPassword: BOOTSTRAP_TOKEN,
          newPassword: 'temporary-pw',
        }),
        TEST_ENV,
      );
      expect(await tokenWorks(BOOTSTRAP_TOKEN)).toBe(false);

      const res = await app.fetch(
        makeRequest('POST', '/api/auth/password/reset', { currentPassword: 'temporary-pw' }, 'temporary-pw'),
        TEST_ENV,
      );
      expect(res.status).toBe(200);
      expect(await tokenWorks(BOOTSTRAP_TOKEN)).toBe(true);
    });

    it('rejects a wrong current password with 401', async () => {
      const res = await app.fetch(
        makeRequest('POST', '/api/auth/password/reset', { currentPassword: 'nope' }),
        TEST_ENV,
      );
      expect(res.status).toBe(401);
    });
  });

  describe('endpoints require authentication', () => {
    it('rejects an unauthenticated change request', async () => {
      const res = await app.fetch(
        new Request('http://localhost/api/auth/password', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ currentPassword: 'x', newPassword: 'yyyyyy' }),
        }),
        TEST_ENV,
      );
      expect(res.status).toBe(401);
    });
  });
});
