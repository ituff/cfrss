/**
 * ThemeToggle — pick the active theme from a dropdown
 * (light / dark / oled / eink).
 * Updates data-theme on <html>, persists to Config_Store via API,
 * and stores in localStorage to prevent FOUC on next load.
 *
 * Requirements: 2.1, 2.2
 */

import { t, onLanguageChange } from '../../services/i18n.js';
import { getDeviceId } from '../../services/device.js';
import { THEMES, applyTheme as applyThemeToDocument, getCachedDeviceTheme, type Theme } from '../../services/theme.js';

export type { Theme };

/** Device identification header, so the server stores this value per device. */
function deviceHeaders(): Record<string, string> {
  const id = getDeviceId();
  return id ? { 'X-Device-Id': id } : {};
}

/** Visual indicator per theme, kept distinct even in grayscale. */
const THEME_INDICATORS: Record<Theme, string> = {
  light: '☀️',
  dark: '🌙',
  oled: '⬛',
  eink: '⬜',
};

export class ThemeToggle {
  private element: HTMLElement;
  private currentTheme: Theme;
  private saving = false;
  private unsubLang: (() => void) | null = null;

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'theme-toggle';
    this.currentTheme = this.detectInitialTheme();
    this.unsubLang = onLanguageChange(() => this.render());
    this.render();
  }

  /**
   * Get the rendered DOM element.
   */
  getElement(): HTMLElement {
    return this.element;
  }

  /**
   * Destroy and clean up listeners.
   */
  destroy(): void {
    if (this.unsubLang) {
      this.unsubLang();
      this.unsubLang = null;
    }
  }

  /**
   * Detect initial theme: this device's cache → shared key → OS preference.
   *
   * The device cache comes first because the shared `theme` key may hold a
   * value chosen on a *different* device (e.g. an iPad will have overwritten
   * it while the e-reader wants its own theme).
   */
  private detectInitialTheme(): Theme {
    const cached = getCachedDeviceTheme();
    if (cached) return cached;

    try {
      const stored = localStorage.getItem('theme');
      if ((THEMES as readonly string[]).includes(stored ?? '')) {
        return stored as Theme;
      }
    } catch {
      // ignore
    }

    // Check OS preference
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }

    return 'light';
  }

  /**
   * Apply theme immediately to <html> element and persist locally
   * (both the shared key and this device's first-paint cache).
   */
  private applyTheme(theme: Theme): void {
    applyThemeToDocument(theme);
  }

  /**
   * Switch to a theme and persist to the server.
   */
  private async select(newTheme: Theme): Promise<void> {
    if (this.saving || newTheme === this.currentTheme) return;
    this.currentTheme = newTheme;

    // Apply immediately for snappy UX
    this.applyTheme(newTheme);
    this.render();

    // Persist to server (per device — see services/device.ts)
    this.saving = true;
    try {
      await fetch('/api/config/theme', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...deviceHeaders() },
        body: JSON.stringify({ theme: newTheme }),
      });
    } catch {
      // Silently fail — localStorage already has the value for next load
    } finally {
      this.saving = false;
    }
  }

  /**
   * Load theme from server (called on app init if needed).
   */
  async loadFromServer(): Promise<void> {
    try {
      const res = await fetch('/api/config/theme', { headers: deviceHeaders() });
      if (res.ok) {
        const data = await res.json() as { theme: Theme | null };
        if (data.theme && (THEMES as readonly string[]).includes(data.theme)) {
          this.currentTheme = data.theme;
          this.applyTheme(data.theme);
          this.render();
        }
      }
    } catch {
      // Use current local theme — degradation per requirement 2.5
    }
  }

  /**
   * Render the label + theme dropdown.
   */
  private render(): void {
    this.element.innerHTML = '';

    const label = document.createElement('label');
    label.className = 'settings-field__label';
    label.textContent = t('theme');
    label.htmlFor = 'settings-theme-select';
    this.element.appendChild(label);

    const select = document.createElement('select');
    select.className = 'settings-field__select';
    select.id = 'settings-theme-select';
    select.setAttribute('aria-label', t('theme'));
    select.disabled = this.saving;

    for (const theme of THEMES) {
      const option = document.createElement('option');
      option.value = theme;
      option.textContent = `${THEME_INDICATORS[theme]} ${t(theme)}`;
      option.selected = theme === this.currentTheme;
      select.appendChild(option);
    }

    select.addEventListener('change', () => {
      void this.select(select.value as Theme);
    });

    this.element.appendChild(select);
  }
}
