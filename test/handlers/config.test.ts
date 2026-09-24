import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import app from '../../src/index';
import { setupTestDatabase } from '../setup';
import type { Env } from '../../src/types';

const TEST_ENV: Env = {
  DB: null as unknown as D1Database,
  ENCRYPTION_KEY: 'test-encryption-key-32bytes-long!',
  AUTH_TOKEN: 'test-auth-token',
};

function makeRequest(method: string, path: string, body?: unknown) {
  const init: RequestInit = {
    method,
    headers: {
      Authorization: 'Bearer test-auth-token',
      'Content-Type': 'application/json',
    },
  };
  if (body) {
    init.body = JSON.stringify(body);
  }
  return new Request(`http://localhost${path}`, init);
}

describe('Theme Config API', () => {
  beforeEach(async () => {
    TEST_ENV.DB = env.DB;
    await setupTestDatabase(env.DB);
    await env.DB.prepare("DELETE FROM config WHERE key = 'theme'").run();
  });

  describe('GET /api/config/theme', () => {
    it('returns null theme when not set', async () => {
      const res = await app.fetch(makeRequest('GET', '/api/config/theme'), TEST_ENV);
      expect(res.status).toBe(200);
      const body = await res.json() as { theme: string | null };
      expect(body.theme).toBeNull();
    });
  });

  describe('PUT /api/config/theme', () => {
    it.each(['light', 'dark', 'oled', 'eink'])('accepts and stores theme "%s"', async (theme) => {
      const res = await app.fetch(makeRequest('PUT', '/api/config/theme', { theme }), TEST_ENV);
      expect(res.status).toBe(200);
      const body = await res.json() as { success: boolean; theme: string };
      expect(body.success).toBe(true);
      expect(body.theme).toBe(theme);

      const stored = await env.DB.prepare("SELECT value FROM config WHERE key = 'theme'").first<{ value: string }>();
      expect(stored?.value).toBe(theme);
    });

    it('rejects invalid theme values with 400', async () => {
      const res = await app.fetch(makeRequest('PUT', '/api/config/theme', { theme: 'solarized' }), TEST_ENV);
      expect(res.status).toBe(400);
    });

    it('rejects missing theme value with 400', async () => {
      const res = await app.fetch(makeRequest('PUT', '/api/config/theme', {}), TEST_ENV);
      expect(res.status).toBe(400);
    });
  });
});
