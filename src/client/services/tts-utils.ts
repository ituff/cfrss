/**
 * TTS utility functions — pure logic extracted for testability.
 *
 * Two responsibilities:
 *   1. Deciding what the "paragraphs" of an article are. `collectLeafBlocks`
 *      is the single source of truth: the same walk feeds both the speech
 *      segmentation and the on-page highlight mapping, so an index can never
 *      drift between the two.
 *   2. Turning paragraphs into speech-sized chunks. The synthesis endpoint
 *      rejects anything over 5,000 characters, and one long <p> used to abort
 *      the whole article — `splitForSpeech` keeps every request small.
 *
 * Nothing here touches `document` except `extractBlocksFromHtml`, and the walk
 * itself only relies on `tagName` / `children` / `textContent`, so it runs
 * against plain objects in the DOM-less Workers test pool.
 */

/** The structural subset of `Element` the paragraph walk needs. */
export interface BlockLike {
  tagName: string;
  children: ArrayLike<BlockLike>;
  textContent: string | null;
}

/**
 * Block-level tags that act as paragraph boundaries.
 * `HTMLElement.tagName` is upper-case for HTML documents.
 */
export const BLOCK_TAGS: ReadonlySet<string> = new Set([
  'P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'LI', 'BLOCKQUOTE', 'PRE', 'SECTION', 'ARTICLE',
  'HEADER', 'FOOTER', 'FIGCAPTION', 'TD', 'TH',
]);

/** Whether this node is a paragraph boundary candidate. */
export function isBlockNode(node: BlockLike): boolean {
  return BLOCK_TAGS.has((node.tagName || '').toUpperCase());
}

/** Whether the node contains a block-level descendant (i.e. is a container). */
export function hasBlockDescendant(node: BlockLike): boolean {
  for (const child of Array.from(node.children)) {
    if (isBlockNode(child) || hasBlockDescendant(child)) {
      return true;
    }
  }
  return false;
}

/**
 * Collect the leaf block elements of a subtree, in document order.
 *
 * A block containing another block is a container and is recursed into; a
 * block with no block descendants is a leaf and becomes one paragraph.
 * Non-block nodes are transparent and recursed into.
 *
 * `HTMLElement` satisfies `BlockLike`, so passing an article body returns
 * `HTMLElement[]` — the exact nodes to highlight.
 */
export function collectLeafBlocks<T extends BlockLike>(root: T): T[] {
  const out: BlockLike[] = [];

  const walk = (node: BlockLike): void => {
    if (isBlockNode(node)) {
      if (hasBlockDescendant(node)) {
        for (const child of Array.from(node.children)) walk(child);
      } else {
        const text = node.textContent?.trim();
        if (text) out.push(node);
      }
      return;
    }
    for (const child of Array.from(node.children)) walk(child);
  };

  walk(root);
  // Safe: every entry came from `root`'s own subtree.
  return out as T[];
}

/** Text of each leaf block, trimmed and empty blocks dropped. */
export function extractBlockTexts(root: BlockLike): string[] {
  return collectLeafBlocks(root).map((block) => block.textContent?.trim() ?? '');
}

/**
 * Parse an HTML string into paragraph texts (DOM adapter for
 * `extractBlockTexts`). Falls back to the whole text when the markup has no
 * block elements at all.
 */
export function extractBlocksFromHtml(html: string): string[] {
  if (!html || !html.trim()) {
    return [];
  }

  const container = document.createElement('div');
  container.innerHTML = html;

  const blocks = extractBlockTexts(container).filter((text) => text.length > 0);
  if (blocks.length > 0) {
    return blocks;
  }

  const fallback = container.textContent?.trim();
  return fallback ? [fallback] : [];
}

/**
 * Upper bound for one synthesis request, in characters. Deliberately below
 * the server's 5,000-char cap: Edge TTS quality degrades on very long inputs
 * long before it refuses them.
 */
export const SPEECH_CHUNK_MAX = 1800;

/** One synthesis request: a slice of a paragraph. */
export interface SpeechSegment {
  /** Text sent to the synthesis endpoint. */
  text: string;
  /** Index into the article's paragraphs — drives highlighting and the reader view. */
  blockIndex: number;
  /** Index of this slice within its paragraph. */
  chunkIndex: number;
  /** Number of slices the paragraph was split into (1 when it fits). */
  chunkCount: number;
}

/** Characters that end a sentence outright (CJK needs no following space). */
const HARD_STOPS = '。！？；\n';

/** Latin terminators only end a sentence when followed by whitespace or EOF. */
const LATIN_STOPS = '.!?;';

/** Closing punctuation/space that belongs to the sentence it follows. */
const TRAILING = /[\s”"’'）)】」』]/;

/**
 * Split text into sentences, keeping every character. CJK terminators cut
 * immediately; a Latin `.`/`!`/`?`/`;` only cuts when followed by whitespace
 * or the end of the string, so `3.14` and `v1.2.3` stay intact.
 */
function splitSentences(text: string): string[] {
  const sentences: string[] = [];
  let start = 0;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    let cut = HARD_STOPS.includes(ch);

    if (!cut && LATIN_STOPS.includes(ch)) {
      const next = text[i + 1];
      cut = next === undefined || /\s/.test(next);
    }

    if (!cut) continue;

    let end = i + 1;
    while (end < text.length && TRAILING.test(text[end])) end++;

    sentences.push(text.slice(start, end));
    start = end;
    i = end - 1;
  }

  if (start < text.length) {
    sentences.push(text.slice(start));
  }

  return sentences;
}

/**
 * Cut an over-long sentence into pieces of at most `max` characters,
 * preferring to break at the last space or comma in the final 20 %.
 */
function hardSplit(text: string, max: number): string[] {
  const chunks: string[] = [];
  let rest = text;

  while (rest.length > max) {
    const windowStart = max - Math.floor(max * 0.2);
    let cut = max;

    for (let i = max - 1; i >= windowStart; i--) {
      const ch = rest[i];
      if (ch === ' ' || ch === ',' || ch === '，' || ch === '、') {
        cut = i + 1;
        break;
      }
    }

    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }

  if (rest) chunks.push(rest);
  return chunks;
}

/**
 * Split one paragraph into synthesis-sized chunks.
 *
 * Guarantees: every chunk is at most `max` characters, and
 * `chunks.join('') === text` — no character is dropped or duplicated, so the
 * reader never silently loses a word. Whitespace-only input yields `[]`.
 */
export function splitForSpeech(text: string, max: number = SPEECH_CHUNK_MAX): string[] {
  if (!text || !text.trim()) {
    return [];
  }
  if (text.length <= max) {
    return [text];
  }

  const chunks: string[] = [];
  let buffer = '';

  for (const sentence of splitSentences(text)) {
    if (sentence.length > max) {
      if (buffer) {
        chunks.push(buffer);
        buffer = '';
      }
      chunks.push(...hardSplit(sentence, max));
      continue;
    }

    if (buffer.length + sentence.length > max) {
      chunks.push(buffer);
      buffer = sentence;
    } else {
      buffer += sentence;
    }
  }

  if (buffer) chunks.push(buffer);
  return chunks;
}

/**
 * Flatten paragraphs into speech segments, remembering which paragraph each
 * segment came from so highlighting stays correct across splits.
 */
export function buildSegments(
  blocks: readonly string[],
  max: number = SPEECH_CHUNK_MAX
): SpeechSegment[] {
  const segments: SpeechSegment[] = [];

  blocks.forEach((block, blockIndex) => {
    const chunks = splitForSpeech(block, max);
    chunks.forEach((text, chunkIndex) => {
      segments.push({ text, blockIndex, chunkIndex, chunkCount: chunks.length });
    });
  });

  return segments;
}

/**
 * Default Edge (Microsoft) neural voices used for read-aloud.
 * The read-aloud Worker requires an explicit voiceName per request,
 * so paragraphs are classified by script before synthesis.
 */
const VOICE_BY_SCRIPT: Array<{ pattern: RegExp; voice: string }> = [
  { pattern: /[\u3040-\u30ff]/, voice: 'ja-JP-NanamiNeural' },   // Kana
  { pattern: /[\uac00-\ud7af]/, voice: 'ko-KR-SunHiNeural' },    // Hangul
  { pattern: /[\u0400-\u04ff]/, voice: 'ru-RU-SvetlanaNeural' }, // Cyrillic
  { pattern: /[\u4e00-\u9fff]/, voice: 'zh-CN-XiaoxiaoNeural' }, // CJK ideographs
];

const DEFAULT_VOICE = 'en-US-AriaNeural';

/**
 * Pick a suitable neural voice for a text passage based on its script.
 * Pure function so it can be unit-tested without DOM APIs.
 */
export function detectVoiceName(text: string): string {
  for (const { pattern, voice } of VOICE_BY_SCRIPT) {
    if (pattern.test(text)) {
      return voice;
    }
  }
  return DEFAULT_VOICE;
}

/**
 * Sentinel meaning "choose a voice automatically from each paragraph's
 * script" (the default, script-aware behaviour).
 */
export const AUTO_VOICE = 'auto';

/** A selectable voice entry shown in the settings panel. */
export interface VoiceOption {
  /** Voice id sent to the read-aloud service (or AUTO_VOICE). */
  id: string;
  /** BCP-47-ish language tag used for the option's group label. */
  lang: string;
  /** Whether this voice reads Chinese. */
  chinese?: boolean;
}

/**
 * Curated list of Edge neural voices exposed in the settings panel.
 * Kept deliberately small: these are the languages this reader is
 * actually used with, and a long list is hard to scan on mobile.
 */
export const VOICE_OPTIONS: readonly VoiceOption[] = [
  // Chinese (Simplified)
  { id: 'zh-CN-XiaoxiaoNeural', lang: 'zh-CN', chinese: true },
  { id: 'zh-CN-XiaoyiNeural', lang: 'zh-CN', chinese: true },
  { id: 'zh-CN-YunxiNeural', lang: 'zh-CN', chinese: true },
  { id: 'zh-CN-YunjianNeural', lang: 'zh-CN', chinese: true },
  { id: 'zh-CN-YunyangNeural', lang: 'zh-CN', chinese: true },
  { id: 'zh-CN-liaoning-XiaobeiNeural', lang: 'zh-CN', chinese: true },
  { id: 'zh-CN-shaanxi-XiaoniNeural', lang: 'zh-CN', chinese: true },
  // Chinese (Traditional / HK)
  { id: 'zh-HK-HiuMaanNeural', lang: 'zh-HK', chinese: true },
  { id: 'zh-HK-HiuGaaiNeural', lang: 'zh-HK', chinese: true },
  // Chinese (Traditional / TW)
  { id: 'zh-TW-HsiaoChenNeural', lang: 'zh-TW', chinese: true },
  { id: 'zh-TW-HsiaoYuNeural', lang: 'zh-TW', chinese: true },
  // English
  { id: 'en-US-AriaNeural', lang: 'en-US' },
  { id: 'en-US-JennyNeural', lang: 'en-US' },
  { id: 'en-US-GuyNeural', lang: 'en-US' },
  { id: 'en-GB-SoniaNeural', lang: 'en-GB' },
  // Others covered by script detection
  { id: 'ja-JP-NanamiNeural', lang: 'ja-JP' },
  { id: 'ko-KR-SunHiNeural', lang: 'ko-KR' },
  { id: 'ru-RU-SvetlanaNeural', lang: 'ru-RU' },
];

/**
 * Resolve the voice to send for one paragraph.
 *
 * - An explicit voice id (`preferred` not 'auto'/empty) always wins —
 *   the user's choice overrides script detection.
 * - Otherwise fall back to script detection, so a mixed-language
 *   article still gets a sensible voice per paragraph.
 *
 * Pure function, safe to unit-test without DOM APIs.
 */
export function resolveVoiceName(text: string, preferred?: string | null): string {
  const choice = (preferred ?? '').trim();
  if (choice && choice !== AUTO_VOICE) {
    return choice;
  }
  return detectVoiceName(text);
}

/**
 * Whether a stored voice value should be presented as "auto" in the UI.
 */
export function isAutoVoice(voice?: string | null): boolean {
  const value = (voice ?? '').trim();
  return value === '' || value === AUTO_VOICE;
}
