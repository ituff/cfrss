/**
 * Authentication middleware for the single-user RSS reader.
 * Validates a Bearer token from the Authorization header against env.AUTH_TOKEN.
 * Skips authentication for non-API routes (static files, SPA shell).
 */
import type { Context, Next } from 'hono';
import type { Env } from '../types';

export function authMiddleware() {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    const path = c.req.path;

    // Skip auth for non-API routes (static assets, SPA shell)
    if (!path.startsWith('/api/')) {
      return next();
    }

    const authHeader = c.req.header('Authorization');

    if (!authHeader) {
      return c.json({ code: 'UNAUTHORIZED', message: 'Missing Authorization header', retryable: false }, 401);
    }

    const token = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : null;

    if (!token || token !== c.env.AUTH_TOKEN) {
      return c.json({ code: 'UNAUTHORIZED', message: 'Invalid or missing Bearer token', retryable: false }, 401);
    }

    await next();
  };
}
