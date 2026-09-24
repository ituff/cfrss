import { describe, it, expect } from 'vitest';
import {
  TARGET_LANGUAGES,
  TARGET_LANGUAGE_NAMES,
  TARGET_LANGUAGE_LABELS,
  isTargetLanguage,
} from '../../src/utils/translate-languages';

describe('translate-languages', () => {
  it('exposes ten common target languages', () => {
    expect(TARGET_LANGUAGES).toEqual(['zh', 'en', 'ja', 'ko', 'fr', 'de', 'es', 'ru', 'pt', 'it']);
  });

  it('has an English prompt name for every language', () => {
    for (const code of TARGET_LANGUAGES) {
      expect(typeof TARGET_LANGUAGE_NAMES[code]).toBe('string');
      expect(TARGET_LANGUAGE_NAMES[code].length).toBeGreaterThan(0);
    }
  });

  it('has a native label for every language', () => {
    for (const code of TARGET_LANGUAGES) {
      expect(typeof TARGET_LANGUAGE_LABELS[code]).toBe('string');
      expect(TARGET_LANGUAGE_LABELS[code].length).toBeGreaterThan(0);
    }
  });

  it('isTargetLanguage accepts valid codes', () => {
    expect(isTargetLanguage('zh')).toBe(true);
    expect(isTargetLanguage('pt')).toBe(true);
  });

  it('isTargetLanguage rejects invalid values', () => {
    expect(isTargetLanguage('xx')).toBe(false);
    expect(isTargetLanguage('')).toBe(false);
    expect(isTargetLanguage(null)).toBe(false);
    expect(isTargetLanguage(undefined)).toBe(false);
    expect(isTargetLanguage(42)).toBe(false);
  });
});
