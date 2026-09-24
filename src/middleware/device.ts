/**
 * Device identity middleware.
 *
 * Resolves the `X-Device-Id` header into `c.get('deviceId')` so handlers can
 * store settings per device. The id is optional: when the header is missing or
 * malformed the value is null and settings fall back to the global config row,
 * which keeps older clients working exactly as before.
 *
 * This is NOT authentication — the Bearer token from authMiddleware() still
 * guards every /api/* route. A device id only distinguishes "which of my
 * devices", and a forged value could at worst read another device's theme.
 * Because of that it is validated (uuid shape) and, when present, recorded in
 * the `devices` table on a best-effort basis.
 */

import type { Context, Next } from 'hono';
import type { Env } from '../types';
import { DEVICE_ID_HEADER, isValidDeviceId, touchDevice } from '../services/device-store';

/** Context key holding the resolved device id (null when absent/invalid). */
export type DeviceContext = {
  Bindings: Env;
  Variables: { deviceId: string | null };
};

/**
 * Read a valid device id from the request, or null.
 */
export function readDeviceId(c: Context): string | null {
  const raw = c.req.header(DEVICE_ID_HEADER);
  return isValidDeviceId(raw) ? raw : null;
}

export function deviceMiddleware() {
  return async (c: Context<DeviceContext>, next: Next) => {
    const deviceId = readDeviceId(c);
    c.set('deviceId', deviceId);

    // Register the device (first contact) and refresh last_seen_at. Only for
    // API routes — static asset requests don't need a DB write — and never
    // allowed to fail the request.
    if (deviceId) {
      try {
        await touchDevice(c.env.DB, deviceId, c.req.header('User-Agent') ?? '');
      } catch {
        // Registry bookkeeping is not worth failing a settings read over
      }
    }

    await next();
  };
}
