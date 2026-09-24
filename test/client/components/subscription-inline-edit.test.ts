/**
 * CategoryGroup inline subscription editor — unit tests.
 *
 * Regression: the edit button used to run two chained `window.prompt()` calls.
 * The URL prompt sat behind the title prompt behind an early `return`, so
 * cancelling the title (the natural move when you only want to change the URL)
 * made the URL unreachable — the button looked like a rename-only action.
 *
 * The editor now shows both fields at once. These tests pin that behaviour:
 * the URL input is always present, and it is the value that reaches the API.
 *
 * The Workers test pool has no DOM, so a minimal stub is installed before the
 * component is imported.
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
  placeholder = '';
  maxLength = 0;
  disabled = false;
  title = '';
  style: Record<string, string> = {};
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
  click(): void {
    this.dispatch('click', { stopPropagation: () => undefined, preventDefault: () => undefined });
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

const doc = {
  createElement: (tag: string) => new StubEl(tag),
  documentElement: {
    _theme: 'light',
    setAttribute(k: string, v: string) { if (k === 'data-theme') this._theme = v; },
    getAttribute(k: string) { return k === 'data-theme' ? this._theme : null; },
  },
  querySelector: () => null,
};

function installDom(): void {
  (globalThis as unknown as { document: typeof doc }).document = doc;
  (globalThis as unknown as { window: unknown }).window = {
    matchMedia: () => ({ matches: false }),
    fetch: () => Promise.resolve({ ok: true, json: async () => ({}) }),
  };
  (globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  };
}

/** The feed under edit, mirroring the row that reproduces the bug. */
const FEED = {
  id: 'sub-1',
  url: 'https://blog.google/rss/',
  title: 'The Keyword',
  categoryId: 'cat-1',
  createdAt: '2026-09-05 13:12:34',
  lastFetchedAt: '2026-09-17 03:00:19',
  failCount: 0,
  disabled: false,
  unreadCount: 11,
} as never;

const CATEGORY = { id: 'cat-1', name: 'Tech', order: 1 } as never;
const CATEGORIES = [CATEGORY] as never;

async function buildGroup(onEdit: (id: string, updates: unknown) => unknown) {
  const { CategoryGroup } = await import(
    '../../../src/client/components/subscription/CategoryGroup'
  );
  const group = new CategoryGroup(CATEGORY, [FEED], CATEGORIES, {
    onDelete: () => undefined,
    onEdit: onEdit as never,
    onRenameCategory: () => undefined,
    onDeleteCategory: () => undefined,
    onMove: () => undefined,
    onEnable: () => undefined,
  });
  return group.getElement() as unknown as StubEl;
}

/**
 * Click the edit action on the feed row.
 *
 * Selected by accessible name rather than by glyph: the button used to be
 * located via `textContent === '✏️'`, which broke as soon as the emoji was
 * replaced with an inline SVG (the stub stores `innerHTML` as a raw string and
 * creates no children, so `textContent` is empty either way).
 */
function clickEdit(el: StubEl): void {
  const editBtn = el
    .findAll(
      (e) =>
        e.tagName === 'BUTTON' &&
        e.className.split(' ').includes('category-group__action') &&
        (e.getAttribute('aria-label') ?? '').startsWith('Edit subscription')
    )
    .pop();
  expect(editBtn, 'edit button must exist on the feed row').toBeDefined();
  editBtn!.click();
}

describe('CategoryGroup inline editor', () => {
  beforeEach(() => {
    vi.resetModules();
    installDom();
  });

  it('opens an editor exposing BOTH a title and a URL field', async () => {
    const el = await buildGroup(() => undefined);
    clickEdit(el);

    const inputs = el.findAll((e) => e.tagName === 'INPUT');
    expect(inputs).toHaveLength(2);
    expect(inputs.map((i) => i.type)).toEqual(['text', 'url']);
    // The URL field must be present from the start — no prompt chaining.
    expect(inputs[1].value).toBe('https://blog.google/rss/');
    expect(inputs[0].value).toBe('The Keyword');
  });

  it('submits a URL-only change without touching the title', async () => {
    const calls: Array<{ id: string; updates: unknown }> = [];
    const el = await buildGroup((id, updates) => {
      calls.push({ id, updates });
      return Promise.resolve();
    });

    clickEdit(el);

    const form = el.find((e) => e.className.includes('category-group__editor'))!;
    const urlInput = el.findAll((e) => e.tagName === 'INPUT' && e.type === 'url')[0];
    urlInput.value = 'https://blog.google/rss/feed.xml';
    urlInput.dispatch('input');

    form.dispatch('submit', { preventDefault: () => undefined });
    await Promise.resolve();
    await Promise.resolve();

    expect(calls).toHaveLength(1);
    expect(calls[0].id).toBe('sub-1');
    expect(calls[0].updates).toEqual({ url: 'https://blog.google/rss/feed.xml' });
  });

  it('submits a title-only change without touching the URL', async () => {
    const calls: Array<{ id: string; updates: unknown }> = [];
    const el = await buildGroup((id, updates) => {
      calls.push({ id, updates });
      return Promise.resolve();
    });

    clickEdit(el);

    const form = el.find((e) => e.className.includes('category-group__editor'))!;
    const titleInput = el.findAll((e) => e.tagName === 'INPUT' && e.type === 'text')[0];
    titleInput.value = 'Google Blog';
    titleInput.dispatch('input');

    form.dispatch('submit', { preventDefault: () => undefined });
    await Promise.resolve();
    await Promise.resolve();

    expect(calls[0].updates).toEqual({ title: 'Google Blog' });
  });

  it('submits both fields when both change', async () => {
    const calls: Array<{ id: string; updates: unknown }> = [];
    const el = await buildGroup((id, updates) => {
      calls.push({ id, updates });
      return Promise.resolve();
    });

    clickEdit(el);

    const form = el.find((e) => e.className.includes('category-group__editor'))!;
    const [titleInput, urlInput] = el.findAll((e) => e.tagName === 'INPUT');
    titleInput.value = 'Google Blog';
    titleInput.dispatch('input');
    urlInput.value = 'https://blog.google/feed.xml';
    urlInput.dispatch('input');

    form.dispatch('submit', { preventDefault: () => undefined });
    await Promise.resolve();
    await Promise.resolve();

    expect(calls[0].updates).toEqual({
      title: 'Google Blog',
      url: 'https://blog.google/feed.xml',
    });
  });

  it('rejects a blank title before calling the API', async () => {
    const calls: unknown[] = [];
    const el = await buildGroup((id, updates) => {
      calls.push({ id, updates });
      return Promise.resolve();
    });

    clickEdit(el);

    const form = el.find((e) => e.className.includes('category-group__editor'))!;
    const titleInput = el.findAll((e) => e.tagName === 'INPUT' && e.type === 'text')[0];
    titleInput.value = '   ';
    titleInput.dispatch('input');

    form.dispatch('submit', { preventDefault: () => undefined });
    await Promise.resolve();

    expect(calls).toHaveLength(0);
    const err = el.find((e) => e.className.includes('category-group__editor-error'));
    expect(err).not.toBeNull();
  });

  it('rejects a URL without an http(s) scheme', async () => {
    const calls: unknown[] = [];
    const el = await buildGroup((id, updates) => {
      calls.push({ id, updates });
      return Promise.resolve();
    });

    clickEdit(el);

    const form = el.find((e) => e.className.includes('category-group__editor'))!;
    const urlInput = el.findAll((e) => e.tagName === 'INPUT' && e.type === 'url')[0];
    urlInput.value = 'blog.google/rss';
    urlInput.dispatch('input');

    form.dispatch('submit', { preventDefault: () => undefined });
    await Promise.resolve();

    expect(calls).toHaveLength(0);
    expect(el.find((e) => e.className.includes('category-group__editor-error'))).not.toBeNull();
  });

  it('surfaces a server error inside the editor instead of silently closing', async () => {
    const el = await buildGroup(() => Promise.reject(new Error('URL is already used by another subscription')));

    clickEdit(el);

    const form = el.find((e) => e.className.includes('category-group__editor'))!;
    const urlInput = el.findAll((e) => e.tagName === 'INPUT' && e.type === 'url')[0];
    urlInput.value = 'https://taken.example.com/feed.xml';
    urlInput.dispatch('input');

    form.dispatch('submit', { preventDefault: () => undefined });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const err = el.find((e) => e.className.includes('category-group__editor-error'));
    expect(err).not.toBeNull();
    expect(err!.textContent).toContain('already used');
  });

  it('cancel closes the editor without calling the API', async () => {
    const calls: unknown[] = [];
    const el = await buildGroup((id, updates) => {
      calls.push({ id, updates });
      return Promise.resolve();
    });

    clickEdit(el);
    expect(el.find((e) => e.className.includes('category-group__editor'))).not.toBeNull();

    const cancelBtn = el
      .findAll((e) => e.tagName === 'BUTTON')
      .find((b) => b.className.includes('category-group__editor-cancel'))!;
    cancelBtn.click();

    expect(el.find((e) => e.className.includes('category-group__editor'))).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('shows the feed row again after a successful save', async () => {
    const el = await buildGroup(() => Promise.resolve());

    clickEdit(el);

    const form = el.find((e) => e.className.includes('category-group__editor'))!;
    const urlInput = el.findAll((e) => e.tagName === 'INPUT' && e.type === 'url')[0];
    urlInput.value = 'https://blog.google/feed.xml';
    urlInput.dispatch('input');

    form.dispatch('submit', { preventDefault: () => undefined });
    await Promise.resolve();
    await Promise.resolve();

    expect(el.find((e) => e.className.includes('category-group__editor'))).toBeNull();
    expect(el.find((e) => e.className.includes('category-group__link'))).not.toBeNull();
  });
});

/**
 * The row actions were emoji / text glyphs (`▸ ▾ ✏️ 🗑 🔄 ×`). These tests pin
 * the replacements: inline SVG, a fold arrow that rotates instead of swapping
 * glyphs, and an accessible name on every icon-only control.
 */
describe('CategoryGroup row action icons', () => {
  beforeEach(() => {
    vi.resetModules();
    installDom();
  });

  it('rotates one fixed chevron instead of swapping ▸/▾ glyphs', async () => {
    const el = await buildGroup(() => undefined);
    const toggle = el.find((e) => e.className.includes('category-group__toggle'))!;

    // Expanded by default: `--open` rotates the arrow, the markup stays put.
    expect(toggle.className).toContain('category-group__toggle--open');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.getAttribute('aria-label')).toBe('Collapse');
    expect(toggle.innerHTML).toContain('<svg');
    expect(toggle.innerHTML).toContain('M9 6l6 6-6 6');
    const expandedMarkup = toggle.innerHTML;

    toggle.click();

    // `toggle()` re-renders the whole group, so re-query rather than reuse the
    // detached node.
    const collapsedToggle = el.find((e) => e.className.includes('category-group__toggle'))!;
    expect(collapsedToggle.className).not.toContain('category-group__toggle--open');
    expect(collapsedToggle.getAttribute('aria-expanded')).toBe('false');
    expect(collapsedToggle.getAttribute('aria-label')).toBe('Expand');
    // Identical path in both states — proof that nothing is glyph-swapped.
    expect(collapsedToggle.innerHTML).toBe(expandedMarkup);
  });

  it('marks each action with an SVG and an accessible name', async () => {
    const el = await buildGroup(() => undefined);

    const actions = el.findAll((e) => e.className.split(' ').includes('category-group__action'));
    // rename category + delete category + edit subscription
    expect(actions.length).toBe(3);

    for (const btn of actions) {
      expect(btn.innerHTML, 'action must render an SVG icon').toContain('<svg');
      expect(btn.getAttribute('aria-label'), 'icon-only control needs a name').toBeTruthy();
    }

    // Distinct glyphs per action: rename and delete-category must not collide.
    const [rename, removeCategory, edit] = actions.map((b) => b.innerHTML);
    expect(rename).not.toBe(removeCategory);
    expect(removeCategory).not.toBe(edit);
  });

  it('leaves no emoji or glyph characters in any button label', async () => {
    const el = await buildGroup(() => undefined);

    const isGlyph = (s: string): boolean =>
      [...s].some((ch) => {
        const o = ch.codePointAt(0) ?? 0;
        return (
          (o >= 0x1f000 && o <= 0x1faff) ||
          (o >= 0x2600 && o <= 0x27bf) ||
          (o >= 0x2b00 && o <= 0x2bff) ||
          (o >= 0x25a0 && o <= 0x25ff) ||
          o === 0xfe0f
        );
      });

    for (const btn of el.findAll((e) => e.tagName === 'BUTTON')) {
      expect(isGlyph(btn.textContent), `button still uses a glyph: "${btn.textContent}"`).toBe(false);
    }
  });
});
