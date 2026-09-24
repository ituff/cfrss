import type { Context } from 'hono';
import type { Env } from '../types';
import {
  getThemeForDevice,
  setThemeForDevice,
  getLanguageForDevice,
  setLanguageForDevice,
} from '../services/device-store';
import type { DeviceContext } from '../middleware/device';
import { validationError } from '../utils/errors';

/** Context type for the device-aware config routes. */
type ConfigContext = Context<DeviceContext>;

/**
 * GET /api/config/theme
 *
 * Returns the theme preference for the calling device, falling back to the
 * global value when that device has no override, or null when neither is set.
 * Fallback chain (handled client-side):
 *   device value → global value → OS prefers-color-scheme → 'light' default
 */
export async function handleGetTheme(c: ConfigContext) {
  const db = c.env.DB;
  const theme = await getThemeForDevice(db, c.get('deviceId'));
  return c.json({ theme, deviceId: c.get('deviceId') });
}

/**
 * PUT /api/config/theme
 *
 * Accepts { theme: 'light' | 'dark' | 'oled' | 'eink' } in the request body.
 * Writes to the calling device's own settings, so an e-reader and an iPad can
 * hold different themes. Returns 400 if the value is missing or invalid.
 */
export async function handleSetTheme(c: ConfigContext) {
  const db = c.env.DB;
  const body = await c.req.json<{ theme?: unknown }>();

  const validThemes = ['light', 'dark', 'oled', 'eink'];
  if (typeof body.theme !== 'string' || !validThemes.includes(body.theme)) {
    const err = validationError('Invalid theme value. Must be "light", "dark", "oled" or "eink".');
    return c.json(err.toJSON(), 400 as const);
  }

  await setThemeForDevice(db, c.get('deviceId'), body.theme as 'light' | 'dark' | 'oled' | 'eink');
  return c.json({ success: true, theme: body.theme, deviceId: c.get('deviceId') });
}

/**
 * GET /api/config/language
 *
 * Returns the language preference for the calling device, falling back to the
 * global value, or null when neither is set.
 * When null, the client handles auto-detection via navigator.language:
 *   - Starts with 'zh' → Chinese
 *   - Otherwise → English
 */
export async function handleGetLanguage(c: ConfigContext) {
  const db = c.env.DB;
  const language = await getLanguageForDevice(db, c.get('deviceId'));
  return c.json({ language, deviceId: c.get('deviceId') });
}

/**
 * PUT /api/config/language
 *
 * Accepts { language: 'zh' | 'en' } in the request body.
 * Writes to the calling device's own settings.
 * Returns 400 if the value is missing or invalid.
 */
export async function handleSetLanguage(c: ConfigContext) {
  const db = c.env.DB;
  const body = await c.req.json<{ language?: unknown }>();

  if (body.language !== 'zh' && body.language !== 'en') {
    const err = validationError('Invalid language value. Must be "zh" or "en".');
    return c.json(err.toJSON(), 400 as const);
  }

  await setLanguageForDevice(db, c.get('deviceId'), body.language);
  return c.json({ success: true, language: body.language, deviceId: c.get('deviceId') });
}
