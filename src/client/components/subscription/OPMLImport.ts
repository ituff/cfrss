/**
 * OPMLImport — File upload component for importing OPML subscription files.
 * Accepts .opml and .xml files with a 5MB size limit.
 * Shows import progress/results (imported/skipped/failed counts).
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.6
 */

import { t } from '../../services/i18n.js';
import type { OPMLImportResult } from '../../../types/index.js';

/** Maximum file size: 5MB */
const MAX_FILE_SIZE = 5 * 1024 * 1024;

export class OPMLImport {
  private element: HTMLElement;
  private onComplete: () => void;
  private loading = false;
  private error: string | null = null;
  private result: OPMLImportResult | null = null;

  constructor(onComplete: () => void) {
    this.onComplete = onComplete;
    this.element = document.createElement('div');
    this.element.className = 'opml-import';
    this.render();
  }

  /**
   * Get the rendered DOM element.
   */
  getElement(): HTMLElement {
    return this.element;
  }

  /**
   * Handle file selection and upload.
   */
  private async handleFile(file: File): Promise<void> {
    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      this.error = t('file_too_large');
      this.render();
      return;
    }

    // Validate file extension
    const name = file.name.toLowerCase();
    if (!name.endsWith('.opml') && !name.endsWith('.xml')) {
      this.error = t('invalid_file_type');
      this.render();
      return;
    }

    this.loading = true;
    this.error = null;
    this.result = null;
    this.render();

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/opml/import', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null) as { message?: string } | null;
        const message = body?.message || `${t('import_failed')}: HTTP ${res.status}`;
        throw new Error(message);
      }

      this.result = await res.json();
      this.onComplete();
    } catch (err) {
      this.error = err instanceof Error ? err.message : t('import_failed');
    } finally {
      this.loading = false;
      this.render();
    }
  }

  /**
   * Render the component.
   */
  private render(): void {
    this.element.innerHTML = '';

    const container = document.createElement('div');
    container.className = 'opml-import__container';

    // Title
    const heading = document.createElement('h3');
    heading.className = 'opml-import__title';
    heading.textContent = t('import_opml');
    container.appendChild(heading);

    // File input
    if (!this.loading && !this.result) {
      const inputGroup = document.createElement('div');
      inputGroup.className = 'opml-import__input-group';

      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.className = 'opml-import__file-input';
      fileInput.accept = '.opml,.xml';
      fileInput.id = 'opml-file-input';
      fileInput.addEventListener('change', (e) => {
        const target = e.target as HTMLInputElement;
        const file = target.files?.[0];
        if (file) {
          this.handleFile(file);
        }
      });

      const label = document.createElement('label');
      label.className = 'opml-import__label btn btn--secondary';
      label.setAttribute('for', 'opml-file-input');
      label.textContent = t('choose_opml_file');
      label.style.minWidth = '44px';
      label.style.minHeight = '44px';
      label.style.cursor = 'pointer';

      const hint = document.createElement('span');
      hint.className = 'opml-import__hint';
      hint.textContent = t('opml_hint');

      inputGroup.appendChild(fileInput);
      inputGroup.appendChild(label);
      inputGroup.appendChild(hint);
      container.appendChild(inputGroup);
    }

    // Loading state
    if (this.loading) {
      const loadingEl = document.createElement('div');
      loadingEl.className = 'opml-import__loading';
      loadingEl.setAttribute('aria-live', 'polite');
      loadingEl.textContent = t('importing_subscriptions');
      container.appendChild(loadingEl);
    }

    // Error display
    if (this.error) {
      const errorEl = document.createElement('div');
      errorEl.className = 'opml-import__error';
      errorEl.setAttribute('role', 'alert');
      errorEl.textContent = this.error;
      container.appendChild(errorEl);
    }

    // Import results
    if (this.result) {
      const resultEl = document.createElement('div');
      resultEl.className = 'opml-import__result';
      resultEl.setAttribute('role', 'status');

      const summary = document.createElement('div');
      summary.className = 'opml-import__summary';

      const imported = document.createElement('span');
      imported.className = 'opml-import__count opml-import__count--imported';
      imported.textContent = `✓ ${t('imported_count')}: ${this.result.imported}`;
      summary.appendChild(imported);

      const skipped = document.createElement('span');
      skipped.className = 'opml-import__count opml-import__count--skipped';
      skipped.textContent = `⊘ ${t('skipped_count')}: ${this.result.skipped}`;
      summary.appendChild(skipped);

      const failed = document.createElement('span');
      failed.className = 'opml-import__count opml-import__count--failed';
      failed.textContent = `✗ ${t('failed_count')}: ${this.result.failed}`;
      summary.appendChild(failed);

      resultEl.appendChild(summary);

      // Reset button to import another file
      const resetBtn = document.createElement('button');
      resetBtn.className = 'btn btn--secondary';
      resetBtn.textContent = t('import_another');
      resetBtn.style.minWidth = '44px';
      resetBtn.style.minHeight = '44px';
      resetBtn.addEventListener('click', () => {
        this.result = null;
        this.error = null;
        this.render();
      });
      resultEl.appendChild(resetBtn);

      container.appendChild(resultEl);
    }

    this.element.appendChild(container);
  }
}
