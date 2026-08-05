/**
 * SPA entry point.
 * Initializes the app shell, sets up hash-based routing, and detects viewport layout.
 */

import { initRouter } from './router.js';
import { AppShell } from './components/AppShell.js';
import { initPWA } from './services/pwa.js';
import { initTheme } from './services/theme.js';

/**
 * Bootstrap the application.
 */
function bootstrap(): void {
  // Initialize the router (start listening for hash changes)
  initRouter();

  // Get the mount point
  const appEl = document.getElementById('app');
  if (!appEl) {
    console.error('[CFRSS] #app mount point not found');
    return;
  }

  // Create and initialize the app shell
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

// Boot when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
