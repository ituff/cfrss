/**
 * FeedTree — keyboard accessibility.
 *
 * Regression: the tree rows carry `role="button"` and `tabIndex = 0`, so they
 * are in the tab order, but they only had `click` listeners. A keyboard user
 * could tab onto "All articles", a category or a feed and press Enter — nothing
 * happened. Focusable-but-inert is worse than not focusable at all, because it
 * silently traps the user.
 *
 * The Workers test pool has no DOM, so a minimal stub is installed before the
 * component is imported. Note the stub stores `innerHTML` as a raw string and
 * creates no children — assertions on markup therefore check the string, while
 * behaviour is asserted on nodes built with `createElement`.
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
  loading = '';
  /** Real divs are not focusable; only what the component opts in should be. */
  tabIndex = -1;
  style: Record<string, string> = {};
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
  click(): void {
    this.dispatch('click', { stopPropagation: () => undefined });
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

/** A keydown event that records whether the component consumed the press. */
function keyEvent(key: string) {
  const calls = { prevented: 0, stopped: 0 };
  return {
    event: {
      key,
      preventDefault: () => { calls.prevented++; },
      stopPropagation: () => { calls.stopped++; },
    },
    calls,
  };
}

const FEEDS = [
  { id: 'feed-1', url: 'https://example.com/feed.xml', title: 'Example Feed', categoryId: 'cat-1', disabled: false, unreadCount: 3 },
];
const CATEGORIES = [{ id: 'cat-1', name: 'Tech', order: 1 }];

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

  const stubFetch = (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    let payload: unknown = {};
    if (url.startsWith('/api/subscriptions')) payload = { subscriptions: FEEDS };
    else if (url.startsWith('/api/categories')) payload = { categories: CATEGORIES };
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

/** Let the constructor's `load()` (two fetches + render) settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

/** Build a tree with data loaded, returning the root stub and captured selections. */
async function buildTree(): Promise<{ root: StubEl; selections: (string | null)[] }> {
  const { FeedTree } = await import('../../../src/client/components/feed-tree');
  const host = new StubEl('div');
  const selections: (string | null)[] = [];
  const tree = new FeedTree(host as unknown as HTMLElement, null, (s) => selections.push(s));
  await settle();
  return { root: tree.getElement() as unknown as StubEl, selections };
}

const rowOf = (root: StubEl, cls: string): StubEl =>
  root.find((e) => e.className.split(' ').includes(cls))!;

describe('FeedTree keyboard access', () => {
  beforeEach(() => {
    vi.resetModules();
    installDom();
  });

  it('activates "All articles" with Enter and Space', async () => {
    const { root, selections } = await buildTree();
    const allItem = rowOf(root, 'feed-tree__all');

    expect(allItem.tabIndex).toBe(0);
    expect(allItem.getAttribute('role')).toBe('button');

    const enter = keyEvent('Enter');
    allItem.dispatch('keydown', enter.event);
    expect(selections).toEqual([null]);
    expect(enter.calls.prevented).toBe(1);

    const space = keyEvent(' ');
    allItem.dispatch('keydown', space.event);
    expect(selections).toEqual([null, null]);
  });

  it('activates a feed row with Enter', async () => {
    const { root, selections } = await buildTree();
    const item = rowOf(root, 'feed-tree__feed');

    expect(item.tabIndex).toBe(0);
    expect(item.getAttribute('role')).toBe('button');

    item.dispatch('keydown', keyEvent('Enter').event);
    expect(selections).toEqual(['feed-1']);
  });

  it('selects a category from its header but collapses it from the chevron', async () => {
    const { root, selections } = await buildTree();
    const header = rowOf(root, 'feed-tree__category');
    const chevron = rowOf(root, 'feed-tree__chevron');

    // Header: selects, and must not be swallowed.
    const headerKey = keyEvent('Enter');
    header.dispatch('keydown', headerKey.event);
    expect(selections).toEqual(['cat:cat-1']);
    expect(headerKey.calls.stopped).toBe(0);

    // Chevron: collapses, and must NOT also select the category.
    const chevronKey = keyEvent('Enter');
    chevron.dispatch('keydown', chevronKey.event);
    expect(chevronKey.calls.stopped).toBe(1);
    expect(selections).toEqual(['cat:cat-1']);

    // Collapsing re-renders, so the feed rows are gone.
    expect(root.find((e) => e.className.split(' ').includes('feed-tree__feed'))).toBeNull();
  });

  it('keeps the chevron label and aria-expanded in sync with the collapsed state', async () => {
    const { root } = await buildTree();

    const expanded = rowOf(root, 'feed-tree__chevron');
    expect(expanded.className).toContain('feed-tree__chevron--open');
    expect(expanded.getAttribute('aria-expanded')).toBe('true');
    expect(expanded.getAttribute('aria-label')).toBe('Collapse');
    expect(expanded.tabIndex).toBe(0);

    expanded.click();

    const collapsed = rowOf(root, 'feed-tree__chevron');
    expect(collapsed.className).not.toContain('feed-tree__chevron--open');
    expect(collapsed.getAttribute('aria-expanded')).toBe('false');
    expect(collapsed.getAttribute('aria-label')).toBe('Expand');
  });

  it('leaves no focusable row without a key handler', async () => {
    const { root } = await buildTree();

    const focusable = root.findAll((e) => e.tabIndex === 0);
    expect(focusable.length).toBeGreaterThan(0);

    for (const el of focusable) {
      expect(
        (el.listeners['keydown'] ?? []).length,
        `focusable row ${el.className} has no keydown handler`
      ).toBeGreaterThan(0);
    }
  });
});
