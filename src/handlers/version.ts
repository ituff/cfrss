/**
 * Version endpoint — what is actually running on the server.
 *
 * Reads Cloudflare's built-in `version_metadata` binding, which the platform
 * fills with the id and upload timestamp of the Worker version currently
 * serving traffic. That is the point: the settings page must show what is
 * deployed, not what a local build believes it built. The two diverge exactly
 * when it matters.
 *
 * The binding is absent under `wrangler dev` and in the test pool, so every
 * field is nullable and the client renders "unknown" instead of failing.
 */

import type { Context } from 'hono';
import type { Env } from '../types';

export interface VersionInfo {
  /** Short Worker version id, e.g. `0ca00a79`. Null when unknown. */
  version: string | null;
  /** Optional tag set at deploy time. */
  tag: string | null;
  /** ISO 8601 upload time of the deployed version. */
  deployedAt: string | null;
}

/** GET /api/version */
export function handleGetVersion(c: Context<{ Bindings: Env }>) {
  const meta = c.env.CF_VERSION_METADATA;

  const info: VersionInfo = {
    version: meta?.id ? meta.id.slice(0, 8) : null,
    tag: meta?.tag && meta.tag.length > 0 ? meta.tag : null,
    deployedAt: normalizeTimestamp(meta?.timestamp),
  };

  return c.json(info);
}

/**
 * Cloudflare reports microsecond precision (`…05:36:07.334766Z`). Re-emit a
 * canonical millisecond ISO string so the browser's date parser cannot choke
 * on the extra digits — Safari is strict about this.
 */
function normalizeTimestamp(value: string | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
