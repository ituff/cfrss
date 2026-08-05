/**
 * MobileLayout — single-pane layout for viewports < 1024px.
 * Displays one active view at a time with a fixed bottom navigation bar.
 * Navigation items have minimum 44×44px touch targets.
 */

import { Route } from '../router.js';
import { getCurrentArticleId } from '../state.js';

export class MobileLayout {
  private element: HTMLElement;
  private currentRoute: Route;

  constructor(currentRoute: Route) {
    this.currentRoute = currentRoute;
    this.element = this.create();
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
    const mainEl = this.element.querySelector('#content');
    if (mainEl) {
      mainEl.innerHTML = this.renderRouteContent();
    }
    this.updateNavActiveState();
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
    main.innerHTML = this.renderRouteContent();

    // Fixed bottom navigation bar
    const navBar = document.createElement('nav');
    navBar.className = 'nav-bar';
    navBar.setAttribute('aria-label', 'Main navigation');
    navBar.innerHTML = this.renderNavBar();

    layout.appendChild(main);
    layout.appendChild(navBar);
    return layout;
  }

  /**
   * Render the main content area based on the current route.
   * Preserves the current article ID from state across layout switches.
   */
  private renderRouteContent(): string {
    const articleId = getCurrentArticleId();

    switch (this.currentRoute.path) {
      case 'home':
        return '<div class="route-view"><div class="view-placeholder">Daily Digest</div></div>';
      case 'subscriptions':
        return '<div class="route-view"><div class="view-placeholder">Subscriptions</div></div>';
      case 'articles':
        return '<div class="route-view"><div class="view-placeholder">Articles</div></div>';
      case 'article-detail':
        return `<div class="route-view"><div class="view-placeholder">Article: ${this.currentRoute.params.id || articleId || ''}</div></div>`;
      case 'settings':
        return '<div class="route-view"><div class="view-placeholder">Settings</div></div>';
      default:
        return '<div class="route-view"><div class="view-placeholder">Not Found</div></div>';
    }
  }

  /**
   * Render the fixed bottom navigation bar.
   * All nav items have min 44×44px touch targets (enforced via CSS).
   */
  private renderNavBar(): string {
    const items = [
      { href: '#/', label: 'Home', route: 'home' },
      { href: '#/subscriptions', label: 'Subs', route: 'subscriptions' },
      { href: '#/articles', label: 'Articles', route: 'articles' },
      { href: '#/settings', label: 'Settings', route: 'settings' },
    ];

    return items
      .map(
        (item) =>
          `<a href="${item.href}" class="nav-item ${this.isNavItemActive(item.route) ? 'active' : ''}" aria-label="${item.label}">${item.label}</a>`
      )
      .join('');
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

  /**
   * Update the nav bar active state without full re-render.
   */
  private updateNavActiveState(): void {
    const navBar = this.element.querySelector('.nav-bar');
    if (navBar) {
      navBar.innerHTML = this.renderNavBar();
    }
  }
}
