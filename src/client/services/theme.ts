/**
 * Theme Engine — Client-side theme management service.
 *
 * The FOUC-prevention inline script in index.html handles initial theme
 * application before first paint (localStorage → prefers-color-scheme → light).
 *
 * This service handles:
 * - Syncing localStorage theme with server (Config_Store) after page load
 * - Providing programmatic applyTheme / getCurrentTheme helpers
 * - Fallback chain when Config_Store read fails (requirement 2.5):
 *   Config_Store → prefers-color-scheme → light
 *
 * Requirements: 2.3, 2.4, 2.5
 */

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'theme';

/**
 * Detect theme from OS preference via media query.
 * Falls back to 'light' if matchMedia is unavailable.
 */
function getOSPreference(): Theme {
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'light';
}

/**
 * Read theme from localStorage.
 * Returns null if not set or invalid.
 */
function getStoredTheme(): Theme | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') {
      return stored;
    }
  } catch {
    // localStorage may be unavailable (e.g. private browsing in some browsers)
  }
  return null;
}

/**
 * Apply a theme to the document and persist to localStorage.
 */
export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Silently ignore storage failures
  }
}

/**
 * Get the currently active theme from the DOM attribute.
 * Falls back to localStorage → OS preference → light.
 */
export function getCurrentTheme(): Theme {
  const domTheme = document.documentElement.getAttribute('data-theme');
  if (domTheme === 'light' || domTheme === 'dark') {
    return domTheme;
  }

  const stored = getStoredTheme();
  if (stored) {
    return stored;
  }

  return getOSPreference();
}

/**
 * Fetch the theme preference from the server (Config_Store).
 * Returns null if the request fails or returns no valid theme.
 */
async function fetchServerTheme(): Promise<Theme | null> {
  try {
    const res = await fetch('/api/config/theme');
    if (res.ok) {
      const data = (await res.json()) as { theme: Theme | null };
      if (data.theme === 'light' || data.theme === 'dark') {
        return data.theme;
      }
    }
  } catch {
    // Network error or server unavailable — graceful degradation (req 2.5)
  }
  return null;
}

/**
 * Initialize the theme engine.
 *
 * Called after page load to sync with the server. The inline script in
 * index.html has already applied a theme before first paint, so this
 * function only updates if the server has a different preference.
 *
 * Fallback chain: Config_Store → prefers-color-scheme → light
 */
export async function initTheme(): Promise<void> {
  // Attempt to sync with server
  const serverTheme = await fetchServerTheme();

  if (serverTheme) {
    // Server has a preference — apply it (may differ from localStorage)
    const current = getCurrentTheme();
    if (serverTheme !== current) {
      applyTheme(serverTheme);
    }
  } else {
    // Config_Store read failed (req 2.5): fall back to OS preference → light
    const stored = getStoredTheme();
    if (!stored) {
      // No localStorage value either — apply OS preference fallback
      const osTheme = getOSPreference();
      applyTheme(osTheme);
    }
    // If localStorage already has a value, the inline script already applied it
  }
}
