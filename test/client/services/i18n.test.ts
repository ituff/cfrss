import { describe, it, expect, beforeEach } from 'vitest';
import {
  translations,
  t,
  setLanguage,
  getLanguage,
  initI18n,
  onLanguageChange,
  getTranslationKeys,
} from '../../../src/client/services/i18n';

describe('i18n module', () => {
  beforeEach(() => {
    // Reset to known state
    setLanguage('en');
  });

  describe('translation completeness', () => {
    it('all keys in en exist in zh', () => {
      const enKeys = Object.keys(translations.en);
      const zhKeys = Object.keys(translations.zh);
      for (const key of enKeys) {
        expect(zhKeys).toContain(key);
      }
    });

    it('all keys in zh exist in en', () => {
      const enKeys = Object.keys(translations.en);
      const zhKeys = Object.keys(translations.zh);
      for (const key of zhKeys) {
        expect(enKeys).toContain(key);
      }
    });

    it('no translation value is empty string', () => {
      for (const lang of ['zh', 'en'] as const) {
        const dict = translations[lang];
        for (const [key, value] of Object.entries(dict)) {
          expect(value.length, `${lang}.${key} should not be empty`).toBeGreaterThan(0);
        }
      }
    });

    it('zh and en have exactly the same keys', () => {
      const enKeys = Object.keys(translations.en).sort();
      const zhKeys = Object.keys(translations.zh).sort();
      expect(enKeys).toEqual(zhKeys);
    });
  });

  describe('t() function', () => {
    it('returns English translation when language is en', () => {
      setLanguage('en');
      expect(t('home')).toBe('Home');
      expect(t('subscriptions')).toBe('Subscriptions');
    });

    it('returns Chinese translation when language is zh', () => {
      setLanguage('zh');
      expect(t('home')).toBe('首页');
      expect(t('subscriptions')).toBe('订阅');
    });

    it('returns the key itself for unknown keys', () => {
      expect(t('nonexistent_key')).toBe('nonexistent_key');
    });
  });

  describe('language switching', () => {
    it('setLanguage changes the active language', () => {
      setLanguage('zh');
      expect(getLanguage()).toBe('zh');
      setLanguage('en');
      expect(getLanguage()).toBe('en');
    });

    it('switching language updates t() output without reload', () => {
      setLanguage('en');
      expect(t('daily_digest')).toBe('Daily Digest');
      setLanguage('zh');
      expect(t('daily_digest')).toBe('每日摘要');
    });

    it('notifies listeners on language change', () => {
      const changes: string[] = [];
      const unsubscribe = onLanguageChange((lang) => changes.push(lang));

      setLanguage('zh');
      setLanguage('en');

      expect(changes).toEqual(['zh', 'en']);
      unsubscribe();
    });

    it('does not notify if setting same language', () => {
      setLanguage('en');
      const changes: string[] = [];
      onLanguageChange((lang) => changes.push(lang));

      setLanguage('en'); // same language, no notification
      expect(changes).toEqual([]);
    });

    it('unsubscribe removes listener', () => {
      const changes: string[] = [];
      const unsubscribe = onLanguageChange((lang) => changes.push(lang));

      setLanguage('zh');
      unsubscribe();
      setLanguage('en');

      expect(changes).toEqual(['zh']);
    });
  });

  describe('auto-detection', () => {
    it('detects zh for zh-CN', () => {
      initI18n('zh-CN');
      expect(getLanguage()).toBe('zh');
    });

    it('detects zh for zh-TW', () => {
      initI18n('zh-TW');
      expect(getLanguage()).toBe('zh');
    });

    it('detects zh for zh', () => {
      initI18n('zh');
      expect(getLanguage()).toBe('zh');
    });

    it('detects en for en-US', () => {
      initI18n('en-US');
      expect(getLanguage()).toBe('en');
    });

    it('detects en for fr', () => {
      initI18n('fr');
      expect(getLanguage()).toBe('en');
    });

    it('detects en for ja', () => {
      initI18n('ja');
      expect(getLanguage()).toBe('en');
    });

    it('defaults to en for empty string', () => {
      initI18n('');
      expect(getLanguage()).toBe('en');
    });
  });

  describe('getTranslationKeys', () => {
    it('returns all keys from translations', () => {
      const keys = getTranslationKeys();
      expect(keys.length).toBeGreaterThan(0);
      expect(keys).toContain('home');
      expect(keys).toContain('daily_digest');
      expect(keys).toContain('offline_mode');
    });
  });
});
