import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../../src/types';
import {
  cpuMonitorMiddleware,
  parsePageLimit,
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
} from '../../src/middleware/cpu-monitor';

function createApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.use('*', cpuMonitorMiddleware());
  app.get('/fast', (c) => c.json({ ok: true }));
  app.get('/truncated', (c) => {
    // Simulate a handler that flags truncation
    c.set('truncated' as never, true as never);
    return c.json({ articles: [], truncated: true });
  });
  return app;
}

function makeRequest(path: string) {
  return new Request(`http://localhost${path}`, {
    headers: { Authorization: 'Bearer test' },
  });
}

describe('cpuMonitorMiddleware', () => {
  const app = createApp();
  const env: Env = { DB: {} as D1Database, ENCRYPTION_KEY: 'test-key', AUTH_TOKEN: 'test' };

  it('adds X-Request-Duration header to responses', async () => {
    const res = await app.fetch(makeRequest('/fast'), env);
    expect(res.status).toBe(200);
    const duration = res.headers.get('X-Request-Duration');
    expect(duration).toBeTruthy();
    expect(duration).toMatch(/^\d+ms$/);
  });

  it('adds X-Truncated header when handler flags truncation', async () => {
    const res = await app.fetch(makeRequest('/truncated'), env);
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Truncated')).toBe('true');
  });

  it('does not add X-Truncated header for normal requests', async () => {
    const res = await app.fetch(makeRequest('/fast'), env);
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Truncated')).toBeNull();
  });
});

describe('parsePageLimit', () => {
  it('returns default limit when no param provided', () => {
    expect(parsePageLimit(undefined)).toBe(DEFAULT_PAGE_LIMIT);
  });

  it('returns default limit for empty string', () => {
    expect(parsePageLimit('')).toBe(DEFAULT_PAGE_LIMIT);
  });

  it('returns default limit for non-numeric string', () => {
    expect(parsePageLimit('abc')).toBe(DEFAULT_PAGE_LIMIT);
  });

  it('returns default limit for negative numbers', () => {
    expect(parsePageLimit('-5')).toBe(DEFAULT_PAGE_LIMIT);
  });

  it('returns default limit for zero', () => {
    expect(parsePageLimit('0')).toBe(DEFAULT_PAGE_LIMIT);
  });

  it('parses valid positive numbers', () => {
    expect(parsePageLimit('25')).toBe(25);
    expect(parsePageLimit('1')).toBe(1);
    expect(parsePageLimit('50')).toBe(50);
  });

  it('clamps to MAX_PAGE_LIMIT when exceeding maximum', () => {
    expect(parsePageLimit('200')).toBe(MAX_PAGE_LIMIT);
    expect(parsePageLimit('999')).toBe(MAX_PAGE_LIMIT);
  });

  it('accepts custom default limit', () => {
    expect(parsePageLimit(undefined, 20)).toBe(20);
    expect(parsePageLimit('', 30)).toBe(30);
  });
});
