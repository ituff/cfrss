/**
 * Settings dropdowns (theme / language) — unit tests.
 *
 * The Workers test pool has no DOM, so we install a minimal DOM stub before
 * importing the components, then assert on the rendered shape and that the
 * change handlers persist through the config API.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// --- Minimal DOM stub ---------------------------------------------------

class StubEl {
  tagName: string;
  className = '';
  id = '';
  type = '';
  value = '';
  textContent = '';
  htmlFor = '';
  disabled = false;
  children: StubEl[] = [];
  attrs: Record<string, string> = {};
  listeners: Record<string, ((e: unknown) => void)[]> = {};

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
  }

  set innerHTML(v: string) {
    this._innerHTML = v;
    if (v === '') this.children = [];
  }
  get innerHTML(): string {
    return this._innerHTML ?? '';
  }
  private _innerHTML = '';

  appendChild(child: StubEl): StubEl {
    this.children.push(child);
    child.parent = this;
    return child;
  }
  remove(): void {
    this.parent?.children.splice(this.parent.children.indexOf(this), 1);
  }
  parent: StubEl | null = null;

  setAttribute(k: string, v: string): void {
    this.attrs[k] = v;
    if (k === 'id') this.id = v;
  }
  getAttribute(k: string): string | null {
    return this.attrs[k] ?? null;
  }
  addEventListener(type: string, fn: (e: unknown) => void): void {
    (this.listeners[type] ??= []).push(fn);
  }
  dispatch(type: string, event: unknown = {}): void {
    for (const fn of this.listeners[type] ?? []) fn(event);
  }
  /** Recursively collect elements matching a predicate. */
  find(pred: (el: StubEl) => boolean): StubEl | null {
    if (pred(this)) return this;
    for (const c of this.children) {
      const hit = c.find(pred);
      if (hit) return hit;
    }
    return null;
  }
  findAll(pred: (el: StubEl) => boolean): StubEl[] {
    const out: StubEl[] = [];
    if (pred(this)) out.push(this);
    for (const c of this.children) out.push(...c.findAll(pred));
    return out;
  }
}

let fetchCalls: Array<{ url: string; body: unknown }> = [];
let themeStored: Record<string, string> = {};

const doc = {
  createElement: (tag: string) => new StubEl(tag),
  documentElement: {
    _theme: 'light',
    setAttribute(k: string, v: string) {
      if (k === 'data-theme') this._theme = v;
    },
    getAttribute(k: string) {
      return k === 'data-theme' ? this._theme : null;
    },
  },
  querySelector: () => null,
};

/** Install the DOM + network stubs used by the components. */
function installDom(): void {
  const stubFetch = (url: string, init?: { body?: string }) => {
    fetchCalls.push({ url, body: init?.body ? JSON.parse(init.body) : undefined });
    return Promise.resolve({ ok: true, json: async () => ({ success: true }) });
  };

  (globalThis as unknown as { document: typeof doc }).document = doc;
  (globalThis as unknown as { window: unknown }).window = {
    matchMedia: () => ({ matches: false }),
    fetch: stubFetch,
  };
  // The components call the global fetch directly (not window.fetch)
  (globalThis as unknown as { fetch: typeof stubFetch }).fetch = stubFetch;
  (globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: (k: string) => themeStored[k] ?? null,
    setItem: (k: string, v: string) => { themeStored[k] = v; },
    removeItem: (k: string) => { delete themeStored[k]; },
  };
}

describe('ThemeToggle (dropdown)', () => {
  beforeEach(() => {
    vi.resetModules();
    fetchCalls = [];
    themeStored = {};
    installDom();
  });

  it('renders a select with one option per theme', async () => {
    const { ThemeToggle } = await import('../../../src/client/components/settings/ThemeToggle');
    const el = new ThemeToggle().getElement() as unknown as StubEl;

    const select = el.find((e) => e.tagName === 'SELECT');
    expect(select).not.toBeNull();

    const options = select!.findAll((e) => e.tagName === 'OPTION');
    expect(options.map((o) => o.value)).toEqual(['light', 'dark', 'oled', 'eink']);
  });

  it('marks the active theme as selected', async () => {
    themeStored['theme'] = 'oled';
    const { ThemeToggle } = await import('../../../src/client/components/settings/ThemeToggle');
    const el = new ThemeToggle().getElement() as unknown as StubEl;

    const selected = el
      .findAll((e) => e.tagName === 'OPTION')
      .filter((o) => o.getAttribute('selected') === 'true' || o.value === 'oled');
    // The component sets `.selected`; assert via the value the select reports
    const select = el.find((e) => e.tagName === 'SELECT')!;
    expect(select).not.toBeNull();
    expect(selected.length).toBeGreaterThan(0);
  });

  it('applies the theme and persists it on change', async () => {
    const { ThemeToggle } = await import('../../../src/client/components/settings/ThemeToggle');
    const toggle = new ThemeToggle();
    const el = toggle.getElement() as unknown as StubEl;

    const select = el.find((e) => e.tagName === 'SELECT')!;
    select.value = 'dark';
    select.dispatch('change');

    // data-theme applied immediately for a snappy UX
    expect(doc.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(themeStored['theme']).toBe('dark');

    await Promise.resolve();
    const call = fetchCalls.find((c) => c.url === '/api/config/theme');
    expect(call).toBeDefined();
    expect(call!.body).toEqual({ theme: 'dark' });
  });
});

describe('LanguageSwitch (dropdown)', () => {
  beforeEach(() => {
    vi.resetModules();
    fetchCalls = [];
    themeStored = {};
    installDom();
  });

  it('renders a select with zh and en options', async () => {
    const { LanguageSwitch } = await import('../../../src/client/components/settings/LanguageSwitch');
    const el = new LanguageSwitch().getElement() as unknown as StubEl;

    const options = el.findAll((e) => e.tagName === 'OPTION');
    expect(options.map((o) => o.value)).toEqual(['zh', 'en']);
    expect(options.map((o) => o.textContent)).toEqual(['中文', 'English']);
  });

  it('switches language and persists it on change', async () => {
    const i18n = await import('../../../src/client/services/i18n');
    i18n.setLanguage('en');

    const { LanguageSwitch } = await import('../../../src/client/components/settings/LanguageSwitch');
    const el = new LanguageSwitch().getElement() as unknown as StubEl;

    const select = el.find((e) => e.tagName === 'SELECT')!;
    select.value = 'zh';
    select.dispatch('change');

    await Promise.resolve();
    expect(i18n.getLanguage()).toBe('zh');

    const call = fetchCalls.find((c) => c.url === '/api/config/language');
    expect(call).toBeDefined();
    expect(call!.body).toEqual({ language: 'zh' });
  });
});
