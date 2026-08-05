/**
 * LanguageSwitch — Switch between zh (Chinese) and en (English) without page reload.
 * Uses the i18n module's setLanguage() for immediate UI update.
 * Persists language preference to Config_Store via API.
 *
 * Requirements: 13.1, 13.2
 */

import {
  t,
  getLanguage,
  setLanguage,
  onLanguageChange,
  type SupportedLanguage,
} from '../../services/i18n.js';

export class LanguageSwitch {
  private element: HTMLElement;
  private currentLang: SupportedLanguage;
  private saving = false;
  private unsubLang: (() => void) | null = null;

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'language-switch';
    this.currentLang = getLanguage();
    this.unsubLang = onLanguageChange((lang) => {
      this.currentLang = lang;
      this.render();
    });
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
   * Switch to the specified language.
   */
  private async switchTo(lang: SupportedLanguage): Promise<void> {
    if (lang === this.currentLang || this.saving) return;

    // Update immediately via i18n module — no page reload
    setLanguage(lang);
    this.currentLang = lang;
    this.render();

    // Persist to server
    this.saving = true;
    try {
      await fetch('/api/config/language', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: lang }),
      });
    } catch {
      // Silently fail — i18n module already switched
    } finally {
      this.saving = false;
    }
  }

  /**
   * Load language preference from server (called on app init).
   */
  async loadFromServer(): Promise<void> {
    try {
      const res = await fetch('/api/config/language');
      if (res.ok) {
        const data = await res.json() as { language: SupportedLanguage | null };
        if (data.language === 'zh' || data.language === 'en') {
          setLanguage(data.language);
        }
      }
    } catch {
      // Use auto-detected language — degradation strategy
    }
  }

  /**
   * Render the language switch buttons.
   */
  private render(): void {
    this.element.innerHTML = '';

    const label = document.createElement('span');
    label.className = 'language-switch__label';
    label.textContent = t('language');
    this.element.appendChild(label);

    const group = document.createElement('div');
    group.className = 'language-switch__group';
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-label', t('language'));

    const langs: Array<{ value: SupportedLanguage; label: string }> = [
      { value: 'zh', label: '中文' },
      { value: 'en', label: 'English' },
    ];

    for (const { value, label: langLabel } of langs) {
      const btn = document.createElement('button');
      btn.className = 'language-switch__btn';
      btn.type = 'button';
      btn.setAttribute('role', 'radio');
      btn.setAttribute('aria-checked', value === this.currentLang ? 'true' : 'false');
      btn.setAttribute('aria-label', langLabel);
      btn.style.minWidth = '44px';
      btn.style.minHeight = '44px';
      btn.disabled = this.saving;

      if (value === this.currentLang) {
        btn.classList.add('language-switch__btn--active');
      }

      btn.textContent = langLabel;
      btn.addEventListener('click', () => this.switchTo(value));
      group.appendChild(btn);
    }

    this.element.appendChild(group);
  }
}
