import { describe, it, expect } from 'vitest';
import { detectLanguage } from '../../src/utils/language';

describe('detectLanguage', () => {
  it('returns "zh" for "zh"', () => {
    expect(detectLanguage('zh')).toBe('zh');
  });

  it('returns "zh" for "zh-CN"', () => {
    expect(detectLanguage('zh-CN')).toBe('zh');
  });

  it('returns "zh" for "zh-TW"', () => {
    expect(detectLanguage('zh-TW')).toBe('zh');
  });

  it('returns "zh" for "zh-Hans"', () => {
    expect(detectLanguage('zh-Hans')).toBe('zh');
  });

  it('returns "en" for "en"', () => {
    expect(detectLanguage('en')).toBe('en');
  });

  it('returns "en" for "en-US"', () => {
    expect(detectLanguage('en-US')).toBe('en');
  });

  it('returns "en" for "fr"', () => {
    expect(detectLanguage('fr')).toBe('en');
  });

  it('returns "en" for "ja"', () => {
    expect(detectLanguage('ja')).toBe('en');
  });

  it('returns "en" for empty string', () => {
    expect(detectLanguage('')).toBe('en');
  });
});
