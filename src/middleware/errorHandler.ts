/**
 * Global error handler middleware for Hono.
 * Catches AppError instances and returns structured JSON error responses.
 * Unknown errors are returned as 500 Internal Server Error.
 */
import type { Context } from 'hono';
import { AppError } from '../utils/errors';

export function errorHandler(err: Error, c: Context): Response {
  if (err instanceof AppError) {
    return c.json(err.toJSON(), err.statusCode as any);
  }

  // Unknown/unexpected errors
  console.error('Unhandled error:', err);
  return c.json(
    {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
      retryable: false,
    },
    500
  );
}
