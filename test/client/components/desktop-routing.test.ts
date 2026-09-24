/**
 * Desktop routing split — which shell owns which route.
 *
 * `DesktopLayout.mountContent()` is a two-way fork:
 *
 *     isMainRoute(path) ? new MainView(...) : new RouteView(...)
 *
 * `MainView` is the three-pane shell (FeedTree + ArticlePane + reader). Every
 * route it owns therefore never reaches `RouteView`, and any code in
 * `RouteView`'s desktop branches for those routes is unreachable.
 *
 * This test pins that invariant. It is the reason the desktop `'articles'`
 * branch of `RouteView` (and the `ArticleList` component it mounted) could be
 * removed: `'articles'` is a main route, so that branch can never run.
 *
 * If someone later removes `'articles'` from MAIN_ROUTES, this test fails —
 * which is the signal to go re-check `RouteView`'s desktop branches.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Minimal stub: importing the module must not need a DOM.
function installDom(): void {
  const doc = {
    createElement: () => ({ className: '', setAttribute: () => undefined, appendChild: () => undefined }),
    documentElement: { setAttribute: () => undefined, getAttribute: () => null },
    querySelector: () => null,
  };
  (globalThis as unknown as { document: typeof doc }).document = doc;
  (globalThis as unknown as { window: unknown }).window = {
    matchMedia: () => ({ matches: false }),
    location: { hash: '' },
    addEventListener: () => undefined,
  };
  (globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  };
}

describe('desktop routing split', () => {
  beforeEach(() => {
    vi.resetModules();
    installDom();
  });

  it('routes home / articles / article-detail to MainView, not RouteView', async () => {
    const { isMainRoute } = await import('../../../src/client/components/main-view');

    for (const path of ['home', 'articles', 'article-detail']) {
      expect(isMainRoute(path), `${path} must be a MainView route`).toBe(true);
    }
  });

  it('leaves the remaining routes to RouteView', async () => {
    const { isMainRoute } = await import('../../../src/client/components/main-view');

    for (const path of ['bookmarks', 'digest', 'subscriptions', 'settings']) {
      expect(isMainRoute(path), `${path} must NOT be a MainView route`).toBe(false);
    }
  });
});
