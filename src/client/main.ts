/**
 * SPA entry point.
 * Initializes the app shell, sets up hash-based routing, and detects viewport layout.
 * An auth gate runs first: the Worker requires a Bearer token on every API call.
 */

import { initRouter } from './router.js';
import { AppShell } from './components/AppShell.js';
import { LoginGate, getStoredToken, clearStoredToken, verifyToken } from './components/LoginGate.js';
import { installFetchAuth } from './services/api.js';
import { initPWA } from './services/pwa.js';
import { initTheme } from './services/theme.js';

/**
 * Start the application (after successful authentication).
 */
function startApp(appEl: HTMLElement): void {
  // Attach the Bearer token to every /api/* request (many components use raw fetch)
  installFetchAuth();

  initRouter();

  const shell = new AppShell(appEl);
  shell.init();

  // Ensure default hash route is set
  if (!window.location.hash || window.location.hash === '') {
    window.location.hash = '#/';
  }

  // Initialize PWA support (Service Worker registration, update detection)
  initPWA();

  // Sync theme with server (the inline script in index.html already
  // applied the theme before paint, this just reconciles with Config_Store)
  initTheme();
}

/**
 * Show the login screen. On successful verification the app boots.
 */
function showLogin(appEl: HTMLElement): void {
  appEl.innerHTML = '';
  const gate = new LoginGate(appEl, () => {
    gate.destroy();
    startApp(appEl);
  });
  gate.init();
}

/**
 * Bootstrap the application: authenticate first, then start the app shell.
 */
function bootstrap(): void {
  const appEl = document.getElementById('app');
  if (!appEl) {
    console.error('[CFRSS] #app mount point not found');
    return;
  }

  const saved = getStoredToken();
  if (saved) {
    // Re-validate the stored token; drop it if it has been revoked
    void verifyToken(saved).then((ok) => {
      if (ok) {
        startApp(appEl);
      } else {
        clearStoredToken();
        showLogin(appEl);
      }
    });
  } else {
    showLogin(appEl);
  }
}

// Boot when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
