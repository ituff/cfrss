import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { errorHandler } from '../../src/middleware/errorHandler';
import { AppError, validationError, notFoundError, upstreamError } from '../../src/utils/errors';
import type { Env } from '../../src/types';

function createApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.onError(errorHandler);

  app.get('/validation-error', () => {
    throw validationError('Name is required', { field: 'name' });
  });
  app.get('/not-found', () => {
    throw notFoundError('Article not found');
  });
  app.get('/upstream-error', () => {
    throw upstreamError('GitHub API returned 503');
  });
  app.get('/unknown-error', () => {
    throw new Error('Something unexpected');
  });

  return app;
}

function makeRequest(path: string) {
  return new Request(`http://localhost${path}`);
}

describe('errorHandler middleware', () => {
  const app = createApp();
  const env: Env = { DB: {} as D1Database, ENCRYPTION_KEY: 'test-key', AUTH_TOKEN: 'test' };

  it('handles AppError with correct status code and JSON body', async () => {
    const res = await app.fetch(makeRequest('/validation-error'), env);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'Name is required',
      retryable: false,
      details: { field: 'name' },
    });
  });

  it('handles NOT_FOUND error with 404', async () => {
    const res = await app.fetch(makeRequest('/not-found'), env);
    expect(res.status).toBe(404);
    const body = await res.json() as Record<string, unknown>;
    expect(body.code).toBe('NOT_FOUND');
    expect(body.retryable).toBe(false);
  });

  it('handles retryable upstream error with 502', async () => {
    const res = await app.fetch(makeRequest('/upstream-error'), env);
    expect(res.status).toBe(502);
    const body = await res.json() as Record<string, unknown>;
    expect(body.code).toBe('UPSTREAM_ERROR');
    expect(body.retryable).toBe(true);
  });

  it('handles unknown errors as 500', async () => {
    const res = await app.fetch(makeRequest('/unknown-error'), env);
    expect(res.status).toBe(500);
    const body = await res.json() as Record<string, unknown>;
    expect(body.code).toBe('INTERNAL_ERROR');
    expect(body.message).toBe('An unexpected error occurred');
    expect(body.retryable).toBe(false);
  });
});
