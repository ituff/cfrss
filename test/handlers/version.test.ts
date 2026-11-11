/**
 * Version endpoint tests.
 *
 * The interesting cases are the two shapes the platform can hand us: the
 * binding present (production) and absent (`wrangler dev`, tests). The client
 * renders "unknown" for the latter, so the endpoint must not fail there.
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

function makeRequest(path: string, withAuth = true): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (withAuth) headers.Authorization = 'Bearer test-auth-token';
  return new Request(`http://localhost${path}`, { method: 'GET', headers });
}

describe('Version API', () => {
  beforeEach(async () => {
    TEST_ENV.DB = env.DB;
    await setupTestDatabase(env.DB);
  });

  it('returns nulls when the version_metadata binding is absent', async () => {
    const res = await app.fetch(makeRequest('/api/version'), TEST_ENV);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ version: null, tag: null, deployedAt: null });
  });

  it('reports the short id, tag and deploy time when the binding is present', async () => {
    const res = await app.fetch(makeRequest('/api/version'), {
      ...TEST_ENV,
      CF_VERSION_METADATA: {
        id: '0ca00a79-ee4d-41d5-9776-74e7ea1e01a1',
        tag: 'v1.2.3',
        timestamp: '2026-10-23T05:05:06.881Z',
      },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      version: '0ca00a79',
      tag: 'v1.2.3',
      deployedAt: '2026-10-23T05:05:06.881Z',
    });
  });

  it('treats an empty tag as absent', async () => {
    const res = await app.fetch(makeRequest('/api/version'), {
      ...TEST_ENV,
      CF_VERSION_METADATA: { id: 'abcdef12-0000-0000-0000-000000000000', tag: '', timestamp: '2026-10-23T05:05:06.881Z' },
    });

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.version).toBe('abcdef12');
    expect(body.tag).toBeNull();
  });

  it('normalises microsecond timestamps to milliseconds', async () => {
    const res = await app.fetch(makeRequest('/api/version'), {
      ...TEST_ENV,
      CF_VERSION_METADATA: {
        id: 'abcdef12-0000-0000-0000-000000000000',
        timestamp: '2026-10-23T05:36:07.334766Z',
      },
    });

    const body = (await res.json()) as { deployedAt: string };
    expect(body.deployedAt).toBe('2026-10-23T05:36:07.334Z');
  });

  it('requires authentication', async () => {
    const res = await app.fetch(makeRequest('/api/version', false), TEST_ENV);
    expect(res.status).toBe(401);
  });
});
