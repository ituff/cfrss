/**
 * i18n — `<html lang>` stays in sync with the active language.
 *
 * Regression: `index.html` hardcodes `lang="en"` (correct for the default
 * locale on first paint), but nothing updated it when the user switched
 * language. A Chinese UI therefore still declared itself English, so screen
 * readers announced it with English phonetics and the browser applied English
 * font-selection / line-breaking rules to CJK text.
 *
 * The Workers test pool has no DOM, so a stub that records attribute writes is
 * installed before the module is imported.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

interface LangStub {
  attrs: Record<string, string>;
}

function installDom(): LangStub {
  const documentElement: LangStub & { setAttribute: (k: string, v: string) => void; getAttribute: (k: string) => string | null } = {
    attrs: {},
    setAttribute(k: string, v: string) {
      this.attrs[k] = v;
    },
    getAttribute(k: string) {
      return this.attrs[k] ?? null;
    },
  };

  (globalThis as unknown as { document: unknown }).document = {
    documentElement,
    querySelector: () => null,
  };
  (globalThis as unknown as { window: unknown }).window = {
    matchMedia: () => ({ matches: false }),
  };
  (globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  };

  return documentElement;
}

describe('i18n document language', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('sets <html lang> from the auto-detected language on init', async () => {
    const html = installDom();
    const { initI18n } = await import('../../src/client/services/i18n');

    initI18n('zh-CN');

    expect(html.attrs['lang']).toBe('zh');
  });

  it('updates <html lang> when the language is switched', async () => {
    const html = installDom();
    const { initI18n, setLanguage } = await import('../../src/client/services/i18n');

    initI18n('en');
    expect(html.attrs['lang']).toBe('en');

    setLanguage('zh');
    expect(html.attrs['lang']).toBe('zh');

    setLanguage('en');
    expect(html.attrs['lang']).toBe('en');
  });

  it('still corrects <html lang> when the resolved language did not change', async () => {
    // The server can resolve the same language the page already had; the
    // equality short-circuit must not skip the DOM write.
    const html = installDom();
    const { initI18n, setLanguage } = await import('../../src/client/services/i18n');

    initI18n('en');
    html.attrs['lang'] = 'stale';

    setLanguage('en');

    expect(html.attrs['lang']).toBe('en');
  });
});
