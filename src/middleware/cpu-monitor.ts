/**
 * CPU time monitoring middleware for Cloudflare Workers free tier.
 *
 * Cloudflare Workers free tier allows 10ms CPU time per request.
 * Actual CPU time isn't directly measurable in Workers, but we use
 * Date.now() as a wall-clock proxy to detect long-running requests.
 *
 * This middleware:
 * - Records the request start time
 * - Sets a context variable so handlers can check elapsed time
 * - Adds `X-Request-Duration` header to all responses
 * - Adds `X-Truncated: true` header if the response was truncated
 *
 * Handlers can use the `cpuMonitor` helper to check if they should
 * return early with partial results.
 */
import type { Context, Next, MiddlewareHandler } from 'hono';
import type { Env } from '../types';

/** Hono context variables set by the CPU monitor middleware */
export interface CpuMonitorVariables {
  requestStartTime: number;
  truncated: boolean;
}

/** Default CPU budget in milliseconds (slightly under the 10ms hard limit) */
export const CPU_BUDGET_MS = 8;

/** Target response time for standard page requests */
export const RESPONSE_TARGET_MS = 200;

/**
 * Hono middleware that tracks request timing and flags truncation.
 */
export function cpuMonitorMiddleware(): MiddlewareHandler<{ Bindings: Env }> {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    const startTime = Date.now();

    // Store start time in context for handler access
    c.set('requestStartTime' as never, startTime as never);

    await next();

    const elapsed = Date.now() - startTime;

    // Always add timing header for observability
    c.header('X-Request-Duration', `${elapsed}ms`);

    // If the response was flagged as truncated by a handler, ensure header is set
    if (c.get('truncated' as never)) {
      c.header('X-Truncated', 'true');
    }
  };
}

/**
 * Check if the current request is approaching the CPU time budget.
 * Handlers can call this to decide whether to return early with partial results.
 *
 * @param c - Hono context
 * @param budgetMs - Time budget in ms (defaults to CPU_BUDGET_MS)
 * @returns true if elapsed time is approaching the budget
 */
export function isApproachingCpuLimit(c: Context, budgetMs: number = CPU_BUDGET_MS): boolean {
  const startTime = c.get('requestStartTime' as never) as number | undefined;
  if (!startTime) return false;

  const elapsed = Date.now() - startTime;
  return elapsed >= budgetMs;
}

/**
 * Mark the current response as truncated.
 * This will cause the middleware to add X-Truncated: true to the response.
 *
 * @param c - Hono context
 */
export function markTruncated(c: Context): void {
  c.set('truncated' as never, true as never);
}

/**
 * Default page size limit for list endpoints.
 * Keeps responses small to stay within CPU time limits.
 */
export const DEFAULT_PAGE_LIMIT = 50;

/**
 * Maximum page size allowed for list endpoints.
 */
export const MAX_PAGE_LIMIT = 100;

/**
 * Parse and clamp a page limit from a query parameter.
 *
 * @param limitParam - Raw query parameter value (string or undefined)
 * @param defaultLimit - Default limit if not specified
 * @returns Clamped limit value between 1 and MAX_PAGE_LIMIT
 */
export function parsePageLimit(limitParam: string | undefined, defaultLimit: number = DEFAULT_PAGE_LIMIT): number {
  if (!limitParam) return defaultLimit;

  const parsed = parseInt(limitParam, 10);
  if (isNaN(parsed) || parsed < 1) return defaultLimit;

  return Math.min(parsed, MAX_PAGE_LIMIT);
}
