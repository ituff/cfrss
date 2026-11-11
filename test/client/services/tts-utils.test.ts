import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  detectVoiceName,
  resolveVoiceName,
  isAutoVoice,
  VOICE_OPTIONS,
  AUTO_VOICE,
  splitForSpeech,
  buildSegments,
  SPEECH_CHUNK_MAX,
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

describe('splitForSpeech', () => {
  it('leaves text that already fits untouched', () => {
    expect(splitForSpeech('短句。')).toEqual(['短句。']);
  });

  it('returns nothing for empty or whitespace-only input', () => {
    expect(splitForSpeech('')).toEqual([]);
    expect(splitForSpeech('   \n\t ')).toEqual([]);
  });

  it('keeps the default chunk size under the server cap', () => {
    expect(SPEECH_CHUNK_MAX).toBeLessThan(5000);
  });

  it('splits on CJK sentence terminators and respects the limit', () => {
    const chunks = splitForSpeech('一二三。四五六。七八九。', 6);
    expect(chunks).toEqual(['一二三。', '四五六。', '七八九。']);
    expect(chunks.every((c) => c.length <= 6)).toBe(true);
  });

  it('does not split inside a decimal number', () => {
    const chunks = splitForSpeech('Version 3.14 is out. Next sentence.', 20);
    expect(chunks[0]).toBe('Version 3.14 is out.');
    expect(chunks.join('')).toBe('Version 3.14 is out. Next sentence.');
  });

  it('hard-splits a long sentence with no punctuation', () => {
    const input = 'a'.repeat(30);
    const chunks = splitForSpeech(input, 10);
    expect(chunks).toEqual(['a'.repeat(10), 'a'.repeat(10), 'a'.repeat(10)]);
    expect(chunks.join('')).toBe(input);
  });

  it('prefers breaking a wall of text at whitespace', () => {
    const input = 'word '.repeat(20).trimEnd();
    const chunks = splitForSpeech(input, 30);
    expect(chunks.every((c) => c.length <= 30)).toBe(true);
    expect(chunks.join('')).toBe(input);
    // Every chunk but the last ends at a word boundary.
    for (const chunk of chunks.slice(0, -1)) {
      expect(chunk.endsWith(' ')).toBe(true);
    }
  });

  it('never loses or duplicates characters', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0),
        fc.integer({ min: 8, max: 200 }),
        (text, max) => {
          const chunks = splitForSpeech(text, max);
          expect(chunks.join('')).toBe(text);
          expect(chunks.every((c) => c.length <= max)).toBe(true);
        }
      ),
      { numRuns: 60 }
    );
  });
});

describe('buildSegments', () => {
  it('maps every chunk back to the paragraph it came from', () => {
    const blocks = ['short', 'x'.repeat(50)];
    const segments = buildSegments(blocks, 20);

    expect(segments.map((s) => s.blockIndex)).toEqual([0, 1, 1, 1]);
    expect(segments.map((s) => s.chunkIndex)).toEqual([0, 0, 1, 2]);
    expect(segments.map((s) => s.chunkCount)).toEqual([1, 3, 3, 3]);
  });

  it('preserves the full text of every paragraph', () => {
    const blocks = ['第一段。', 'x'.repeat(45)];
    const segments = buildSegments(blocks, 16);

    for (const blockIndex of [0, 1]) {
      const text = segments
        .filter((s) => s.blockIndex === blockIndex)
        .map((s) => s.text)
        .join('');
      expect(text).toBe(blocks[blockIndex]);
    }
  });

  it('returns nothing for no blocks', () => {
    expect(buildSegments([])).toEqual([]);
  });
});
