/**
 * PWA Service Worker registration and lifecycle management.
 *
 * - Registers /sw.js within 3 seconds of page load
 * - Handles registration failure gracefully (logs warning, continues as web app)
 * - Detects new SW versions and prompts user to refresh
 * - Posts ONLINE_RECOVERY message when connectivity is restored
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6
 */

/** Maximum delay (ms) before SW registration fires after page load. */
const REGISTRATION_DELAY_MS = 2000;

/**
 * Initialize PWA support: register Service Worker and set up lifecycle hooks.
 * Safe to call at app startup — handles environments without SW support gracefully.
 */
export function initPWA(): void {
  if (!('serviceWorker' in navigator)) {
    console.warn('[PWA] Service Worker not supported in this browser. Running as normal web app.');
    return;
  }

  // Register SW within 3 seconds of page load (use 2s delay to stay comfortably under 3s).
  const delay = Math.min(REGISTRATION_DELAY_MS, 3000);
  setTimeout(() => registerServiceWorker(), delay);

  // Listen for online recovery to notify SW
  window.addEventListener('online', handleOnlineRecovery);
}

/**
 * Register the Service Worker and set up update detection.
 */
async function registerServiceWorker(): Promise<void> {
  try {
    const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });

    // Listen for new versions
    registration.addEventListener('updatefound', () => {
      const newWorker = registration.installing;
      if (!newWorker) return;

      newWorker.addEventListener('statechange', () => {
        // A new SW has installed and is waiting to activate
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
          promptUserForUpdate();
        }
      });
    });

    // Also handle the case where a waiting worker already exists (e.g. page was loaded
    // after a new SW installed but before user refreshed).
    if (registration.waiting && navigator.serviceWorker.controller) {
      promptUserForUpdate();
    }

    console.info('[PWA] Service Worker registered successfully.');
  } catch (error) {
    // Requirement 4.5: registration failure → continue as normal web app
    console.warn('[PWA] Service Worker registration failed. Running as normal web app.', error);
  }
}

/**
 * Prompt the user that a new version is available and offer to refresh.
 * Requirement 4.6: detect new version and prompt user.
 */
function promptUserForUpdate(): void {
  // Create a simple notification bar at the top of the page
  const existing = document.getElementById('pwa-update-banner');
  if (existing) return; // Already showing

  const banner = document.createElement('div');
  banner.id = 'pwa-update-banner';
  banner.setAttribute('role', 'alert');
  banner.style.cssText = [
    'position: fixed',
    'top: 0',
    'left: 0',
    'right: 0',
    'z-index: 10000',
    'background: #1a73e8',
    'color: #fff',
    'padding: 12px 16px',
    'display: flex',
    'align-items: center',
    'justify-content: space-between',
    'font-size: 14px',
    'box-shadow: 0 2px 8px rgba(0,0,0,0.15)',
  ].join(';');

  const message = document.createElement('span');
  message.textContent = 'A new version is available.';

  const refreshBtn = document.createElement('button');
  refreshBtn.textContent = 'Refresh';
  refreshBtn.style.cssText = [
    'background: #fff',
    'color: #1a73e8',
    'border: none',
    'padding: 6px 16px',
    'border-radius: 4px',
    'cursor: pointer',
    'font-weight: 600',
    'min-width: 44px',
    'min-height: 44px',
  ].join(';');
  refreshBtn.addEventListener('click', () => {
    window.location.reload();
  });

  const dismissBtn = document.createElement('button');
  dismissBtn.textContent = '✕';
  dismissBtn.setAttribute('aria-label', 'Dismiss');
  dismissBtn.style.cssText = [
    'background: transparent',
    'color: #fff',
    'border: none',
    'padding: 6px',
    'cursor: pointer',
    'font-size: 18px',
    'min-width: 44px',
    'min-height: 44px',
  ].join(';');
  dismissBtn.addEventListener('click', () => {
    banner.remove();
  });

  banner.appendChild(message);
  banner.appendChild(refreshBtn);
  banner.appendChild(dismissBtn);
  document.body.appendChild(banner);
}

/**
 * When the device comes back online, notify the Service Worker so it can
 * refresh cached articles (online recovery within 30s per requirement 3.3).
 */
function handleOnlineRecovery(): void {
  if (!navigator.serviceWorker.controller) return;

  navigator.serviceWorker.controller.postMessage({ type: 'ONLINE_RECOVERY' });
}
