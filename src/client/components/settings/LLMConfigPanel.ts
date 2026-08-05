/**
 * LLMConfigPanel — LLM configuration management panel.
 * Supports CRUD for LLM configs, connection testing, and function assignment.
 *
 * Requirements: 11.1, 11.7, 12.4
 */

import { t, onLanguageChange } from '../../services/i18n.js';

interface LLMConfigItem {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  modelName: string;
}

interface LLMAssignments {
  summarize: string | null;
  translate: string | null;
}

interface TestResult {
  configId: string;
  success: boolean;
  message: string;
}

export class LLMConfigPanel {
  private element: HTMLElement;
  private configs: LLMConfigItem[] = [];
  private assignments: LLMAssignments = { summarize: null, translate: null };
  private loading = false;
  private error: string | null = null;
  private testResults: Map<string, TestResult> = new Map();
  private editingId: string | null = null;
  private showAddForm = false;
  private unsubLang: (() => void) | null = null;

  // Form state
  private formName = '';
  private formBaseUrl = '';
  private formApiKey = '';
  private formModelName = '';

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'llm-config-panel';
    this.unsubLang = onLanguageChange(() => this.render());
    this.loadConfigs();
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
   * Load all LLM configs and assignments from server.
   */
  private async loadConfigs(): Promise<void> {
    this.loading = true;
    this.error = null;
    this.render();

    try {
      const [configsRes, assignmentsRes] = await Promise.all([
        fetch('/api/config/llm'),
        fetch('/api/config/llm/assignments'),
      ]);

      if (configsRes.ok) {
        const data = await configsRes.json() as { configs: LLMConfigItem[] };
        this.configs = data.configs || [];
      }

      if (assignmentsRes.ok) {
        const data = await assignmentsRes.json() as { assignments: LLMAssignments };
        this.assignments = data.assignments || { summarize: null, translate: null };
      }
    } catch {
      this.error = t('network_error');
    } finally {
      this.loading = false;
      this.render();
    }
  }

  /**
   * Add a new LLM config.
   */
  private async addConfig(): Promise<void> {
    if (!this.validateForm()) return;

    this.loading = true;
    this.error = null;
    this.render();

    try {
      const res = await fetch('/api/config/llm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: this.formName.trim(),
          baseUrl: this.formBaseUrl.trim(),
          apiKey: this.formApiKey.trim(),
          modelName: this.formModelName.trim(),
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null) as { message?: string } | null;
        throw new Error(body?.message || `Error: ${res.status}`);
      }

      this.resetForm();
      this.showAddForm = false;
      await this.loadConfigs();
    } catch (err) {
      this.error = err instanceof Error ? err.message : t('network_error');
      this.loading = false;
      this.render();
    }
  }

  /**
   * Update an existing LLM config.
   */
  private async updateConfig(id: string): Promise<void> {
    if (!this.validateForm()) return;

    this.loading = true;
    this.error = null;
    this.render();

    try {
      const res = await fetch(`/api/config/llm/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: this.formName.trim(),
          baseUrl: this.formBaseUrl.trim(),
          apiKey: this.formApiKey.trim(),
          modelName: this.formModelName.trim(),
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null) as { message?: string } | null;
        throw new Error(body?.message || `Error: ${res.status}`);
      }

      this.editingId = null;
      this.resetForm();
      await this.loadConfigs();
    } catch (err) {
      this.error = err instanceof Error ? err.message : t('network_error');
      this.loading = false;
      this.render();
    }
  }

  /**
   * Delete an LLM config.
   */
  private async deleteConfig(id: string): Promise<void> {
    this.loading = true;
    this.error = null;
    this.render();

    try {
      const res = await fetch(`/api/config/llm/${id}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null) as { message?: string } | null;
        throw new Error(body?.message || `Error: ${res.status}`);
      }

      await this.loadConfigs();
    } catch (err) {
      this.error = err instanceof Error ? err.message : t('network_error');
      this.loading = false;
      this.render();
    }
  }

  /**
   * Test connection for an LLM config.
   */
  private async testConnection(id: string): Promise<void> {
    this.testResults.delete(id);
    this.render();

    try {
      const res = await fetch(`/api/config/llm/${id}/test`, {
        method: 'POST',
      });

      const body = await res.json() as { success: boolean; message?: string };
      this.testResults.set(id, {
        configId: id,
        success: body.success,
        message: body.message || (body.success ? 'OK' : 'Failed'),
      });
    } catch {
      this.testResults.set(id, {
        configId: id,
        success: false,
        message: t('network_error'),
      });
    }

    this.render();
  }

  /**
   * Update function assignments.
   */
  private async saveAssignments(): Promise<void> {
    this.loading = true;
    this.error = null;
    this.render();

    try {
      const res = await fetch('/api/config/llm/assignments', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.assignments),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null) as { message?: string } | null;
        throw new Error(body?.message || `Error: ${res.status}`);
      }
    } catch (err) {
      this.error = err instanceof Error ? err.message : t('network_error');
    } finally {
      this.loading = false;
      this.render();
    }
  }

  /**
   * Validate the add/edit form.
   */
  private validateForm(): boolean {
    if (!this.formName.trim()) {
      this.error = t('validation_error') + ': Name is required';
      this.render();
      return false;
    }
    if (!this.formBaseUrl.trim()) {
      this.error = t('validation_error') + ': Base URL is required';
      this.render();
      return false;
    }
    if (!this.formBaseUrl.trim().startsWith('https://')) {
      this.error = t('validation_error') + ': Base URL must start with https://';
      this.render();
      return false;
    }
    if (!this.formApiKey.trim()) {
      this.error = t('validation_error') + ': API Key is required';
      this.render();
      return false;
    }
    if (!this.formModelName.trim()) {
      this.error = t('validation_error') + ': Model name is required';
      this.render();
      return false;
    }
    return true;
  }

  /**
   * Reset form fields.
   */
  private resetForm(): void {
    this.formName = '';
    this.formBaseUrl = '';
    this.formApiKey = '';
    this.formModelName = '';
  }

  /**
   * Start editing a config.
   */
  private startEdit(config: LLMConfigItem): void {
    this.editingId = config.id;
    this.formName = config.name;
    this.formBaseUrl = config.baseUrl;
    this.formApiKey = '';  // Don't pre-fill key for security
    this.formModelName = config.modelName;
    this.showAddForm = false;
    this.render();
  }

  /**
   * Cancel editing.
   */
  private cancelEdit(): void {
    this.editingId = null;
    this.showAddForm = false;
    this.resetForm();
    this.error = null;
    this.render();
  }

  /**
   * Render the panel.
   */
  private render(): void {
    this.element.innerHTML = '';

    // Title
    const title = document.createElement('h3');
    title.className = 'llm-config-panel__title';
    title.textContent = t('llm_config');
    this.element.appendChild(title);

    // Error display
    if (this.error) {
      const errorEl = document.createElement('div');
      errorEl.className = 'llm-config-panel__error';
      errorEl.setAttribute('role', 'alert');
      errorEl.textContent = this.error;
      this.element.appendChild(errorEl);
    }

    // Loading
    if (this.loading) {
      const loadingEl = document.createElement('div');
      loadingEl.className = 'llm-config-panel__loading';
      loadingEl.setAttribute('aria-live', 'polite');
      loadingEl.textContent = t('generating');
      this.element.appendChild(loadingEl);
      return;
    }

    // Config list
    this.renderConfigList();

    // Add button (if not already showing form or editing)
    if (!this.showAddForm && !this.editingId && this.configs.length < 10) {
      const addBtn = document.createElement('button');
      addBtn.className = 'btn btn--primary llm-config-panel__add-btn';
      addBtn.type = 'button';
      addBtn.style.minWidth = '44px';
      addBtn.style.minHeight = '44px';
      addBtn.textContent = t('add');
      addBtn.addEventListener('click', () => {
        this.showAddForm = true;
        this.resetForm();
        this.error = null;
        this.render();
      });
      this.element.appendChild(addBtn);
    }

    // Add/edit form
    if (this.showAddForm || this.editingId) {
      this.renderForm();
    }

    // Function assignments section
    this.renderAssignments();
  }

  /**
   * Render the list of existing configs.
   */
  private renderConfigList(): void {
    if (this.configs.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'llm-config-panel__empty';
      empty.textContent = 'No LLM configurations';
      this.element.appendChild(empty);
      return;
    }

    const list = document.createElement('ul');
    list.className = 'llm-config-panel__list';

    for (const config of this.configs) {
      if (this.editingId === config.id) continue; // Skip if editing this one

      const item = document.createElement('li');
      item.className = 'llm-config-panel__item';

      const info = document.createElement('div');
      info.className = 'llm-config-panel__item-info';

      const name = document.createElement('strong');
      name.textContent = config.name;
      info.appendChild(name);

      const details = document.createElement('span');
      details.className = 'llm-config-panel__item-details';
      details.textContent = ` — ${config.modelName} (${config.baseUrl})`;
      info.appendChild(details);

      item.appendChild(info);

      // Action buttons
      const actions = document.createElement('div');
      actions.className = 'llm-config-panel__item-actions';

      const editBtn = document.createElement('button');
      editBtn.className = 'btn btn--small';
      editBtn.type = 'button';
      editBtn.style.minWidth = '44px';
      editBtn.style.minHeight = '44px';
      editBtn.textContent = t('edit');
      editBtn.addEventListener('click', () => this.startEdit(config));
      actions.appendChild(editBtn);

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'btn btn--small btn--danger';
      deleteBtn.type = 'button';
      deleteBtn.style.minWidth = '44px';
      deleteBtn.style.minHeight = '44px';
      deleteBtn.textContent = t('delete');
      deleteBtn.addEventListener('click', () => this.deleteConfig(config.id));
      actions.appendChild(deleteBtn);

      const testBtn = document.createElement('button');
      testBtn.className = 'btn btn--small btn--secondary';
      testBtn.type = 'button';
      testBtn.style.minWidth = '44px';
      testBtn.style.minHeight = '44px';
      testBtn.textContent = 'Test';
      testBtn.addEventListener('click', () => this.testConnection(config.id));
      actions.appendChild(testBtn);

      item.appendChild(actions);

      // Test result
      const testResult = this.testResults.get(config.id);
      if (testResult) {
        const resultEl = document.createElement('div');
        resultEl.className = `llm-config-panel__test-result llm-config-panel__test-result--${testResult.success ? 'success' : 'error'}`;
        resultEl.setAttribute('role', 'status');
        resultEl.textContent = testResult.message;
        item.appendChild(resultEl);
      }

      list.appendChild(item);
    }

    this.element.appendChild(list);
  }

  /**
   * Render the add/edit form.
   */
  private renderForm(): void {
    const form = document.createElement('form');
    form.className = 'llm-config-panel__form';
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (this.editingId) {
        this.updateConfig(this.editingId);
      } else {
        this.addConfig();
      }
    });

    const fields: Array<{ key: 'formName' | 'formBaseUrl' | 'formApiKey' | 'formModelName'; label: string; type: string; placeholder: string }> = [
      { key: 'formName', label: 'Name', type: 'text', placeholder: 'My LLM Config' },
      { key: 'formBaseUrl', label: 'Base URL', type: 'url', placeholder: 'https://api.openai.com/v1' },
      { key: 'formApiKey', label: 'API Key', type: 'password', placeholder: 'sk-...' },
      { key: 'formModelName', label: 'Model', type: 'text', placeholder: 'gpt-4' },
    ];

    for (const field of fields) {
      const group = document.createElement('div');
      group.className = 'llm-config-panel__field';

      const label = document.createElement('label');
      label.className = 'llm-config-panel__label';
      label.textContent = field.label;
      group.appendChild(label);

      const input = document.createElement('input');
      input.className = 'llm-config-panel__input';
      input.type = field.type;
      input.placeholder = field.placeholder;
      input.value = this[field.key];
      input.required = field.key !== 'formApiKey' || !this.editingId; // API key optional when editing
      input.addEventListener('input', (e) => {
        this[field.key] = (e.target as HTMLInputElement).value;
      });
      group.appendChild(input);

      form.appendChild(group);
    }

    // Buttons
    const btnGroup = document.createElement('div');
    btnGroup.className = 'llm-config-panel__btn-group';

    const submitBtn = document.createElement('button');
    submitBtn.className = 'btn btn--primary';
    submitBtn.type = 'submit';
    submitBtn.style.minWidth = '44px';
    submitBtn.style.minHeight = '44px';
    submitBtn.textContent = t('save');
    btnGroup.appendChild(submitBtn);

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn btn--secondary';
    cancelBtn.type = 'button';
    cancelBtn.style.minWidth = '44px';
    cancelBtn.style.minHeight = '44px';
    cancelBtn.textContent = t('cancel');
    cancelBtn.addEventListener('click', () => this.cancelEdit());
    btnGroup.appendChild(cancelBtn);

    form.appendChild(btnGroup);
    this.element.appendChild(form);
  }

  /**
   * Render the function assignments section.
   */
  private renderAssignments(): void {
    if (this.configs.length === 0) return;

    const section = document.createElement('div');
    section.className = 'llm-config-panel__assignments';

    const heading = document.createElement('h4');
    heading.textContent = 'Function Assignments';
    section.appendChild(heading);

    const functions: Array<{ key: 'summarize' | 'translate'; label: string }> = [
      { key: 'summarize', label: t('summarize') },
      { key: 'translate', label: t('translate') },
    ];

    for (const fn of functions) {
      const group = document.createElement('div');
      group.className = 'llm-config-panel__assignment-row';

      const label = document.createElement('label');
      label.className = 'llm-config-panel__assignment-label';
      label.textContent = fn.label;
      group.appendChild(label);

      const select = document.createElement('select');
      select.className = 'llm-config-panel__assignment-select';
      select.style.minHeight = '44px';

      // None option
      const noneOpt = document.createElement('option');
      noneOpt.value = '';
      noneOpt.textContent = '— None —';
      noneOpt.selected = !this.assignments[fn.key];
      select.appendChild(noneOpt);

      for (const config of this.configs) {
        const opt = document.createElement('option');
        opt.value = config.id;
        opt.textContent = config.name;
        opt.selected = this.assignments[fn.key] === config.id;
        select.appendChild(opt);
      }

      select.addEventListener('change', (e) => {
        const value = (e.target as HTMLSelectElement).value;
        this.assignments[fn.key] = value || null;
      });

      group.appendChild(select);
      section.appendChild(group);
    }

    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn btn--primary llm-config-panel__save-assignments';
    saveBtn.type = 'button';
    saveBtn.style.minWidth = '44px';
    saveBtn.style.minHeight = '44px';
    saveBtn.textContent = t('save');
    saveBtn.addEventListener('click', () => this.saveAssignments());
    section.appendChild(saveBtn);

    this.element.appendChild(section);
  }
}
