import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import {
  getConfig,
  setConfig,
  getTheme,
  setTheme,
  getLanguage,
  setLanguage,
} from '../../src/services/config-store';
import { setupTestDatabase } from '../setup';

describe('Config Store', () => {
  let db: D1Database;

  beforeEach(async () => {
    db = env.DB;
    await setupTestDatabase(db);
  });

  describe('getConfig', () => {
    it('should return null for non-existent key', async () => {
      const result = await getConfig(db, 'nonexistent');
      expect(result).toBeNull();
    });

    it('should return the value for an existing key', async () => {
      await db.prepare("INSERT INTO config (key, value, updated_at) VALUES ('test_key', 'test_value', datetime('now'))").run();
      const result = await getConfig(db, 'test_key');
      expect(result).toBe('test_value');
    });
  });

  describe('setConfig', () => {
    it('should insert a new config value', async () => {
      await setConfig(db, 'new_key', 'new_value');
      const result = await getConfig(db, 'new_key');
      expect(result).toBe('new_value');
    });

    it('should update an existing config value (upsert)', async () => {
      await setConfig(db, 'my_key', 'first');
      await setConfig(db, 'my_key', 'second');
      const result = await getConfig(db, 'my_key');
      expect(result).toBe('second');
    });

    it('should not create duplicate rows on upsert', async () => {
      await setConfig(db, 'dup_key', 'val1');
      await setConfig(db, 'dup_key', 'val2');
      const rows = await db.prepare("SELECT COUNT(*) as count FROM config WHERE key = 'dup_key'").first<{ count: number }>();
      expect(rows?.count).toBe(1);
    });
  });

  describe('getTheme', () => {
    it('should return null when theme is not set', async () => {
      const result = await getTheme(db);
      expect(result).toBeNull();
    });

    it('should return "light" when theme is set to light', async () => {
      await setConfig(db, 'theme', 'light');
      const result = await getTheme(db);
      expect(result).toBe('light');
    });

    it('should return "dark" when theme is set to dark', async () => {
      await setConfig(db, 'theme', 'dark');
      const result = await getTheme(db);
      expect(result).toBe('dark');
    });

    it('should return null for invalid theme value', async () => {
      await setConfig(db, 'theme', 'invalid');
      const result = await getTheme(db);
      expect(result).toBeNull();
    });
  });

  describe('setTheme', () => {
    it('should set theme to light', async () => {
      await setTheme(db, 'light');
      const result = await getConfig(db, 'theme');
      expect(result).toBe('light');
    });

    it('should set theme to dark', async () => {
      await setTheme(db, 'dark');
      const result = await getConfig(db, 'theme');
      expect(result).toBe('dark');
    });

    it('should overwrite existing theme', async () => {
      await setTheme(db, 'light');
      await setTheme(db, 'dark');
      const result = await getTheme(db);
      expect(result).toBe('dark');
    });
  });

  describe('getLanguage', () => {
    it('should return null when language is not set', async () => {
      const result = await getLanguage(db);
      expect(result).toBeNull();
    });

    it('should return "zh" when language is set to zh', async () => {
      await setConfig(db, 'language', 'zh');
      const result = await getLanguage(db);
      expect(result).toBe('zh');
    });

    it('should return "en" when language is set to en', async () => {
      await setConfig(db, 'language', 'en');
      const result = await getLanguage(db);
      expect(result).toBe('en');
    });

    it('should return null for invalid language value', async () => {
      await setConfig(db, 'language', 'fr');
      const result = await getLanguage(db);
      expect(result).toBeNull();
    });
  });

  describe('setLanguage', () => {
    it('should set language to zh', async () => {
      await setLanguage(db, 'zh');
      const result = await getConfig(db, 'language');
      expect(result).toBe('zh');
    });

    it('should set language to en', async () => {
      await setLanguage(db, 'en');
      const result = await getConfig(db, 'language');
      expect(result).toBe('en');
    });

    it('should overwrite existing language', async () => {
      await setLanguage(db, 'zh');
      await setLanguage(db, 'en');
      const result = await getLanguage(db);
      expect(result).toBe('en');
    });
  });
});
