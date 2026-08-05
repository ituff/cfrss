/**
 * Simple hash-based client-side router.
 * Routes: #/ (home/digest), #/subscriptions, #/articles, #/articles/:id, #/settings
 */

export interface Route {
  path: string;
  params: Record<string, string>;
}

export type RouteChangeHandler = (route: Route) => void;

const ROUTES = [
  { pattern: /^#\/articles\/(.+)$/, name: 'article-detail', paramNames: ['id'] },
  { pattern: /^#\/articles$/, name: 'articles', paramNames: [] },
  { pattern: /^#\/subscriptions$/, name: 'subscriptions', paramNames: [] },
  { pattern: /^#\/settings$/, name: 'settings', paramNames: [] },
  { pattern: /^#\/?$/, name: 'home', paramNames: [] },
] as const;

let currentRoute: Route = { path: 'home', params: {} };
let listeners: RouteChangeHandler[] = [];

/**
 * Parse the current hash into a Route object.
 */
export function parseHash(hash: string): Route {
  const normalizedHash = hash || '#/';

  for (const route of ROUTES) {
    const match = normalizedHash.match(route.pattern);
    if (match) {
      const params: Record<string, string> = {};
      route.paramNames.forEach((name, index) => {
        params[name] = match[index + 1];
      });
      return { path: route.name, params };
    }
  }

  // Default to home for unmatched routes
  return { path: 'home', params: {} };
}

/**
 * Navigate to a new route by updating the hash.
 */
export function navigate(path: string): void {
  window.location.hash = path.startsWith('#') ? path : `#${path}`;
}

/**
 * Get the current route.
 */
export function getCurrentRoute(): Route {
  return currentRoute;
}

/**
 * Subscribe to route changes.
 */
export function onRouteChange(handler: RouteChangeHandler): () => void {
  listeners.push(handler);
  return () => {
    listeners = listeners.filter((l) => l !== handler);
  };
}

/**
 * Handle hashchange events and notify listeners.
 */
function handleHashChange(): void {
  const newRoute = parseHash(window.location.hash);
  currentRoute = newRoute;
  listeners.forEach((handler) => handler(newRoute));
}

/**
 * Initialize the router — call once on app startup.
 */
export function initRouter(): Route {
  window.addEventListener('hashchange', handleHashChange);
  currentRoute = parseHash(window.location.hash);
  return currentRoute;
}

/**
 * Destroy the router (cleanup).
 */
export function destroyRouter(): void {
  window.removeEventListener('hashchange', handleHashChange);
  listeners = [];
}
