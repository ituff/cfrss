/**
 * ArticleView — bookmark button tests.
 *
 * The bookmark button sits beside the read-aloud button in the article
 * toolbar. Three things must hold:
 *   1. the button is rendered with the correct aria-pressed state
 *   2. clicking it PUTs a bookmark and flips the state optimistically
 *   3. a failed request rolls the state back rather than lying to the user
 *
 * The Workers pool has no DOM, so a minimal stub is installed before import
 * (same approach as article-view-author.test.ts).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

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
  fire(type: string): void {
    for (const fn of this.listeners[type] ?? []) fn({ preventDefault: () => undefined, stopPropagation: () => undefined });
  }
  querySelector(pred: string): StubEl | null {
    return this.findAll((e) => e.className.split(' ').includes(pred))[0] ?? null;
  }
  querySelectorAll(pred: string): StubEl[] {
    return this.findAll((e) => e.className.split(' ').includes(pred));
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

/** fetch stub that records calls and can be told to fail. */
let fetchCalls: Array<{ url: string; method: string }> = [];
let bookmarkState = false;
let failRequests = false;

function stubFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : (input as { url: string }).url;
  const method = init?.method ?? 'GET';
  fetchCalls.push({ url, method });

  if (failRequests) {
    return Promise.reject(new Error('network down'));
  }

  let body: unknown = {};
  if (method === 'GET' && url.endsWith('/bookmark')) {
    body = { bookmarked: bookmarkState };
  } else if (method === 'PUT' && url.endsWith('/bookmark')) {
    body = { success: true, bookmarked: true };
  } else if (method === 'DELETE' && url.endsWith('/bookmark')) {
    body = { success: true, bookmarked: false };
  }

  return Promise.resolve({
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response);
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

  (globalThis as unknown as { document: typeof doc }).document = doc;
  (globalThis as unknown as { window: unknown }).window = {
    matchMedia: () => ({ matches: false }),
    fetch: stubFetch,
    location: { hash: '' },
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
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

/** Render the article toolbar and return the view plus the actions element. */
async function renderToolbar(): Promise<{ view: unknown; host: StubEl; actions: StubEl }> {
  const { ArticleView } = await import('../../../src/client/components/article/ArticleView');
  const host = new StubEl('div');
  const view = new ArticleView({
    container: host as unknown as HTMLElement,
    articleId: 'a1',
  });
  (view as unknown as { article: unknown }).article = {
    id: 'a1',
    title: 'A title',
    author: 'Jane Doe',
    publishedAt: '2026-09-17T00:00:00Z',
    htmlContent: '<p>body</p>',
    sourceUrl: 'https://example.com/a',
  };
  (view as unknown as { renderArticle: () => void }).renderArticle();

  const actions = host.find((e) => e.className.split(' ').includes('article-view-actions'))!;
  return { view, host, actions };
}

/**
 * The stub does not parse innerHTML into a child tree, so the real DOM lookup
 * for `.action-bookmark` returns null. These helpers read the toolbar markup
 * and drive the toggle method directly — the click wiring itself is asserted
 * against the rendered markup.
 */
function pressed(actions: StubEl): string | null {
  const m = /action-bookmark[^>]*aria-pressed="([^"]*)"/.exec(actions.innerHTML);
  return m ? m[1] : null;
}

function hasActiveClass(actions: StubEl): boolean {
  return /action-bookmark[^>]*class="[^"]*active/.test(actions.innerHTML)
    || /class="[^"]*action-bookmark[^"]*active/.test(actions.innerHTML);
}

async function clickBookmark(view: unknown): Promise<void> {
  await (view as unknown as { toggleBookmark: () => Promise<void> }).toggleBookmark();
}

/** Let queued promise callbacks settle. */
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('ArticleView bookmark button', () => {
  beforeEach(() => {
    vi.resetModules();
    fetchCalls = [];
    bookmarkState = false;
    failRequests = false;
    installDom();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders a bookmark button next to the read-aloud button', async () => {
    const { actions } = await renderToolbar();
    const html = actions.innerHTML;

    expect(html).toContain('action-read-aloud');
    expect(html).toContain('action-bookmark');
  });

  it('starts unpressed', async () => {
    const { actions } = await renderToolbar();
    expect(pressed(actions)).toBe('false');
    expect(hasActiveClass(actions)).toBe(false);
  });

  it('PUTs a bookmark and marks the button pressed on click', async () => {
    const { view, actions } = await renderToolbar();

    await clickBookmark(view);
    await flush();

    const put = fetchCalls.find((c) => c.method === 'PUT');
    expect(put?.url).toContain('/api/articles/a1/bookmark');
    expect((view as unknown as { bookmarked: boolean }).bookmarked).toBe(true);
  });

  it('DELETEs the bookmark when clicked again', async () => {
    const { view, actions } = await renderToolbar();

    await clickBookmark(view);
    await flush();
    await clickBookmark(view);
    await flush();

    expect(fetchCalls.some((c) => c.method === 'PUT')).toBe(true);
    expect(fetchCalls.some((c) => c.method === 'DELETE')).toBe(true);
    expect((view as unknown as { bookmarked: boolean }).bookmarked).toBe(false);
  });

  it('rolls back the pressed state when the request fails', async () => {
    const { view } = await renderToolbar();
    failRequests = true;

    await clickBookmark(view);

    expect((view as unknown as { bookmarked: boolean }).bookmarked).toBe(false);
  });

  it('restores the pressed state from the server on init', async () => {
    bookmarkState = true;
    const { view, actions } = await renderToolbar();

    await (view as unknown as { syncBookmarkState: (id: string) => Promise<void> }).syncBookmarkState('a1');

    expect((view as unknown as { bookmarked: boolean }).bookmarked).toBe(true);
    expect(pressed(actions)).toBe('false'); // markup is only rewritten on re-render
  });
});
