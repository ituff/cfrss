/**
 * MobileArticleList — unit tests.
 *
 * The Workers test pool has no DOM, so a minimal stub is installed before the
 * component is imported. We assert the Folo-style structure (title bar, pill tab,
 * circular action group, cards with source meta + thumbnail) and the article
 * interaction behaviour.
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
  alt = '';
  src = '';
  href = '';
  loading = '';
  tabIndex = 0;
  dateTime = '';
  children: StubEl[] = [];
  attrs: Record<string, string> = {};
  listeners: Record<string, ((e: unknown) => void)[]> = {};
  parent: StubEl | null = null;
  onerror: (() => void) | null = null;

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
  setAttribute(k: string, v: string): void {
    this.attrs[k] = v;
  }
  getAttribute(k: string): string | null {
    return this.attrs[k] ?? null;
  }
  addEventListener(type: string, fn: (e: unknown) => void): void {
    (this.listeners[type] ??= []).push(fn);
  }
  removeEventListener(type: string, fn: (e: unknown) => void): void {
    this.listeners[type] = (this.listeners[type] ?? []).filter((f) => f !== fn);
  }
  dispatch(type: string, event: unknown = {}): void {
    for (const fn of this.listeners[type] ?? []) fn(event);
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

const ARTICLES = [
  {
    id: 'a1',
    subscriptionId: 's1',
    title: 'Unread article one',
    author: '',
    publishedAt: new Date().toISOString(),
    summary: '<p>Excerpt text here</p><img src="https://cdn.example.com/t.jpg">',
    contentUrl: 'p',
    sourceUrl: 'u',
    isRead: false,
    fetchedAt: new Date().toISOString(),
  },
  {
    id: 'a2',
    subscriptionId: 's1',
    title: 'Read article two',
    author: '',
    publishedAt: new Date(Date.now() - 3 * 3600_000).toISOString(),
    summary: '<p>Another excerpt</p>',
    contentUrl: 'p',
    sourceUrl: 'u',
    isRead: true,
    fetchedAt: new Date().toISOString(),
  },
];

let fetchCalls: Array<{ url: string; method?: string }> = [];
let markReadBodies: unknown[] = [];
/** Flip to make the stub return an empty article list (for empty-state tests). */
let emptyArticles = false;

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

  const stubFetch = (input: RequestInfo | URL, init?: { method?: string; body?: string }) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    fetchCalls.push({ url, method: init?.method });
    if (url.includes('/read')) markReadBodies.push(init?.body ? JSON.parse(init.body) : undefined);

    let payload: unknown = {};
    if (url.startsWith('/api/articles?')) {
      payload = { articles: emptyArticles ? [] : ARTICLES, truncated: true, limit: 20, offset: 0 };
    } else if (url.startsWith('/api/subscriptions')) {
      payload = { subscriptions: [{ id: 's1', url: 'https://example.com/feed.xml', title: 'Example Feed' }] };
    } else if (url.startsWith('/api/categories')) {
      payload = { categories: [] };
    }

    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    });
  };

  (globalThis as unknown as { document: typeof doc }).document = doc;
  (globalThis as unknown as { window: unknown }).window = {
    matchMedia: () => ({ matches: false }),
    fetch: stubFetch,
  };
  // The API client calls the global fetch directly (not window.fetch)
  (globalThis as unknown as { fetch: typeof stubFetch }).fetch = stubFetch;
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

/** Let an async reload (fetch → transform → render) actually finish. */
async function settle(): Promise<void> {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

describe('MobileArticleList', () => {
  beforeEach(() => {
    vi.resetModules();
    fetchCalls = [];
    markReadBodies = [];
    emptyArticles = false;
    installDom();
  });

  it('renders the title bar, pill tab and circular action group', async () => {
    const { MobileArticleList } = await import('../../../src/client/components/mobile/MobileArticleList');
    const host = new StubEl('div');
    const list = new MobileArticleList({ container: host as unknown as HTMLElement });
    await list.init();

    const el = list.getElement() as unknown as StubEl;

    expect(el.find((e) => e.className.includes('mobile-articles__titlebar'))).not.toBeNull();
    expect(el.find((e) => e.className.includes('mobile-articles__tab'))).not.toBeNull();
    // Circular icon buttons: 2 in the title bar (theme / mark-all-read)
    // plus 3 in the action group (refresh / unread-only / all)
    const iconBtns = el.findAll((e) => e.className.includes('mobile-articles__icon-btn'));
    expect(iconBtns.length).toBe(5);
    const group = el.find((e) => e.className.includes('mobile-articles__btn-group'))!;
    expect(group.findAll((e) => e.className.includes('mobile-articles__icon-btn')).length).toBe(3);

    // Every control is a real inline SVG with an explicit size and an
    // accessible name — no bare text glyphs.
    for (const btn of iconBtns) {
      expect(btn.innerHTML).toContain('<svg');
      expect(btn.innerHTML).toContain('width="18"');
      expect(btn.innerHTML).toContain('stroke="currentColor"');
      expect(btn.getAttribute('aria-label')).toBeTruthy();
    }

    list.destroy();
  });

  it('labels each control with the action it actually performs', async () => {
    const { MobileArticleList } = await import('../../../src/client/components/mobile/MobileArticleList');
    const host = new StubEl('div');
    const list = new MobileArticleList({ container: host as unknown as HTMLElement });
    await list.init();

    const el = list.getElement() as unknown as StubEl;
    const group = el.find((e) => e.className.includes('mobile-articles__btn-group'))!;
    const labels = group
      .findAll((e) => e.className.includes('mobile-articles__icon-btn'))
      .map((b) => b.getAttribute('aria-label'));

    // The two filter buttons used to both be wired to one toggle while
    // carrying "favorites" / "all" labels that matched neither.
    expect(labels).toEqual(['Refresh', 'Unread only', 'All']);

    list.destroy();
  });

  it('defaults to unread-only and can be switched back to all', async () => {
    const { MobileArticleList } = await import('../../../src/client/components/mobile/MobileArticleList');
    const host = new StubEl('div');
    const list = new MobileArticleList({ container: host as unknown as HTMLElement });
    await list.init();

    const el = list.getElement() as unknown as StubEl;
    const [unreadBtn, allBtn] = el
      .find((e) => e.className.includes('mobile-articles__btn-group'))!
      .findAll((e) => e.className.includes('mobile-articles__icon-btn'))
      .slice(1);

    // Unread-only is the default — an RSS reader is a queue of unread items.
    expect(unreadBtn!.getAttribute('aria-pressed')).toBe('true');
    expect(allBtn!.getAttribute('aria-pressed')).toBe('false');
    // The very first request already carries the filter, not just later ones.
    expect(fetchCalls.some((c) => c.url === '/api/articles?unread=true&limit=20&offset=0')).toBe(true);

    allBtn!.dispatch('click');
    await Promise.resolve();

    expect(unreadBtn!.getAttribute('aria-pressed')).toBe('false');
    expect(allBtn!.getAttribute('aria-pressed')).toBe('true');
    expect(fetchCalls.some((c) => c.url === '/api/articles?limit=20&offset=0')).toBe(true);

    unreadBtn!.dispatch('click');
    await Promise.resolve();

    expect(unreadBtn!.getAttribute('aria-pressed')).toBe('true');
    expect(allBtn!.getAttribute('aria-pressed')).toBe('false');

    list.destroy();
  });

  it('explains an empty unread list differently from an empty feed', async () => {
    emptyArticles = true;
    const { MobileArticleList } = await import('../../../src/client/components/mobile/MobileArticleList');
    const host = new StubEl('div');
    const list = new MobileArticleList({ container: host as unknown as HTMLElement });
    await list.init();

    const el = list.getElement() as unknown as StubEl;

    // Read-up list: "no unread articles", not the generic "no articles yet".
    expect(el.find((e) => e.className.includes('mobile-articles__empty'))?.textContent)
      .toBe('No unread articles');

    const [, allBtn] = el
      .find((e) => e.className.includes('mobile-articles__btn-group'))!
      .findAll((e) => e.className.includes('mobile-articles__icon-btn'))
      .slice(1);
    allBtn!.dispatch('click');
    await settle();

    // Genuinely empty feed: the generic message.
    expect(el.find((e) => e.className.includes('mobile-articles__empty'))?.textContent)
      .toBe('No articles yet');

    list.destroy();
  });

  it('swaps the theme icon to preview the next theme', async () => {
    const { MobileArticleList } = await import('../../../src/client/components/mobile/MobileArticleList');
    const host = new StubEl('div');
    const list = new MobileArticleList({ container: host as unknown as HTMLElement });
    await list.init();

    const el = list.getElement() as unknown as StubEl;
    const themeBtn = el.find((e) => e.getAttribute('aria-label') === 'Theme')!;

    // Stub document starts on `light`, so the button offers the moon.
    expect(themeBtn.innerHTML).toContain('<path d="M12 3a6 6');
    themeBtn.dispatch('click');
    await Promise.resolve();

    // ...and after switching to `dark` it offers the sun.
    expect(themeBtn.innerHTML).toContain('<circle cx="12" cy="12" r="4"/>');
    expect(fetchCalls.some((c) => c.url === '/api/config/theme' && c.method === 'PUT')).toBe(true);

    list.destroy();
  });

  it('renders one card per article with source meta, title and excerpt', async () => {
    const { MobileArticleList } = await import('../../../src/client/components/mobile/MobileArticleList');
    const host = new StubEl('div');
    const list = new MobileArticleList({ container: host as unknown as HTMLElement });
    await list.init();

    const el = list.getElement() as unknown as StubEl;
    const cards = el.findAll((e) => e.className.split(' ').includes('mobile-article-card'));
    expect(cards.length).toBe(2);

    const titles = cards.map((c) => c.find((e) => e.className.includes('mobile-article-card__title'))?.textContent);
    expect(titles).toEqual(['Unread article one', 'Read article two']);

    // Read article is de-emphasized via a `read` class
    expect(cards[0]!.className).not.toContain('read');
    expect(cards[1]!.className).toContain('read');

    list.destroy();
  });

  it('shows an unread dot only on unread cards', async () => {
    const { MobileArticleList } = await import('../../../src/client/components/mobile/MobileArticleList');
    const host = new StubEl('div');
    const list = new MobileArticleList({ container: host as unknown as HTMLElement });
    await list.init();

    const el = list.getElement() as unknown as StubEl;
    const cards = el.findAll((e) => e.className.split(' ').includes('mobile-article-card'));

    expect(cards[0]!.find((e) => e.className.includes('mobile-article-card__dot'))).not.toBeNull();
    expect(cards[1]!.find((e) => e.className.includes('mobile-article-card__dot'))).toBeNull();

    list.destroy();
  });

  it('renders a thumbnail only when the summary contains an image', async () => {
    const { MobileArticleList } = await import('../../../src/client/components/mobile/MobileArticleList');
    const host = new StubEl('div');
    const list = new MobileArticleList({ container: host as unknown as HTMLElement });
    await list.init();

    const el = list.getElement() as unknown as StubEl;
    const cards = el.findAll((e) => e.className.split(' ').includes('mobile-article-card'));

    expect(cards[0]!.find((e) => e.className.includes('mobile-article-card__thumb'))).not.toBeNull();
    expect(cards[1]!.find((e) => e.className.includes('mobile-article-card__thumb'))).toBeNull();

    list.destroy();
  });

  it('hands the tap to the reader without marking read itself', async () => {
    const selected: string[] = [];
    const { MobileArticleList } = await import('../../../src/client/components/mobile/MobileArticleList');
    const host = new StubEl('div');
    const list = new MobileArticleList({
      container: host as unknown as HTMLElement,
      onSelect: (id) => selected.push(id),
    });
    await list.init();

    const el = list.getElement() as unknown as StubEl;
    const firstCard = el.findAll((e) => e.className.split(' ').includes('mobile-article-card'))[0]!;
    firstCard.dispatch('click');

    expect(selected).toEqual(['a1']);

    // The list must NOT mark read: selecting navigates away and destroys it, so
    // a local write is discarded — and `ArticleView` already owns marking read
    // once the article has actually loaded. Doing it here too fired the endpoint
    // twice, and consumed the article even when loading then failed.
    expect(fetchCalls.find((c) => c.url === '/api/articles/a1/read')).toBeUndefined();
    expect(markReadBodies).toEqual([]);

    list.destroy();
  });

  it('exposes loaded article ids for reader navigation', async () => {
    const { MobileArticleList } = await import('../../../src/client/components/mobile/MobileArticleList');
    const host = new StubEl('div');
    const list = new MobileArticleList({ container: host as unknown as HTMLElement });
    await list.init();

    expect(fetchCalls.map((c) => c.url)).toContain('/api/articles?unread=true&limit=20&offset=0');
    expect(list.getArticleIds()).toEqual(['a1', 'a2']);

    list.destroy();
  });
});
