import type { Context } from 'hono';
import type { Env } from '../types';
import { getTheme, setTheme, getLanguage, setLanguage } from '../services/config-store';
import { validationError } from '../utils/errors';

/**
 * GET /api/config/theme
 *
 * Returns the stored theme preference or null.
 * Fallback chain (handled client-side):
 *   Config_Store value → OS prefers-color-scheme → 'light' default
 */
export async function handleGetTheme(c: Context<{ Bindings: Env }>) {
  const db = c.env.DB;
  const theme = await getTheme(db);
  return c.json({ theme });
}

/**
 * PUT /api/config/theme
 *
 * Accepts { theme: 'light' | 'dark' } in the request body.
 * Returns 400 if the value is missing or invalid.
 */
export async function handleSetTheme(c: Context<{ Bindings: Env }>) {
  const db = c.env.DB;
  const body = await c.req.json<{ theme?: unknown }>();

  if (body.theme !== 'light' && body.theme !== 'dark') {
    const err = validationError('Invalid theme value. Must be "light" or "dark".');
    return c.json(err.toJSON(), 400 as const);
  }

  await setTheme(db, body.theme);
  return c.json({ success: true, theme: body.theme });
}


/**
 * GET /api/config/language
 *
 * Returns the stored language preference or null.
 * When null, the client handles auto-detection via navigator.language:
 *   - Starts with 'zh' → Chinese
 *   - Otherwise → English
 */
export async function handleGetLanguage(c: Context<{ Bindings: Env }>) {
  const db = c.env.DB;
  const language = await getLanguage(db);
  return c.json({ language });
}

/**
 * PUT /api/config/language
 *
 * Accepts { language: 'zh' | 'en' } in the request body.
 * Returns 400 if the value is missing or invalid.
 */
export async function handleSetLanguage(c: Context<{ Bindings: Env }>) {
  const db = c.env.DB;
  const body = await c.req.json<{ language?: unknown }>();

  if (body.language !== 'zh' && body.language !== 'en') {
    const err = validationError('Invalid language value. Must be "zh" or "en".');
    return c.json(err.toJSON(), 400 as const);
  }

  await setLanguage(db, body.language);
  return c.json({ success: true, language: body.language });
}
