/**
 * GitHubConfigPanel — GitHub storage configuration panel.
 * Form for repo owner, repo name, PAT, branch, content path.
 * Save persists to Config_Store, test verifies token permissions.
 *
 * Requirements: 12.4, 12.6
 */

import { t, onLanguageChange } from '../../services/i18n.js';

interface GitHubConfigData {
  repoOwner: string;
  repoName: string;
  token: string;
  branch: string;
  contentPath: string;
}

interface TestResult {
  success: boolean;
  message: string;
}

export class GitHubConfigPanel {
  private element: HTMLElement;
  private repoOwner = '';
  private repoName = '';
  private token = '';
  private branch = 'main';
  private contentPath = 'articles';
  private loading = false;
  private saving = false;
  private error: string | null = null;
  private testResult: TestResult | null = null;
  private maskedToken = '';
  private unsubLang: (() => void) | null = null;

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'github-config-panel';
    this.unsubLang = onLanguageChange(() => this.render());
    this.loadConfig();
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
   * Load existing GitHub config from server.
   */
  private async loadConfig(): Promise<void> {
    this.loading = true;
    this.render();

    try {
      const res = await fetch('/api/config/github');
      if (res.ok) {
        // Backend returns a flat object: { repoOwner, repoName, token(masked), branch, contentPath }
        const data = await res.json() as Partial<GitHubConfigData> | null;
        if (data && (data.repoOwner || data.repoName)) {
          this.repoOwner = data.repoOwner || '';
          this.repoName = data.repoName || '';
          this.branch = data.branch || 'main';
          this.contentPath = data.contentPath || 'articles';
          // Token comes back masked from server
          this.maskedToken = data.token || '';
          this.token = ''; // Don't pre-fill actual token
        }
      }
    } catch {
      this.error = t('network_error');
    } finally {
      this.loading = false;
      this.render();
    }
  }

  /**
   * Save the GitHub config.
   */
  private async saveConfig(): Promise<void> {
    if (!this.validateForm()) return;

    this.saving = true;
    this.error = null;
    this.testResult = null;
    this.render();

    try {
      const body: Record<string, string> = {
        repoOwner: this.repoOwner.trim(),
        repoName: this.repoName.trim(),
        branch: this.branch.trim(),
        contentPath: this.contentPath.trim(),
      };

      // Only include token if user entered a new one
      if (this.token.trim()) {
        body.token = this.token.trim();
      }

      const res = await fetch('/api/config/github', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const resBody = await res.json().catch(() => null) as { message?: string } | null;
        throw new Error(resBody?.message || `Error: ${res.status}`);
      }

      // Reset token input after successful save
      this.token = '';
      this.maskedToken = '••••••••';
      this.error = null;
    } catch (err) {
      this.error = err instanceof Error ? err.message : t('network_error');
    } finally {
      this.saving = false;
      this.render();
    }
  }

  /**
   * Test the GitHub connection (verifies token has read/write access).
   */
  private async testConnection(): Promise<void> {
    this.testResult = null;
    this.error = null;
    this.render();

    try {
      const res = await fetch('/api/config/github/test', {
        method: 'POST',
      });

      const body = await res.json() as { success: boolean; message?: string };
      this.testResult = {
        success: body.success,
        message: body.message || (body.success ? 'Connection successful' : 'Connection failed'),
      };
    } catch {
      this.testResult = {
        success: false,
        message: t('network_error'),
      };
    }

    this.render();
  }

  /**
   * Validate the form.
   */
  private validateForm(): boolean {
    if (!this.repoOwner.trim()) {
      this.error = t('validation_error') + ': Repository owner is required';
      this.render();
      return false;
    }
    if (!this.repoName.trim()) {
      this.error = t('validation_error') + ': Repository name is required';
      this.render();
      return false;
    }
    if (!this.branch.trim()) {
      this.error = t('validation_error') + ': Branch is required';
      this.render();
      return false;
    }
    if (!this.contentPath.trim()) {
      this.error = t('validation_error') + ': Content path is required';
      this.render();
      return false;
    }
    return true;
  }

  /**
   * Render the panel.
   */
  private render(): void {
    this.element.innerHTML = '';

    // Title
    const title = document.createElement('h3');
    title.className = 'github-config-panel__title';
    title.textContent = t('github_config');
    this.element.appendChild(title);

    // Error display
    if (this.error) {
      const errorEl = document.createElement('div');
      errorEl.className = 'github-config-panel__error';
      errorEl.setAttribute('role', 'alert');
      errorEl.textContent = this.error;
      this.element.appendChild(errorEl);
    }

    // Loading
    if (this.loading) {
      const loadingEl = document.createElement('div');
      loadingEl.className = 'github-config-panel__loading';
      loadingEl.setAttribute('aria-live', 'polite');
      loadingEl.textContent = t('generating');
      this.element.appendChild(loadingEl);
      return;
    }

    // Form
    const form = document.createElement('form');
    form.className = 'github-config-panel__form';
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.saveConfig();
    });

    const fields: Array<{
      key: 'repoOwner' | 'repoName' | 'token' | 'branch' | 'contentPath';
      label: string;
      type: string;
      placeholder: string;
      required: boolean;
    }> = [
      { key: 'repoOwner', label: 'Repository Owner', type: 'text', placeholder: 'username', required: true },
      { key: 'repoName', label: 'Repository Name', type: 'text', placeholder: 'rss-content', required: true },
      { key: 'token', label: 'Personal Access Token', type: 'password', placeholder: this.maskedToken || 'ghp_...', required: false },
      { key: 'branch', label: 'Branch', type: 'text', placeholder: 'main', required: true },
      { key: 'contentPath', label: 'Content Path', type: 'text', placeholder: 'articles', required: true },
    ];

    for (const field of fields) {
      const group = document.createElement('div');
      group.className = 'github-config-panel__field';

      const label = document.createElement('label');
      label.className = 'github-config-panel__label';
      label.textContent = field.label;
      group.appendChild(label);

      const input = document.createElement('input');
      input.className = 'github-config-panel__input';
      input.type = field.type;
      input.placeholder = field.placeholder;
      input.value = this[field.key];
      input.disabled = this.saving;
      if (field.required && field.key !== 'token') {
        input.required = true;
      }
      input.addEventListener('input', (e) => {
        this[field.key] = (e.target as HTMLInputElement).value;
      });
      group.appendChild(input);

      // Show masked token hint
      if (field.key === 'token' && this.maskedToken && !this.token) {
        const hint = document.createElement('span');
        hint.className = 'github-config-panel__hint';
        hint.textContent = `Current: ${this.maskedToken}`;
        group.appendChild(hint);
      }

      form.appendChild(group);
    }

    // Buttons
    const btnGroup = document.createElement('div');
    btnGroup.className = 'github-config-panel__btn-group';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn btn--primary';
    saveBtn.type = 'submit';
    saveBtn.style.minWidth = '44px';
    saveBtn.style.minHeight = '44px';
    saveBtn.disabled = this.saving;
    saveBtn.textContent = this.saving ? t('generating') : t('save');
    btnGroup.appendChild(saveBtn);

    const testBtn = document.createElement('button');
    testBtn.className = 'btn btn--secondary';
    testBtn.type = 'button';
    testBtn.style.minWidth = '44px';
    testBtn.style.minHeight = '44px';
    testBtn.disabled = this.saving;
    testBtn.textContent = 'Test';
    testBtn.addEventListener('click', () => this.testConnection());
    btnGroup.appendChild(testBtn);

    form.appendChild(btnGroup);
    this.element.appendChild(form);

    // Test result
    if (this.testResult) {
      const resultEl = document.createElement('div');
      resultEl.className = `github-config-panel__test-result github-config-panel__test-result--${this.testResult.success ? 'success' : 'error'}`;
      resultEl.setAttribute('role', 'status');
      resultEl.textContent = this.testResult.message;
      this.element.appendChild(resultEl);
    }
  }
}
