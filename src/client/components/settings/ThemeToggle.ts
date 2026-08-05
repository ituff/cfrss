/**
 * ThemeToggle — Switch between light and dark theme.
 * Updates data-theme on <html>, persists to Config_Store via API,
 * and stores in localStorage to prevent FOUC on next load.
 *
 * Requirements: 2.1, 2.2
 */

import { t, onLanguageChange } from '../../services/i18n.js';

export type Theme = 'light' | 'dark';

export class ThemeToggle {
  private element: HTMLElement;
  private currentTheme: Theme;
  private saving = false;
  private unsubLang: (() => void) | null = null;

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'theme-toggle';
    this.currentTheme = this.detectInitialTheme();
    this.applyTheme(this.currentTheme);
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
   * Detect initial theme from localStorage, then OS preference, then default to light.
   */
  private detectInitialTheme(): Theme {
    // Check localStorage first (fastest, prevents FOUC)
    const stored = localStorage.getItem('theme');
    if (stored === 'light' || stored === 'dark') {
      return stored;
    }

    // Check OS preference
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }

    return 'light';
  }

  /**
   * Apply theme immediately to <html> element (100ms CSS transition handled via CSS).
   */
  private applyTheme(theme: Theme): void {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }

  /**
   * Toggle the theme and persist to server.
   */
  private async toggle(): Promise<void> {
    if (this.saving) return;

    const newTheme: Theme = this.currentTheme === 'light' ? 'dark' : 'light';
    this.currentTheme = newTheme;

    // Apply immediately for snappy UX
    this.applyTheme(newTheme);
    this.render();

    // Persist to server
    this.saving = true;
    try {
      await fetch('/api/config/theme', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
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
      const res = await fetch('/api/config/theme');
      if (res.ok) {
        const data = await res.json() as { theme: Theme | null };
        if (data.theme === 'light' || data.theme === 'dark') {
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
   * Render the toggle switch.
   */
  private render(): void {
    this.element.innerHTML = '';

    const label = document.createElement('span');
    label.className = 'theme-toggle__label';
    label.textContent = t('theme');
    this.element.appendChild(label);

    const btn = document.createElement('button');
    btn.className = 'theme-toggle__btn';
    btn.type = 'button';
    btn.setAttribute('aria-label', `${t('theme')}: ${t(this.currentTheme)}`);
    btn.setAttribute('aria-pressed', this.currentTheme === 'dark' ? 'true' : 'false');
    btn.style.minWidth = '44px';
    btn.style.minHeight = '44px';
    btn.disabled = this.saving;

    // Visual indicator
    const indicator = document.createElement('span');
    indicator.className = `theme-toggle__indicator theme-toggle__indicator--${this.currentTheme}`;
    indicator.textContent = this.currentTheme === 'light' ? '☀️' : '🌙';
    btn.appendChild(indicator);

    const text = document.createElement('span');
    text.className = 'theme-toggle__text';
    text.textContent = t(this.currentTheme);
    btn.appendChild(text);

    btn.addEventListener('click', () => this.toggle());
    this.element.appendChild(btn);
  }
}
