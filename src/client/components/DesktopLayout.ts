/**
 * DesktopLayout — Folo-style desktop layout.
 * Far-left icon navigation rail plus the main three-pane view
 * (feed tree / article list / reader). Settings, subscription management
 * and the daily digest render as full-content views over the rail.
 */

import type { Route } from '../router.js';
import { isMainRoute, MainView } from './main-view.js';
import { RouteView } from './route-view.js';
import { t, onLanguageChange } from '../services/i18n.js';

interface RailItem {
  route: string;
  icon: string;
  labelKey: string;
  activeFor: Set<string>;
}

export class DesktopLayout {
  private element: HTMLElement;
  private currentRoute: Route;
  private mainView: MainView | null = null;
  private routeView: RouteView | null = null;
  private contentHost: HTMLElement | null = null;
  private unsubscribeLang: (() => void) | null = null;

  private static readonly RAIL_ITEMS: RailItem[] = [
    { route: '/articles', icon: '📰', labelKey: 'articles', activeFor: new Set(['home', 'articles', 'article-detail']) },
    { route: '/digest', icon: '☀️', labelKey: 'digest', activeFor: new Set(['digest']) },
    { route: '/subscriptions', icon: '📡', labelKey: 'subscriptions', activeFor: new Set(['subscriptions']) },
    { route: '/settings', icon: '⚙️', labelKey: 'settings', activeFor: new Set(['settings']) },
  ];

  constructor(currentRoute: Route) {
    this.currentRoute = currentRoute;
    this.element = this.create();
    this.unsubscribeLang = onLanguageChange(() => this.renderRail());
    this.renderRail();
    this.mountContent();
  }

  getElement(): HTMLElement {
    return this.element;
  }

  updateRoute(route: Route): void {
    const contentChanged = route.path !== this.currentRoute.path;
    this.currentRoute = route;
    this.renderRail();
    if (contentChanged) {
      this.mountContent();
    } else if (this.mainView) {
      this.mainView.update(route);
    }
  }

  destroy(): void {
    this.mainView?.destroy();
    this.mainView = null;
    this.routeView?.destroy();
    this.routeView = null;
    this.unsubscribeLang?.();
    this.unsubscribeLang = null;
  }

  private create(): HTMLElement {
    const layout = document.createElement('div');
    layout.className = 'layout-desktop layout-folo';

    // Icon navigation rail
    const rail = document.createElement('nav');
    rail.className = 'nav-rail';
    rail.setAttribute('aria-label', 'Main navigation');
    rail.id = 'nav-rail';

    // Brand
    const brand = document.createElement('div');
    brand.className = 'nav-rail__brand';
    brand.textContent = 'R';
    brand.title = 'CFRSS';
    rail.appendChild(brand);

    layout.appendChild(rail);

    // Content host (main view or full-content route views)
    const content = document.createElement('main');
    content.className = 'main-content';
    content.id = 'content';
    content.setAttribute('role', 'main');
    layout.appendChild(content);
    this.contentHost = content;

    return layout;
  }

  private renderRail(): void {
    const rail = this.element.querySelector('#nav-rail');
    if (!rail) return;
    rail.querySelectorAll('.nav-rail__item').forEach((el) => el.remove());

    for (const item of DesktopLayout.RAIL_ITEMS) {
      const el = document.createElement('a');
      el.className = `nav-rail__item${item.activeFor.has(this.currentRoute.path) ? ' active' : ''}`;
      el.href = `#${item.route}`;
      el.setAttribute('aria-label', t(item.labelKey));
      el.innerHTML = `
        <span class="nav-rail__icon">${item.icon}</span>
        <span class="nav-rail__label">${t(item.labelKey)}</span>`;
      rail.appendChild(el);
    }
  }

  private mountContent(): void {
    if (!this.contentHost) return;
    this.mainView?.destroy();
    this.mainView = null;
    this.routeView?.destroy();
    this.routeView = null;
    this.contentHost.innerHTML = '';

    if (isMainRoute(this.currentRoute.path)) {
      this.mainView = new MainView(this.contentHost, this.currentRoute);
    } else {
      this.routeView = new RouteView(this.contentHost, this.currentRoute);
    }
  }
}

