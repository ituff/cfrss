/**
 * Theme Engine — Client-side theme management service.
 *
 * The FOUC-prevention inline script in index.html handles initial theme
 * application before first paint (localStorage → prefers-color-scheme → light).
 *
 * This service handles:
 * - Syncing localStorage theme with server (Config_Store) after page load
 * - Providing programmatic applyTheme / getCurrentTheme helpers
 * - Fallback chain when Config_Store read fails (requirement 2.5):
 *   Config_Store → prefers-color-scheme → light
 *
 * Requirements: 2.3, 2.4, 2.5
 */

export type Theme = 'light' | 'dark' | 'oled' | 'eink';

import { getDeviceId } from './device.js';

export const THEMES: readonly Theme[] = ['light', 'dark', 'oled', 'eink'];

/**
 * Type guard: check whether an unknown value is a valid theme id.
 */
export function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value);
}

const STORAGE_KEY = 'theme';

/**
 * Device-scoped mirror of the resolved theme.
 *
 * Why a second key: themes are now stored per device on the server, and the
 * server value can only be read *after* the page loads — too late to prevent
 * a wrong-theme flash. This key caches the last theme the server handed this
 * device, so the inline script in index.html can paint correctly on the very
 * first frame. It is a cache, never the source of truth.
 */
export const DEVICE_THEME_KEY = 'theme_device';

/**
 * Persist the resolved theme as this device's first-paint cache.
 * Called after the server value is known, not on every toggle.
 */
export function cacheThemeForDevice(theme: Theme): void {
  try {
    localStorage.setItem(DEVICE_THEME_KEY, theme);
  } catch {
    // Silently ignore storage failures
  }
}

/** Read the cached per-device theme, if any. */
export function getCachedDeviceTheme(): Theme | null {
  try {
    const value = localStorage.getItem(DEVICE_THEME_KEY);
    if (isTheme(value)) return value;
  } catch {
    // ignore
  }
  return null;
}

/**
 * Detect theme from OS preference via media query.
 * Falls back to 'light' if matchMedia is unavailable.
 */
function getOSPreference(): Theme {
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'light';
}

/**
 * Read theme from localStorage.
 * Returns null if not set or invalid.
 */
function getStoredTheme(): Theme | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isTheme(stored)) {
      return stored;
    }
  } catch {
    // localStorage may be unavailable (e.g. private browsing in some browsers)
  }
  return null;
}

/** Browser chrome color per theme (meta name="theme-color"). */
const THEME_COLORS: Record<Theme, string> = {
  light: '#ffffff',
  dark: '#202020',
  oled: '#000000',
  eink: '#ffffff',
};

/**
 * Apply a theme to the document and persist it locally.
 *
 * Writes both localStorage keys on purpose:
 *  - `theme`        — the shared/legacy key, still honoured as a fallback
 *  - `theme_device` — this device's first-paint cache; every application is
 *                     either the user's explicit choice here or the value the
 *                     server resolved *for this device*, so it is always safe
 *                     to mirror. This is what makes the e-reader and the iPad
 *                     paint their own theme on the first frame.
 */
export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
  document.querySelector?.('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[theme]);
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Silently ignore storage failures
  }
  cacheThemeForDevice(theme);
}

/**
 * Get the currently active theme from the DOM attribute.
 * Falls back to localStorage → OS preference → light.
 */
export function getCurrentTheme(): Theme {
  const domTheme = document.documentElement.getAttribute('data-theme');
  if (isTheme(domTheme)) {
    return domTheme;
  }

  const stored = getStoredTheme();
  if (stored) {
    return stored;
  }

  return getOSPreference();
}

/**
 * Fetch the theme preference from the server (Config_Store).
 *
 * The server resolves this device's theme first and falls back to the global
 * value, so sending the device id is what makes the e-reader and the iPad show
 * different themes. Returns null if the request fails or returns no valid theme.
 */
async function fetchServerTheme(): Promise<Theme | null> {
  try {
    const headers: Record<string, string> = {};
    const deviceId = getDeviceId();
    if (deviceId) headers['X-Device-Id'] = deviceId;

    const res = await fetch('/api/config/theme', { headers });
    if (res.ok) {
      const data = (await res.json()) as { theme: Theme | null };
      if (isTheme(data.theme)) {
        return data.theme;
      }
    }
  } catch {
    // Network error or server unavailable — graceful degradation (req 2.5)
  }
  return null;
}

/**
 * Initialize the theme engine.
 *
 * Called after page load to sync with the server. The inline script in
 * index.html has already applied a theme before first paint, so this
 * function only updates if the server has a different preference.
 *
 * Fallback chain: device value (server) → global value (server) →
 * cached device theme → prefers-color-scheme → light
 */
export async function initTheme(): Promise<void> {
  // Attempt to sync with server
  const serverTheme = await fetchServerTheme();

  if (serverTheme) {
    // Server resolved this device's theme — refresh the first-paint cache so
    // the next load renders correctly before any network round-trip.
    cacheThemeForDevice(serverTheme);
    const current = getCurrentTheme();
    if (serverTheme !== current) {
      applyTheme(serverTheme);
    }
  } else {
    // Server unreachable — prefer the device cache from the last successful
    // sync over the shared `theme` key, since it reflects this device.
    const cached = getCachedDeviceTheme();
    if (cached) {
      applyTheme(cached);
      return;
    }

    // Config_Store read failed (req 2.5): fall back to OS preference → light
    const stored = getStoredTheme();
    if (!stored) {
      // No localStorage value either — apply OS preference fallback
      const osTheme = getOSPreference();
      applyTheme(osTheme);
    }
    // If localStorage already has a value, the inline script already applied it
  }
}
