/**
 * AppShell — main application shell component.
 * Manages responsive layout detection and renders desktop or mobile layout.
 * Uses vanilla TypeScript + DOM APIs (no framework).
 *
 * Delegates rendering to DesktopLayout and MobileLayout components.
 * Preserves current article state across layout transitions via the state store.
 */

import { Route, getCurrentRoute, onRouteChange } from '../router.js';
import { setCurrentArticleId, getCurrentArticleId } from '../state.js';
import { DesktopLayout } from './DesktopLayout.js';
import { MobileLayout } from './MobileLayout.js';

export type LayoutMode = 'desktop' | 'mobile';

const BREAKPOINT = 1024;
const TRANSITION_MS = 300;

export class AppShell {
  private container: HTMLElement;
  private layoutMode: LayoutMode;
  private mediaQuery: MediaQueryList;
  private unsubscribeRoute: (() => void) | null = null;
  private currentRoute: Route;
  private desktopLayout: DesktopLayout | null = null;
  private mobileLayout: MobileLayout | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    this.mediaQuery = window.matchMedia(`(min-width: ${BREAKPOINT}px)`);
    this.layoutMode = this.mediaQuery.matches ? 'desktop' : 'mobile';
    this.currentRoute = getCurrentRoute();
  }

  /**
   * Initialize the shell — bind events and perform initial render.
   */
  init(): void {
    // Listen for viewport changes
    this.mediaQuery.addEventListener('change', this.handleMediaChange);

    // Listen for route changes
    this.unsubscribeRoute = onRouteChange((route) => {
      this.currentRoute = route;
      // Track the current article ID in state for preservation across layout switches
      if (route.path === 'article-detail' && route.params.id) {
        setCurrentArticleId(route.params.id);
      }
      this.updateRouteView();
    });

    // Sync initial route to state
    if (this.currentRoute.path === 'article-detail' && this.currentRoute.params.id) {
      setCurrentArticleId(this.currentRoute.params.id);
    }

    // Initial render
    this.render();
  }

  /**
   * Destroy the shell — unbind events and clean up.
   */
  destroy(): void {
    this.mediaQuery.removeEventListener('change', this.handleMediaChange);
    if (this.unsubscribeRoute) {
      this.unsubscribeRoute();
      this.unsubscribeRoute = null;
    }
  }

  /**
   * Get the current layout mode.
   */
  getLayoutMode(): LayoutMode {
    return this.layoutMode;
  }

  /**
   * Handle media query change (viewport crosses 1024px breakpoint).
   * Preserves the current article reference via state store during the transition.
   */
  private handleMediaChange = (e: MediaQueryListEvent): void => {
    const newMode: LayoutMode = e.matches ? 'desktop' : 'mobile';
    if (newMode !== this.layoutMode) {
      // Capture current article ID before transition (already in state store)
      const preservedArticleId = getCurrentArticleId();

      this.layoutMode = newMode;

      // Apply 300ms fade transition
      this.container.style.transition = `opacity ${TRANSITION_MS}ms ease`;
      this.container.style.opacity = '0.5';

      setTimeout(() => {
        // Re-render with the new layout — article ID is preserved via state
        this.render();

        // Ensure the preserved article is still referenced after layout switch
        if (preservedArticleId) {
          setCurrentArticleId(preservedArticleId);
        }

        this.container.style.opacity = '1';
        setTimeout(() => {
          this.container.style.transition = '';
        }, TRANSITION_MS);
      }, 50);
    }
  };

  /**
   * Full render of the app shell based on current layout mode.
   */
  private render(): void {
    this.container.innerHTML = '';

    const shell = document.createElement('div');
    shell.className = 'app-shell';

    if (this.layoutMode === 'desktop') {
      this.desktopLayout = new DesktopLayout(this.currentRoute);
      this.mobileLayout = null;
      shell.appendChild(this.desktopLayout.getElement());
    } else {
      this.mobileLayout = new MobileLayout(this.currentRoute);
      this.desktopLayout = null;
      shell.appendChild(this.mobileLayout.getElement());
    }

    this.container.appendChild(shell);
  }

  /**
   * Update only the route-view content without full re-render.
   */
  private updateRouteView(): void {
    if (this.layoutMode === 'desktop' && this.desktopLayout) {
      this.desktopLayout.updateRoute(this.currentRoute);
    } else if (this.layoutMode === 'mobile' && this.mobileLayout) {
      this.mobileLayout.updateRoute(this.currentRoute);
    }
  }
}
