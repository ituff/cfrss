/**
 * TTS utility functions — pure logic extracted for testability.
 * These functions work with text/HTML content without requiring DOM APIs
 * in the test environment.
 *
 * Requirements: 10.4 (paragraph boundary detection)
 */

/**
 * Block-level HTML tags that serve as paragraph boundaries.
 * Used to split article content into discrete speech segments.
 */
const BLOCK_TAGS = [
  'p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'li', 'blockquote', 'pre', 'section', 'article',
  'header', 'footer', 'figcaption', 'td', 'th',
];

/**
 * Extract paragraphs from HTML content using regex-based parsing.
 * This is a pure function that doesn't rely on DOM APIs, making it
 * testable in non-browser environments (e.g., Cloudflare Workers tests).
 *
 * Strategy: recursively find block-level elements. If a block element contains
 * nested block elements, recurse into them. Otherwise, extract the text content
 * of the leaf-level block element.
 */
export function extractParagraphsFromHTML(html: string): string[] {
  if (!html || !html.trim()) {
    return [];
  }

  const paragraphs: string[] = [];
  extractFromFragment(html, paragraphs);

  // Fallback: if no block elements found, treat entire content as one paragraph
  if (paragraphs.length === 0) {
    const fullText = stripHtmlTags(html).trim();
    if (fullText) {
      paragraphs.push(fullText);
    }
  }

  return paragraphs;
}

/**
 * Recursively extract text from block elements.
 * If a block element contains child block elements, recurse into those.
 * Otherwise, extract the text content of the block element itself.
 */
function extractFromFragment(html: string, paragraphs: string[]): void {
  // Match any block-level opening tag and find its content
  const blockTagsPattern = BLOCK_TAGS.join('|');
  const blockOpenRegex = new RegExp(
    `<(${blockTagsPattern})(\\s[^>]*)?>([\\s\\S]*?)<\\/\\1>`,
    'gi'
  );

  let match: RegExpExecArray | null;
  let foundBlock = false;

  while ((match = blockOpenRegex.exec(html)) !== null) {
    foundBlock = true;
    const innerContent = match[3];

    // Check if the inner content contains nested block elements
    const hasNestedBlocks = new RegExp(
      `<(${blockTagsPattern})(\\s[^>]*)?>`,
      'i'
    ).test(innerContent);

    if (hasNestedBlocks) {
      // Recurse into nested blocks
      extractFromFragment(innerContent, paragraphs);
    } else {
      // Leaf block — extract text
      const text = stripHtmlTags(innerContent).trim();
      if (text) {
        paragraphs.push(text);
      }
    }
  }

  // If no block elements at this level but there's text, it's handled by the caller's fallback
  if (!foundBlock) {
    const text = stripHtmlTags(html).trim();
    if (text) {
      paragraphs.push(text);
    }
  }
}

/**
 * Strip all HTML tags from a string, leaving only text content.
 */
function stripHtmlTags(html: string): string {
  return html.replace(/<[^>]*>/g, '');
}

/**
 * Get the number of paragraphs in HTML content.
 * Useful for determining how many audio segments to expect.
 */
export function getParagraphCount(html: string): number {
  return extractParagraphsFromHTML(html).length;
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
