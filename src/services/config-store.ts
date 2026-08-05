/**
 * Config Store - D1 key-value operations for the config table.
 *
 * Provides typed get/set operations for system configuration values
 * (theme, language, etc.) stored in the D1 `config` table.
 */

/**
 * Get a config value by key.
 * Returns null if the key does not exist.
 */
export async function getConfig(db: D1Database, key: string): Promise<string | null> {
  const stmt = db.prepare('SELECT value FROM config WHERE key = ?').bind(key);
  const row = await stmt.first<{ value: string }>();
  return row ? row.value : null;
}

/**
 * Set a config value (upsert).
 * Uses INSERT OR REPLACE to create or update the value.
 */
export async function setConfig(db: D1Database, key: string, value: string): Promise<void> {
  const stmt = db
    .prepare('INSERT OR REPLACE INTO config (key, value, updated_at) VALUES (?, ?, datetime(\'now\'))')
    .bind(key, value);
  await stmt.run();
}

/**
 * Get the current theme preference.
 * Returns 'light', 'dark', or null if not set.
 */
export async function getTheme(db: D1Database): Promise<'light' | 'dark' | null> {
  const value = await getConfig(db, 'theme');
  if (value === 'light' || value === 'dark') {
    return value;
  }
  return null;
}

/**
 * Set the theme preference.
 */
export async function setTheme(db: D1Database, theme: 'light' | 'dark'): Promise<void> {
  await setConfig(db, 'theme', theme);
}

/**
 * Get the current language preference.
 * Returns 'zh', 'en', or null if not set.
 */
export async function getLanguage(db: D1Database): Promise<'zh' | 'en' | null> {
  const value = await getConfig(db, 'language');
  if (value === 'zh' || value === 'en') {
    return value;
  }
  return null;
}

/**
 * Set the language preference.
 */
export async function setLanguage(db: D1Database, language: 'zh' | 'en'): Promise<void> {
  await setConfig(db, 'language', language);
}
