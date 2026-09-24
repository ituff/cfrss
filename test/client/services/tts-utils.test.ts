import { describe, it, expect } from 'vitest';
import {
  detectVoiceName,
  resolveVoiceName,
  isAutoVoice,
  VOICE_OPTIONS,
  AUTO_VOICE,
} from '../../../src/client/services/tts-utils';

describe('detectVoiceName', () => {
  it('picks a Chinese voice for CJK text', () => {
    expect(detectVoiceName('这是一篇关于技术的文章。')).toBe('zh-CN-XiaoxiaoNeural');
  });

  it('picks a Japanese voice for kana text', () => {
    expect(detectVoiceName('これはテストです。')).toBe('ja-JP-NanamiNeural');
  });

  it('picks a Korean voice for hangul text', () => {
    expect(detectVoiceName('안녕하세요 세계')).toBe('ko-KR-SunHiNeural');
  });

  it('picks a Russian voice for cyrillic text', () => {
    expect(detectVoiceName('Привет, мир')).toBe('ru-RU-SvetlanaNeural');
  });

  it('falls back to an English voice for latin text', () => {
    expect(detectVoiceName('Hello world, this is a test.')).toBe('en-US-AriaNeural');
  });

  it('falls back to an English voice for empty input', () => {
    expect(detectVoiceName('')).toBe('en-US-AriaNeural');
  });
});

describe('resolveVoiceName', () => {
  it('returns the user choice when one is set', () => {
    expect(resolveVoiceName('这是一篇文章', 'zh-CN-YunxiNeural')).toBe('zh-CN-YunxiNeural');
  });

  it('uses script detection when the preference is auto', () => {
    expect(resolveVoiceName('这是一篇文章', AUTO_VOICE)).toBe('zh-CN-XiaoxiaoNeural');
    expect(resolveVoiceName('Hello there', AUTO_VOICE)).toBe('en-US-AriaNeural');
  });

  it('uses script detection when no preference is given', () => {
    expect(resolveVoiceName('这是一篇文章', undefined)).toBe('zh-CN-XiaoxiaoNeural');
    expect(resolveVoiceName('这是一篇文章', null)).toBe('zh-CN-XiaoxiaoNeural');
    expect(resolveVoiceName('这是一篇文章', '')).toBe('zh-CN-XiaoxiaoNeural');
    expect(resolveVoiceName('这是一篇文章', '   ')).toBe('zh-CN-XiaoxiaoNeural');
  });

  it('lets an explicit choice override script detection', () => {
    // English voice forced onto Chinese text — the user asked for it.
    expect(resolveVoiceName('这是中文', 'en-US-GuyNeural')).toBe('en-US-GuyNeural');
  });

  it('trims whitespace around a preference', () => {
    expect(resolveVoiceName('text', '  ja-JP-NanamiNeural  ')).toBe('ja-JP-NanamiNeural');
  });
});

describe('isAutoVoice', () => {
  it('treats empty and missing values as auto', () => {
    expect(isAutoVoice('')).toBe(true);
    expect(isAutoVoice(undefined)).toBe(true);
    expect(isAutoVoice(null)).toBe(true);
    expect(isAutoVoice('   ')).toBe(true);
  });

  it('treats the auto sentinel as auto', () => {
    expect(isAutoVoice(AUTO_VOICE)).toBe(true);
  });

  it('treats a concrete voice id as not auto', () => {
    expect(isAutoVoice('zh-CN-XiaoxiaoNeural')).toBe(false);
  });
});

describe('VOICE_OPTIONS', () => {
  it('exposes a curated, non-empty list', () => {
    expect(VOICE_OPTIONS.length).toBeGreaterThan(5);
  });

  it('uses unique voice ids', () => {
    const ids = VOICE_OPTIONS.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('only contains ids safe to pass as a URL query param', () => {
    for (const option of VOICE_OPTIONS) {
      expect(option.id).toMatch(/^[A-Za-z0-9._-]+$/);
    }
  });

  it('includes the voice used by script detection as the Chinese default', () => {
    expect(VOICE_OPTIONS.some((o) => o.id === 'zh-CN-XiaoxiaoNeural')).toBe(true);
  });

  it('does not include the auto sentinel as a concrete option', () => {
    expect(VOICE_OPTIONS.some((o) => o.id === AUTO_VOICE)).toBe(false);
  });
});
