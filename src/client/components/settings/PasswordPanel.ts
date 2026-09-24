/**
 * PasswordPanel — change the access password from the settings page.
 *
 * The Worker authenticates every /api/* request with a Bearer token. This panel
 * lets the single user rotate that credential: it collects the current password
 * plus a new one (with confirmation), calls PUT /api/auth/password, and keeps the
 * locally stored token in sync so the session survives the change.
 */

import { t, onLanguageChange } from '../../services/i18n.js';
import { changePassword, resetPassword, getPasswordStatus } from '../../services/api.js';
import { getStoredToken, storeToken } from '../LoginGate.js';

export class PasswordPanel {
  private element: HTMLElement;
  private unsubLang: (() => void) | null = null;
  private saving = false;
  private hasCustomPassword = false;
  private messageEl: HTMLElement | null = null;
  private currentEl: HTMLInputElement | null = null;
  private newEl: HTMLInputElement | null = null;
  private confirmEl: HTMLInputElement | null = null;
  private submitEl: HTMLButtonElement | null = null;

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'password-panel';
    this.unsubLang = onLanguageChange(() => this.render());
    this.render();
    void this.loadStatus();
  }

  getElement(): HTMLElement {
    return this.element;
  }

  destroy(): void {
    this.unsubLang?.();
    this.unsubLang = null;
  }

  private async loadStatus(): Promise<void> {
    try {
      const status = await getPasswordStatus();
      this.hasCustomPassword = status.hasCustomPassword;
      this.render();
    } catch {
      // Leave the default (env-token) state rendered
    }
  }

  private render(): void {
    this.element.innerHTML = '';

    const form = document.createElement('form');
    form.className = 'password-panel__form';
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      void this.submit();
    });

    this.currentEl = this.field(form, 'password_current', 'current-password');
    this.newEl = this.field(form, 'password_new', 'new-password');
    this.confirmEl = this.field(form, 'password_confirm', 'new-password');

    const actions = document.createElement('div');
    actions.className = 'password-panel__actions';

    this.submitEl = document.createElement('button');
    this.submitEl.type = 'submit';
    this.submitEl.className = 'btn btn--primary';
    this.submitEl.textContent = t('password_save');
    this.submitEl.disabled = this.saving;
    actions.appendChild(this.submitEl);

    form.appendChild(actions);

    this.messageEl = document.createElement('div');
    this.messageEl.className = 'password-panel__message';
    this.messageEl.setAttribute('role', 'status');
    this.messageEl.hidden = true;

    this.element.appendChild(form);
    this.element.appendChild(this.messageEl);

    // Show the reset hatch only when a custom password is actually in effect
    if (this.hasCustomPassword) {
      const resetBtn = document.createElement('button');
      resetBtn.type = 'button';
      resetBtn.className = 'btn btn--secondary password-panel__reset';
      resetBtn.textContent = t('password_reset');
      resetBtn.addEventListener('click', () => void this.reset());
      this.element.appendChild(resetBtn);
    }
  }

  /** Build a labelled password input. */
  private field(form: HTMLElement, labelKey: string, autocomplete: AutoFill): HTMLInputElement {
    const wrap = document.createElement('div');
    wrap.className = 'password-panel__field';

    const label = document.createElement('label');
    label.className = 'password-panel__label';
    label.textContent = t(labelKey);

    const input = document.createElement('input');
    input.type = 'password';
    input.autocomplete = autocomplete;
    input.className = 'password-panel__input';
    input.required = true;

    wrap.appendChild(label);
    wrap.appendChild(input);
    form.appendChild(wrap);
    return input;
  }

  private showMessage(text: string, kind: 'success' | 'error'): void {
    if (!this.messageEl) return;
    this.messageEl.textContent = text;
    this.messageEl.hidden = false;
    this.messageEl.classList.toggle('password-panel__message--success', kind === 'success');
    this.messageEl.classList.toggle('password-panel__message--error', kind === 'error');
  }

  private async submit(): Promise<void> {
    if (this.saving) return;

    const current = this.currentEl?.value ?? '';
    const next = this.newEl?.value ?? '';
    const confirm = this.confirmEl?.value ?? '';

    if (next.length < 6) {
      this.showMessage(t('password_error_short'), 'error');
      return;
    }
    if (next !== confirm) {
      this.showMessage(t('password_error_mismatch'), 'error');
      return;
    }

    this.saving = true;
    if (this.submitEl) this.submitEl.disabled = true;

    try {
      await changePassword(current, next);

      // Keep the session alive with the new credential
      storeToken(next);
      this.clearInputs();
      this.hasCustomPassword = true;
      this.showMessage(t('password_success'), 'success');
    } catch (err) {
      const status = (err as { status?: number }).status;
      this.showMessage(status === 401 ? t('password_error_current') : t('password_error_generic'), 'error');
    } finally {
      this.saving = false;
      this.render();
    }
  }

  private async reset(): Promise<void> {
    const current = this.currentEl?.value ?? '';
    if (!current) {
      this.showMessage(t('password_error_current_required'), 'error');
      return;
    }

    this.saving = true;
    try {
      await resetPassword(current);
      this.clearInputs();
      this.hasCustomPassword = false;
      this.showMessage(t('password_reset_success'), 'success');
    } catch (err) {
      const status = (err as { status?: number }).status;
      this.showMessage(status === 401 ? t('password_error_current') : t('password_error_generic'), 'error');
    } finally {
      this.saving = false;
      this.render();
    }
  }

  private clearInputs(): void {
    if (this.currentEl) this.currentEl.value = '';
    if (this.newEl) this.newEl.value = '';
    if (this.confirmEl) this.confirmEl.value = '';
  }
}

/** Exported for tests: whether a token is currently persisted. */
export function hasStoredToken(): boolean {
  return getStoredToken() !== null;
}
