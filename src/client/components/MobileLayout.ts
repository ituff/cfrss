/**
 * MobileLayout — single-pane layout for viewports < 1024px.
 * Displays one active view at a time with a fixed bottom navigation bar.
 * Navigation items have minimum 44×44px touch targets.
 *
 * Route content is rendered by the shared RouteView (real feature components),
 * with the compact Folo-style article list used for the articles route.
 */

import { Route } from '../router.js';
import { RouteView } from './route-view.js';
import { t, onLanguageChange } from '../services/i18n.js';

interface NavItem {
  href: string;
  icon: string;
  labelKey: string;
  route: string;
}

export class MobileLayout {
  private element: HTMLElement;
  private currentRoute: Route;
  private routeView: RouteView | null = null;
  private unsubscribeLang: (() => void) | null = null;

  private static readonly NAV_ITEMS: NavItem[] = [
    { href: '#/', icon: '🏠', labelKey: 'home', route: 'home' },
    { href: '#/articles', icon: '📰', labelKey: 'articles', route: 'articles' },
    { href: '#/bookmarks', icon: '🔖', labelKey: 'bookmarks', route: 'bookmarks' },
    { href: '#/subscriptions', icon: '📡', labelKey: 'subscriptions', route: 'subscriptions' },
    { href: '#/settings', icon: '⚙️', labelKey: 'settings', route: 'settings' },
  ];

  constructor(currentRoute: Route) {
    this.currentRoute = currentRoute;
    this.element = this.create();
    this.unsubscribeLang = onLanguageChange(() => this.renderNavBar());
    this.renderNavBar();
    const content = this.element.querySelector('#content');
    if (content) {
      this.routeView = new RouteView(content as HTMLElement, this.currentRoute);
    }
  }

  /**
   * Get the rendered DOM element.
   */
  getElement(): HTMLElement {
    return this.element;
  }

  /**
   * Update the main content pane when route changes (without full re-render).
   */
  updateRoute(route: Route): void {
    this.currentRoute = route;
    this.routeView?.update(route);
    this.renderNavBar();
  }

  /**
   * Tear down the mounted route view and listeners.
   */
  destroy(): void {
    this.routeView?.destroy();
    this.routeView = null;
    this.unsubscribeLang?.();
    this.unsubscribeLang = null;
  }

  /**
   * Create the mobile layout DOM structure.
   */
  private create(): HTMLElement {
    const layout = document.createElement('div');
    layout.className = 'layout-mobile';

    // Main content area (single pane)
    const main = document.createElement('main');
    main.className = 'pane-main';
    main.id = 'content';
    main.setAttribute('role', 'main');

    // Fixed bottom navigation bar
    const navBar = document.createElement('nav');
    navBar.className = 'nav-bar';
    navBar.setAttribute('aria-label', t('main_navigation'));

    layout.appendChild(main);
    layout.appendChild(navBar);
    return layout;
  }

  /**
   * Render the fixed bottom navigation bar with icons + i18n labels.
   * All nav items have min 44×44px touch targets (enforced via CSS).
   */
  private renderNavBar(): void {
    const navBar = this.element?.querySelector('.nav-bar');
    if (!navBar) return;

    navBar.innerHTML = MobileLayout.NAV_ITEMS.map((item) => {
      const active = this.isNavItemActive(item.route) ? ' active' : '';
      const label = t(item.labelKey);
      return `<a href="${item.href}" class="nav-item${active}" aria-label="${label}">
        <span class="nav-item__icon" aria-hidden="true">${item.icon}</span>
        <span class="nav-item__label">${label}</span>
      </a>`;
    }).join('');
  }

  /**
   * Check if a nav item should be marked active based on the current route.
   */
  private isNavItemActive(route: string): boolean {
    if (route === 'articles') {
      return this.currentRoute.path === 'articles' || this.currentRoute.path === 'article-detail';
    }
    return this.currentRoute.path === route;
  }
}
