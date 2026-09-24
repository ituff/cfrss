/**
 * Device identity — client side.
 *
 * Settings such as theme, language and read-aloud voice are stored per device
 * so an e-reader and an iPad don't fight over one value. The device is
 * identified by a UUID generated once in localStorage:
 *
 *   - survives closing the browser, so it behaves like "this device"
 *   - needs no change to the login flow (the Bearer token is still the only
 *     credential; the device id just says *which* of my devices is asking)
 *
 * localStorage is the right home for it precisely because it is NOT shared
 * between the two devices, unlike the server-side config table.
 */

const DEVICE_ID_KEY = 'cfrss_device_id';
const DEVICE_NAME_KEY = 'cfrss_device_name';

/** uuid v4 — must match the server's validation in device-store.ts. */
function generateDeviceId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  // Fallback for browsers without crypto.randomUUID (older Safari on iOS)
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 1

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

let cachedDeviceId: string | null = null;

/**
 * Get this device's stable id, creating and persisting one on first call.
 * Returns null when storage is unavailable (private mode with storage
 * disabled) — callers then fall back to global, non-device settings.
 */
export function getDeviceId(): string | null {
  if (cachedDeviceId) return cachedDeviceId;

  try {
    const existing = localStorage.getItem(DEVICE_ID_KEY);
    if (existing) {
      cachedDeviceId = existing;
      return existing;
    }

    const created = generateDeviceId();
    localStorage.setItem(DEVICE_ID_KEY, created);
    cachedDeviceId = created;
    return created;
  } catch {
    // Storage blocked — no per-device settings this session
    return null;
  }
}

/**
 * A short human-readable label for this device, used for bookkeeping in the
 * `devices` table. Not shown in the UI today.
 */
export function getDeviceName(): string {
  try {
    const stored = localStorage.getItem(DEVICE_NAME_KEY);
    if (stored) return stored;
  } catch {
    // ignore
  }

  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const name = describeDevice(ua);

  try {
    localStorage.setItem(DEVICE_NAME_KEY, name);
  } catch {
    // ignore
  }
  return name;
}

/** Derive a readable "iPad · Safari" style label from a user agent string. */
export function describeDevice(ua: string): string {
  if (!ua) return 'Unknown device';

  const platform =
    /iPad/i.test(ua) ? 'iPad'
    : /iPhone/i.test(ua) ? 'iPhone'
    : /Android/i.test(ua) ? 'Android'
    : /Macintosh|Mac OS X/i.test(ua) ? 'Mac'
    : /Windows/i.test(ua) ? 'Windows'
    : /Linux/i.test(ua) ? 'Linux'
    : 'Unknown';

  const browser =
    /Edg\//i.test(ua) ? 'Edge'
    : /OPR\/|Opera/i.test(ua) ? 'Opera'
    : /Chrome\//i.test(ua) ? 'Chrome'
    : /Firefox\//i.test(ua) ? 'Firefox'
    : /Safari\//i.test(ua) ? 'Safari'
    : 'Browser';

  return `${platform} · ${browser}`;
}

/** Test seam / logout helper — forget this device's id. */
export function resetDeviceId(): void {
  cachedDeviceId = null;
  try {
    localStorage.removeItem(DEVICE_ID_KEY);
    localStorage.removeItem(DEVICE_NAME_KEY);
  } catch {
    // ignore
  }
}
