/**
 * LanguageSwitch — pick the interface language (zh / en) from a dropdown,
 * without a page reload.
 * Uses the i18n module's setLanguage() for immediate UI update.
 * Persists language preference to Config_Store via API.
 *
 * Requirements: 13.1, 13.2
 */

import {
  t,
  getLanguage,
  setLanguage,
  persistLanguage,
  loadLanguageFromServer,
  onLanguageChange,
  type SupportedLanguage,
} from '../../services/i18n.js';

/** Native labels — intentionally not translated. */
const LANGUAGE_LABELS: Record<SupportedLanguage, string> = {
  zh: '中文',
  en: 'English',
};

export class LanguageSwitch {
  private element: HTMLElement;
  private currentLang: SupportedLanguage;
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
   * Switch to the specified language. setLanguage() updates the UI
   * immediately; persistLanguage() saves the choice to Config_Store.
   */
  private switchTo(lang: SupportedLanguage): void {
    if (lang === this.currentLang) return;
    setLanguage(lang);
    this.currentLang = lang;
    this.render();
    void persistLanguage(lang);
  }

  /**
   * Load language preference from server (called on app init).
   */
  loadFromServer(): Promise<void> {
    return loadLanguageFromServer();
  }

  /**
   * Render the label + language dropdown.
   */
  private render(): void {
    this.element.innerHTML = '';

    const label = document.createElement('label');
    label.className = 'settings-field__label';
    label.textContent = t('language');
    label.htmlFor = 'settings-language-select';
    this.element.appendChild(label);

    const select = document.createElement('select');
    select.className = 'settings-field__select';
    select.id = 'settings-language-select';
    select.setAttribute('aria-label', t('language'));

    const langs: SupportedLanguage[] = ['zh', 'en'];
    for (const lang of langs) {
      const option = document.createElement('option');
      option.value = lang;
      option.textContent = LANGUAGE_LABELS[lang];
      option.selected = lang === this.currentLang;
      select.appendChild(option);
    }

    select.addEventListener('change', () => {
      void this.switchTo(select.value as SupportedLanguage);
    });

    this.element.appendChild(select);
  }
}
