/**
 * LoginGate — access-token login screen.
 *
 * The Worker requires a Bearer token on every /api/* request. This gate
 * collects the token from the user, verifies it against a lightweight
 * authenticated endpoint, and persists it in localStorage so subsequent
 * visits authenticate automatically.
 */

import { setAuthToken, getTheme } from '../services/api.js';
import { t, onLanguageChange } from '../services/i18n.js';

const STORAGE_KEY = 'cfrss_auth_token';

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function storeToken(token: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, token);
  } catch {
    // Storage unavailable (private mode etc.) — session-only auth
  }
}

export function clearStoredToken(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

/**
 * Attach the token and probe an authenticated endpoint to check validity.
 * Clears the in-memory token when verification fails.
 */
export async function verifyToken(token: string): Promise<boolean> {
  setAuthToken(token);
  try {
    await getTheme();
    return true;
  } catch {
    setAuthToken('');
    return false;
  }
}

export class LoginGate {
  private container: HTMLElement;
  private onSuccess: (token: string) => void;
  private unsubscribeLang: (() => void) | null = null;
  private errorEl: HTMLElement | null = null;
  private buttonEl: HTMLButtonElement | null = null;
  private inputEl: HTMLInputElement | null = null;

  constructor(container: HTMLElement, onSuccess: (token: string) => void) {
    this.container = container;
    this.onSuccess = onSuccess;
  }

  init(): void {
    this.unsubscribeLang = onLanguageChange(() => this.render());
    this.render();
  }

  destroy(): void {
    if (this.unsubscribeLang) {
      this.unsubscribeLang();
      this.unsubscribeLang = null;
    }
  }

  showError(message: string): void {
    if (this.errorEl) {
      this.errorEl.textContent = message;
      this.errorEl.style.display = 'block';
    }
    if (this.buttonEl) {
      this.buttonEl.disabled = false;
      this.buttonEl.textContent = t('login_button');
    }
  }

  private render(): void {
    this.container.innerHTML = '';

    const wrap = document.createElement('div');
    wrap.className = 'login-gate';

    const title = document.createElement('h1');
    title.className = 'login-title';
    title.textContent = t('login_title');

    const subtitle = document.createElement('p');
    subtitle.className = 'login-subtitle';
    subtitle.textContent = t('login_subtitle');

    const form = document.createElement('form');
    form.className = 'login-form';

    this.inputEl = document.createElement('input');
    this.inputEl.type = 'password';
    this.inputEl.className = 'login-input';
    this.inputEl.placeholder = t('login_token_placeholder');
    this.inputEl.autocomplete = 'current-password';
    this.inputEl.required = true;

    this.buttonEl = document.createElement('button');
    this.buttonEl.type = 'submit';
    this.buttonEl.className = 'login-button';
    this.buttonEl.textContent = t('login_button');

    this.errorEl = document.createElement('div');
    this.errorEl.className = 'login-error';
    this.errorEl.style.display = 'none';

    form.appendChild(this.inputEl);
    form.appendChild(this.buttonEl);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleSubmit();
    });

    wrap.appendChild(title);
    wrap.appendChild(subtitle);
    wrap.appendChild(form);
    wrap.appendChild(this.errorEl);
    this.container.appendChild(wrap);

    this.inputEl.focus();
  }

  private async handleSubmit(): Promise<void> {
    const token = this.inputEl?.value.trim() ?? '';
    if (!token) return;

    if (this.errorEl) this.errorEl.style.display = 'none';
    if (this.buttonEl) {
      this.buttonEl.disabled = true;
      this.buttonEl.textContent = t('login_verifying');
    }

    const ok = await verifyToken(token);
    if (ok) {
      storeToken(token);
      this.onSuccess(token);
    } else {
      this.showError(t('login_error'));
    }
  }
}
