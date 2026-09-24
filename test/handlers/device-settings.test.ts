/**
 * Per-device settings integration tests.
 *
 * These go through the real Hono app and a real D1 database (via
 * `cloudflare:test`) rather than calling the service layer directly, so they
 * also cover the middleware wiring: the X-Device-Id header must be parsed,
 * validated, and threaded into the handlers.
 *
 * The behaviour that matters most is the fallback chain — adding a device must
 * not change anything until that device overrides a setting.
 */

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

/** Two well-formed uuid v4 values standing in for an e-reader and an iPad. */
const DEVICE_A = '11111111-2222-4333-8444-555555555555';
const DEVICE_B = '99999999-8888-4777-8666-555555555555';

function makeRequest(
  method: string,
  path: string,
  body?: unknown,
  deviceId?: string
): Request {
  const headers: Record<string, string> = {
    Authorization: 'Bearer test-auth-token',
    'Content-Type': 'application/json',
  };
  if (deviceId !== undefined) headers['X-Device-Id'] = deviceId;

  const init: RequestInit = { method, headers };
  if (body) init.body = JSON.stringify(body);
  return new Request(`http://localhost${path}`, init);
}

describe('Per-device settings', () => {
  beforeEach(async () => {
    TEST_ENV.DB = env.DB;
    await setupTestDatabase(env.DB);
    // Start from a clean slate so fallback behaviour is unambiguous
    await env.DB.prepare("DELETE FROM config WHERE key IN ('theme', 'language')").run();
    await env.DB.prepare('DELETE FROM device_settings').run();
    await env.DB.prepare('DELETE FROM devices').run();
  });

  describe('GET /api/config/theme', () => {
    it('returns null when neither the device nor the global value is set', async () => {
      const res = await app.fetch(makeRequest('GET', '/api/config/theme', undefined, DEVICE_A), TEST_ENV);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { theme: string | null };
      expect(body.theme).toBeNull();
    });

    it('falls back to the global value when the device has no override', async () => {
      await app.fetch(makeRequest('PUT', '/api/config/theme', { theme: 'dark' }), TEST_ENV);

      const res = await app.fetch(makeRequest('GET', '/api/config/theme', undefined, DEVICE_A), TEST_ENV);
      const body = (await res.json()) as { theme: string | null };
      expect(body.theme).toBe('dark');
    });

    it('prefers the device override over the global value', async () => {
      // Global is dark, e-reader explicitly wants eink
      await app.fetch(makeRequest('PUT', '/api/config/theme', { theme: 'dark' }), TEST_ENV);
      await app.fetch(
        makeRequest('PUT', '/api/config/theme', { theme: 'eink' }, DEVICE_A),
        TEST_ENV
      );

      const forA = await app.fetch(makeRequest('GET', '/api/config/theme', undefined, DEVICE_A), TEST_ENV);
      expect(((await forA.json()) as { theme: string | null }).theme).toBe('eink');

      // A device with no override still sees the global value
      const forB = await app.fetch(makeRequest('GET', '/api/config/theme', undefined, DEVICE_B), TEST_ENV);
      expect(((await forB.json()) as { theme: string | null }).theme).toBe('dark');
    });

    it('lets two devices hold different themes simultaneously', async () => {
      await app.fetch(makeRequest('PUT', '/api/config/theme', { theme: 'eink' }, DEVICE_A), TEST_ENV);
      await app.fetch(makeRequest('PUT', '/api/config/theme', { theme: 'oled' }, DEVICE_B), TEST_ENV);

      const forA = await app.fetch(makeRequest('GET', '/api/config/theme', undefined, DEVICE_A), TEST_ENV);
      const forB = await app.fetch(makeRequest('GET', '/api/config/theme', undefined, DEVICE_B), TEST_ENV);

      expect(((await forA.json()) as { theme: string | null }).theme).toBe('eink');
      expect(((await forB.json()) as { theme: string | null }).theme).toBe('oled');
    });

    it('treats a request without the header as the legacy global client', async () => {
      await app.fetch(makeRequest('PUT', '/api/config/theme', { theme: 'dark' }, DEVICE_A), TEST_ENV);

      // No header → must NOT see device A's override
      const res = await app.fetch(makeRequest('GET', '/api/config/theme'), TEST_ENV);
      const body = (await res.json()) as { theme: string | null };
      expect(body.theme).toBeNull();
    });
  });

  describe('PUT /api/config/theme', () => {
    it('echoes the resolved theme and the device it was stored for', async () => {
      const res = await app.fetch(
        makeRequest('PUT', '/api/config/theme', { theme: 'oled' }, DEVICE_A),
        TEST_ENV
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; theme: string; deviceId: string | null };
      expect(body.success).toBe(true);
      expect(body.theme).toBe('oled');
      expect(body.deviceId).toBe(DEVICE_A);
    });

    it('writes an override row for the device, not the global config', async () => {
      await app.fetch(makeRequest('PUT', '/api/config/theme', { theme: 'oled' }, DEVICE_A), TEST_ENV);

      const row = await env.DB
        .prepare('SELECT value FROM device_settings WHERE device_id = ? AND key = ?')
        .bind(DEVICE_A, 'theme')
        .first<{ value: string }>();
      expect(row?.value).toBe('oled');

      const global = await env.DB
        .prepare("SELECT value FROM config WHERE key = 'theme'")
        .first<{ value: string }>();
      expect(global).toBeNull();
    });

    it('writes to the global config when no device header is sent', async () => {
      await app.fetch(makeRequest('PUT', '/api/config/theme', { theme: 'light' }), TEST_ENV);

      const global = await env.DB
        .prepare("SELECT value FROM config WHERE key = 'theme'")
        .first<{ value: string }>();
      expect(global?.value).toBe('light');
    });

    it('rejects an invalid theme even with a valid device id', async () => {
      const res = await app.fetch(
        makeRequest('PUT', '/api/config/theme', { theme: 'solarized' }, DEVICE_A),
        TEST_ENV
      );
      expect(res.status).toBe(400);
    });
  });

  describe('language', () => {
    it('resolves the device override before the global value', async () => {
      await app.fetch(makeRequest('PUT', '/api/config/language', { language: 'zh' }), TEST_ENV);
      await app.fetch(
        makeRequest('PUT', '/api/config/language', { language: 'en' }, DEVICE_A),
        TEST_ENV
      );

      const forA = await app.fetch(
        makeRequest('GET', '/api/config/language', undefined, DEVICE_A),
        TEST_ENV
      );
      expect(((await forA.json()) as { language: string | null }).language).toBe('en');

      const forB = await app.fetch(
        makeRequest('GET', '/api/config/language', undefined, DEVICE_B),
        TEST_ENV
      );
      expect(((await forB.json()) as { language: string | null }).language).toBe('zh');
    });

    it('rejects an invalid language', async () => {
      const res = await app.fetch(
        makeRequest('PUT', '/api/config/language', { language: 'fr' }, DEVICE_A),
        TEST_ENV
      );
      expect(res.status).toBe(400);
    });
  });

  describe('device id validation', () => {
    it('ignores a malformed device id instead of creating junk rows', async () => {
      const res = await app.fetch(
        makeRequest('PUT', '/api/config/theme', { theme: 'dark' }, 'not-a-uuid'),
        TEST_ENV
      );
      expect(res.status).toBe(200);

      // Treated as no device → written globally
      const global = await env.DB
        .prepare("SELECT value FROM config WHERE key = 'theme'")
        .first<{ value: string }>();
      expect(global?.value).toBe('dark');

      const rows = await env.DB.prepare('SELECT COUNT(*) AS n FROM device_settings').first<{ n: number }>();
      expect(rows?.n).toBe(0);
    });

    it('registers a device on first contact and refreshes it on the next', async () => {
      await app.fetch(makeRequest('GET', '/api/config/theme', undefined, DEVICE_A), TEST_ENV);

      const first = await env.DB
        .prepare('SELECT id FROM devices WHERE id = ?')
        .bind(DEVICE_A)
        .first<{ id: string }>();
      expect(first?.id).toBe(DEVICE_A);

      // Second call must not throw on the primary-key conflict
      const res = await app.fetch(makeRequest('GET', '/api/config/theme', undefined, DEVICE_A), TEST_ENV);
      expect(res.status).toBe(200);

      const count = await env.DB
        .prepare('SELECT COUNT(*) AS n FROM devices WHERE id = ?')
        .bind(DEVICE_A)
        .first<{ n: number }>();
      expect(count?.n).toBe(1);
    });
  });
});
