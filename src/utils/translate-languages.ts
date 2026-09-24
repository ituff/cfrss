/**
 * Translation target languages.
 * Shared between client and server code:
 * - the client renders the selector from the code list (native labels),
 * - the server validates the requested code and maps it to an English
 *   language name for the LLM prompt.
 */

export const TARGET_LANGUAGES = [
  'zh',
  'en',
  'ja',
  'ko',
  'fr',
  'de',
  'es',
  'ru',
  'pt',
  'it',
] as const;

export type TargetLanguage = (typeof TARGET_LANGUAGES)[number];

/** English language names used inside LLM prompts (server side). */
export const TARGET_LANGUAGE_NAMES: Record<TargetLanguage, string> = {
  zh: 'Simplified Chinese',
  en: 'English',
  ja: 'Japanese',
  ko: 'Korean',
  fr: 'French',
  de: 'German',
  es: 'Spanish',
  ru: 'Russian',
  pt: 'Portuguese',
  it: 'Italian',
};

/** Native endonyms shown in the client selector — intentionally not translated. */
export const TARGET_LANGUAGE_LABELS: Record<TargetLanguage, string> = {
  zh: '中文',
  en: 'English',
  ja: '日本語',
  ko: '한국어',
  fr: 'Français',
  de: 'Deutsch',
  es: 'Español',
  ru: 'Русский',
  pt: 'Português',
  it: 'Italiano',
};

/**
 * Type guard: check whether an unknown value is a supported target language.
 */
export function isTargetLanguage(value: unknown): value is TargetLanguage {
  return typeof value === 'string' && (TARGET_LANGUAGES as readonly string[]).includes(value);
}
