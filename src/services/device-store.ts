/**
 * Device Store — per-device user settings with a global fallback.
 *
 * Theme, language and the TTS voice used to live in the global `config` table,
 * which meant an e-reader and an iPad had to share one theme. They now resolve
 * per device:
 *
 *     device_settings(device_id, key)  →  config.key  →  null
 *
 * Only values a device has actually overridden are written to
 * `device_settings`; everything else falls through to the global default, so
 * adding a device changes nothing until the user touches a setting on it.
 *
 * `device_id` is a client-generated UUID (see the client device service) sent
 * as the X-Device-Id header. In this single-user app it identifies "which of
 * my devices", it is NOT an authentication credential.
 */

import type { Theme } from '../types';

export type { Theme };

export const DEVICE_ID_HEADER = 'X-Device-Id';

/** uuid v4 shape — the only thing we accept as a device id. */
const DEVICE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Max length for a device-supplied name (the UA is truncated to this on insert). */
const MAX_DEVICE_NAME = 60;
const MAX_USER_AGENT = 300;

/**
 * Whether a value is usable as a device id. Kept strict so a malformed header
 * cannot grow the table with junk rows.
 */
export function isValidDeviceId(value: unknown): value is string {
  return typeof value === 'string' && DEVICE_ID_PATTERN.test(value);
}

// === Device registry ===

/**
 * Record that a device checked in. Creates the row on first contact and
 * refreshes `last_seen_at` afterwards. Best-effort: failures here must never
 * break a settings read, so callers ignore rejections.
 */
export async function touchDevice(
  db: D1Database,
  deviceId: string,
  userAgent = ''
): Promise<void> {
  const ua = String(userAgent ?? '').slice(0, MAX_USER_AGENT);

  await db
    .prepare(
      `INSERT INTO devices (id, user_agent, last_seen_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET
         last_seen_at = datetime('now'),
         user_agent = CASE WHEN excluded.user_agent != '' THEN excluded.user_agent ELSE devices.user_agent END`
    )
    .bind(deviceId, ua)
    .run();
}

/** Update a device's display name (used if a rename UI is ever added). */
export async function renameDevice(
  db: D1Database,
  deviceId: string,
  name: string
): Promise<void> {
  await db
    .prepare('UPDATE devices SET name = ? WHERE id = ?')
    .bind(name.slice(0, MAX_DEVICE_NAME), deviceId)
    .run();
}

// === Per-device settings with global fallback ===

/**
 * Read a settings value for a device.
 *
 * Resolution order: the device's own override, then the global `config`
 * value, then null. A null device id (older client, or a request that did not
 * send the header) reads straight from the global value — which is exactly
 * the pre-device behaviour, so such clients keep working unchanged.
 */
export async function getDeviceSetting(
  db: D1Database,
  deviceId: string | null,
  key: string
): Promise<string | null> {
  if (deviceId) {
    const row = await db
      .prepare('SELECT value FROM device_settings WHERE device_id = ? AND key = ?')
      .bind(deviceId, key)
      .first<{ value: string }>();

    if (row) return row.value;
  }

  const global = await db
    .prepare('SELECT value FROM config WHERE key = ?')
    .bind(key)
    .first<{ value: string }>();

  return global ? global.value : null;
}

/**
 * Write a settings value for a device.
 *
 * When `deviceId` is null the value is written to the global `config` row
 * instead, preserving the old single-setting behaviour for clients that do
 * not identify themselves.
 */
export async function setDeviceSetting(
  db: D1Database,
  deviceId: string | null,
  key: string,
  value: string
): Promise<void> {
  if (deviceId) {
    await db
      .prepare(
        `INSERT OR REPLACE INTO device_settings (device_id, key, value, updated_at)
         VALUES (?, ?, ?, datetime('now'))`
      )
      .bind(deviceId, key, value)
      .run();
    return;
  }

  await db
    .prepare("INSERT OR REPLACE INTO config (key, value, updated_at) VALUES (?, ?, datetime('now'))")
    .bind(key, value)
    .run();
}

/**
 * Drop a device's override so it falls back to the global value again.
 * Returns whether a row was actually removed.
 */
export async function clearDeviceSetting(
  db: D1Database,
  deviceId: string,
  key: string
): Promise<boolean> {
  const result = await db
    .prepare('DELETE FROM device_settings WHERE device_id = ? AND key = ?')
    .bind(deviceId, key)
    .run();

  return (result.meta.changes ?? 0) > 0;
}

// === Typed accessors ===

export const THEMES: readonly Theme[] = ['light', 'dark', 'oled', 'eink'];

function isTheme(value: string | null): value is Theme {
  return value !== null && (THEMES as readonly string[]).includes(value);
}

/** Resolved theme for a device (device override → global → null). */
export async function getThemeForDevice(
  db: D1Database,
  deviceId: string | null
): Promise<Theme | null> {
  const value = await getDeviceSetting(db, deviceId, 'theme');
  return isTheme(value) ? value : null;
}

export async function setThemeForDevice(
  db: D1Database,
  deviceId: string | null,
  theme: Theme
): Promise<void> {
  await setDeviceSetting(db, deviceId, 'theme', theme);
}

/** Resolved language for a device (device override → global → null). */
export async function getLanguageForDevice(
  db: D1Database,
  deviceId: string | null
): Promise<'zh' | 'en' | null> {
  const value = await getDeviceSetting(db, deviceId, 'language');
  return value === 'zh' || value === 'en' ? value : null;
}

export async function setLanguageForDevice(
  db: D1Database,
  deviceId: string | null,
  language: 'zh' | 'en'
): Promise<void> {
  await setDeviceSetting(db, deviceId, 'language', language);
}
