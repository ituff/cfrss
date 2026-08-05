import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { authMiddleware } from '../../src/middleware/auth';
import type { Env } from '../../src/types';

function createApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.use('*', authMiddleware());
  app.get('/api/test', (c) => c.json({ ok: true }));
  app.get('/static/app.js', (c) => c.text('console.log("app")'));
  app.get('/', (c) => c.html('<html></html>'));
  return app;
}

function makeRequest(path: string, headers?: Record<string, string>) {
  return new Request(`http://localhost${path}`, { headers });
}

describe('authMiddleware', () => {
  const app = createApp();
  const env: Env = { DB: {} as D1Database, ENCRYPTION_KEY: 'test-key', AUTH_TOKEN: 'secret-token-123' };

  describe('API routes (require auth)', () => {
    it('returns 401 when Authorization header is missing', async () => {
      const res = await app.fetch(makeRequest('/api/test'), env);
      expect(res.status).toBe(401);
      const body = await res.json() as Record<string, unknown>;
      expect(body.code).toBe('UNAUTHORIZED');
      expect(body.message).toContain('Missing');
    });

    it('returns 401 when token is invalid', async () => {
      const res = await app.fetch(makeRequest('/api/test', { Authorization: 'Bearer wrong-token' }), env);
      expect(res.status).toBe(401);
      const body = await res.json() as Record<string, unknown>;
      expect(body.code).toBe('UNAUTHORIZED');
    });

    it('returns 401 when Authorization header is not Bearer format', async () => {
      const res = await app.fetch(makeRequest('/api/test', { Authorization: 'Basic abc123' }), env);
      expect(res.status).toBe(401);
    });

    it('returns 401 when Bearer token is empty', async () => {
      const res = await app.fetch(makeRequest('/api/test', { Authorization: 'Bearer ' }), env);
      expect(res.status).toBe(401);
    });

    it('passes with valid Bearer token', async () => {
      const res = await app.fetch(makeRequest('/api/test', { Authorization: 'Bearer secret-token-123' }), env);
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body.ok).toBe(true);
    });
  });

  describe('Non-API routes (skip auth)', () => {
    it('skips auth for static files', async () => {
      const res = await app.fetch(makeRequest('/static/app.js'), env);
      expect(res.status).toBe(200);
    });

    it('skips auth for root path', async () => {
      const res = await app.fetch(makeRequest('/'), env);
      expect(res.status).toBe(200);
    });
  });
});
