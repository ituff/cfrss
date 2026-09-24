/**
 * Language detection utility.
 * Shared between client and server code.
 */

export type SupportedLanguage = 'zh' | 'en';

/**
 * Detect language preference from a navigator.language value.
 * If the value starts with 'zh' (e.g., 'zh-CN', 'zh-TW', 'zh'), returns 'zh'.
 * Otherwise returns 'en'.
 */
export function detectLanguage(navigatorLang: string): SupportedLanguage {
  if (navigatorLang.startsWith('zh')) {
    return 'zh';
  }
  return 'en';
}
