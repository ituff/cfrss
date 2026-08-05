/**
 * DesktopLayout — dual-pane layout for viewports >= 1024px.
 * Left sidebar: subscription categories and navigation.
 * Right pane: article content view.
 * Both panes are independently scrollable.
 */

import { Route } from '../router.js';
import { getCurrentArticleId } from '../state.js';

export class DesktopLayout {
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
   * Update the content pane when route changes (without full re-render).
   */
  updateRoute(route: Route): void {
    this.currentRoute = route;
    const contentEl = this.element.querySelector('#content');
    if (contentEl) {
      contentEl.innerHTML = this.renderRouteContent();
    }
    this.updateSidebarActiveState();
  }

  /**
   * Create the desktop layout DOM structure.
   */
  private create(): HTMLElement {
    const layout = document.createElement('div');
    layout.className = 'layout-desktop';

    // Sidebar pane (independently scrollable)
    const sidebar = document.createElement('aside');
    sidebar.className = 'pane-sidebar';
    sidebar.id = 'sidebar';
    sidebar.setAttribute('aria-label', 'Subscription sidebar');
    sidebar.innerHTML = this.renderSidebarContent();

    // Content pane (independently scrollable)
    const content = document.createElement('main');
    content.className = 'pane-content';
    content.id = 'content';
    content.setAttribute('role', 'main');
    content.innerHTML = this.renderRouteContent();

    layout.appendChild(sidebar);
    layout.appendChild(content);
    return layout;
  }

  /**
   * Render sidebar content with navigation and subscription categories.
   */
  private renderSidebarContent(): string {
    return `
      <nav class="sidebar-nav" aria-label="Sidebar navigation">
        <a href="#/" class="nav-item ${this.currentRoute.path === 'home' ? 'active' : ''}">Home</a>
        <a href="#/subscriptions" class="nav-item ${this.currentRoute.path === 'subscriptions' ? 'active' : ''}">Subscriptions</a>
        <a href="#/articles" class="nav-item ${this.isArticleRouteActive() ? 'active' : ''}">Articles</a>
        <a href="#/settings" class="nav-item ${this.currentRoute.path === 'settings' ? 'active' : ''}">Settings</a>
      </nav>
    `;
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
   * Check if an article-related route is active.
   */
  private isArticleRouteActive(): boolean {
    return this.currentRoute.path === 'articles' || this.currentRoute.path === 'article-detail';
  }

  /**
   * Update sidebar navigation active state.
   */
  private updateSidebarActiveState(): void {
    const sidebar = this.element.querySelector('#sidebar');
    if (sidebar) {
      sidebar.innerHTML = this.renderSidebarContent();
    }
  }
}
