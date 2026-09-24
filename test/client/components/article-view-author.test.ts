/**
 * ArticleView — author rendering regression tests.
 *
 * Bug: feeds that expose a structured Atom <author> block were stored verbatim,
 * so the reader header rendered raw markup such as
 * `<name>Ibrahim Badr</name><title>Product Manager</title>`.
 *
 * Two layers must hold:
 *   1. the parser normalizes new rows (covered in content-fetcher.test.ts)
 *   2. the view normalizes the value it receives, so rows already persisted
 *      before the fix stop leaking markup without a data migration.
 *
 * The Workers pool has no DOM, so a minimal stub is installed before import.
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
  title = '';
  hidden = false;
  children: StubEl[] = [];
  attrs: Record<string, string> = {};
  listeners: Record<string, ((e: unknown) => void)[]> = {};
  parent: StubEl | null = null;

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
  }

  private _innerHTML = '';
  set innerHTML(v: string) {
    this._innerHTML = v;
    if (v === '') this.children = [];
  }
  get innerHTML(): string {
    return this._innerHTML;
  }

  get classList() {
    const self = this;
    return {
      add: (c: string) => { if (!self.className.split(' ').includes(c)) self.className = `${self.className} ${c}`.trim(); },
      remove: (c: string) => { self.className = self.className.split(' ').filter((x) => x !== c).join(' '); },
      toggle: (c: string, on?: boolean) => {
        const has = self.className.split(' ').includes(c);
        const want = on ?? !has;
        if (want && !has) self.className = `${self.className} ${c}`.trim();
        if (!want && has) self.className = self.className.split(' ').filter((x) => x !== c).join(' ');
      },
      contains: (c: string) => self.className.split(' ').includes(c),
    };
  }

  appendChild(child: StubEl): StubEl {
    this.children.push(child);
    child.parent = this;
    return child;
  }
  remove(): void {
    this.parent?.children.splice(this.parent.children.indexOf(this), 1);
  }
  setAttribute(k: string, v: string): void { this.attrs[k] = v; }
  getAttribute(k: string): string | null { return this.attrs[k] ?? null; }
  removeAttribute(k: string): void { delete this.attrs[k]; }
  addEventListener(type: string, fn: (e: unknown) => void): void {
    (this.listeners[type] ??= []).push(fn);
  }
  removeEventListener(type: string, fn: (e: unknown) => void): void {
    this.listeners[type] = (this.listeners[type] ?? []).filter((f) => f !== fn);
  }
  querySelector(pred: string): StubEl | null {
    return this.findAll((e) => e.className.split(' ').includes(pred))[0] ?? null;
  }
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

function installDom(): void {
  const doc = {
    createElement: (tag: string) => new StubEl(tag),
    documentElement: {
      _theme: 'light',
      setAttribute(this: { _theme: string }, k: string, v: string) { if (k === 'data-theme') this._theme = v; },
      getAttribute(this: { _theme: string }, k: string) { return k === 'data-theme' ? this._theme : null; },
    },
    querySelector: () => null,
  };

  const stubFetch = () => Promise.resolve({
    ok: true,
    status: 200,
    json: async () => ({}),
    text: async () => '{}',
  });

  (globalThis as unknown as { document: typeof doc }).document = doc;
  (globalThis as unknown as { window: unknown }).window = {
    matchMedia: () => ({ matches: false }),
    fetch: stubFetch,
  };
  (globalThis as unknown as { fetch: unknown }).fetch = stubFetch;
  (globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  };
  (globalThis as unknown as { Request: unknown }).Request = class {
    url: string;
    constructor(url: string) { this.url = url; }
  };
}

/**
 * Render an article and return the header markup plus whether an author
 * element was emitted at all. The DOM stub does not parse template strings,
 * so assertions run against the header's innerHTML.
 */
async function renderHeader(author: string): Promise<{ html: string; hasAuthor: boolean }> {
  const { ArticleView } = await import('../../../src/client/components/article/ArticleView');
  const host = new StubEl('div');
  const view = new ArticleView({
    container: host as unknown as HTMLElement,
    articleId: 'a1',
  });
  (view as unknown as { article: unknown }).article = {
    id: 'a1',
    title: 'A title',
    author,
    publishedAt: '2026-09-17T00:00:00Z',
    htmlContent: '<p>body</p>',
    sourceUrl: 'https://example.com/a',
  };
  (view as unknown as { renderArticle: () => void }).renderArticle();
  const header = host.find((e) => e.className.split(' ').includes('article-view-header'));
  const html = header?.innerHTML ?? '';
  return { html, hasAuthor: html.includes('article-view-author') };
}

describe('ArticleView author rendering', () => {
  beforeEach(() => {
    vi.resetModules();
    installDom();
  });

  it('shows a plain author name unchanged', async () => {
    const { html } = await renderHeader('Jane Doe');
    expect(html).toContain('Jane Doe');
  });

  it('strips a legacy Atom person construct down to the name', async () => {
    // Shape observed in production before the parser fix
    const raw = '<name>Ibrahim Badr</name><title>Product Manager</title><department>Search</department><company/>';
    const { html } = await renderHeader(raw);
    expect(html).toContain('Ibrahim Badr');
    expect(html).not.toContain('&lt;name&gt;');
    expect(html).not.toContain('Product Manager');
    expect(html).not.toContain('Search');
  });

  it('unwraps an RSS-style "email (Name)" author', async () => {
    const { html } = await renderHeader('jane@example.com (Jane Doe)');
    expect(html).toContain('Jane Doe');
    expect(html).not.toContain('@');
  });

  it('escapes angle brackets so no author markup can inject HTML', async () => {
    const { html } = await renderHeader('Bobby <script>alert(1)</script>');
    expect(html).not.toContain('<script>');
  });

  it('omits the author element entirely when there is no author', async () => {
    const { hasAuthor } = await renderHeader('');
    expect(hasAuthor).toBe(false);
  });
});
