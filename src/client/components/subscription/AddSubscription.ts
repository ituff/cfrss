/**
 * AddSubscription — Form component for adding a new RSS/Atom feed subscription.
 * Input field for Feed URL (max 2048 chars), category dropdown, and submit button.
 * Shows loading state while validating/probing and error messages from API.
 *
 * Requirements: 5.1, 5.5, 5.6, 5.7
 */

import { t } from '../../services/i18n.js';
import type { Category } from '../../../types/index.js';

export class AddSubscription {
  private element: HTMLElement;
  private categories: Category[];
  private onAdded: () => void;
  private loading = false;
  private error: string | null = null;
  private urlValue = '';
  private categoryValue = 'default';

  constructor(categories: Category[], onAdded: () => void) {
    this.categories = categories;
    this.onAdded = onAdded;
    this.element = document.createElement('div');
    this.element.className = 'add-subscription';
    this.render();
  }

  /**
   * Get the rendered DOM element.
   */
  getElement(): HTMLElement {
    return this.element;
  }

  /**
   * Submit the form — calls POST /api/subscriptions.
   */
  private async submit(): Promise<void> {
    const url = this.urlValue.trim();

    // Client-side validation
    if (!url) {
      this.error = t('validation_error') + ': URL is required';
      this.render();
      return;
    }

    if (url.length > 2048) {
      this.error = t('validation_error') + ': URL exceeds 2048 characters';
      this.render();
      return;
    }

    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      this.error = t('validation_error') + ': URL must start with http:// or https://';
      this.render();
      return;
    }

    this.loading = true;
    this.error = null;
    this.render();

    try {
      const res = await fetch('/api/subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          categoryId: this.categoryValue,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null) as { message?: string } | null;
        const message = body?.message || `Error: ${res.status}`;
        throw new Error(message);
      }

      // Success — notify parent
      this.urlValue = '';
      this.categoryValue = 'default';
      this.onAdded();
    } catch (err) {
      this.error = err instanceof Error ? err.message : t('network_error');
    } finally {
      this.loading = false;
      this.render();
    }
  }

  /**
   * Render the form.
   */
  private render(): void {
    this.element.innerHTML = '';

    const form = document.createElement('form');
    form.className = 'add-subscription__form';
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.submit();
    });

    // URL input
    const urlGroup = document.createElement('div');
    urlGroup.className = 'add-subscription__field';

    const urlLabel = document.createElement('label');
    urlLabel.className = 'add-subscription__label';
    urlLabel.textContent = 'Feed URL';
    urlLabel.setAttribute('for', 'add-sub-url');
    urlGroup.appendChild(urlLabel);

    const urlInput = document.createElement('input');
    urlInput.className = 'add-subscription__input';
    urlInput.type = 'url';
    urlInput.id = 'add-sub-url';
    urlInput.placeholder = 'https://example.com/feed.xml';
    urlInput.maxLength = 2048;
    urlInput.value = this.urlValue;
    urlInput.disabled = this.loading;
    urlInput.required = true;
    urlInput.addEventListener('input', (e) => {
      this.urlValue = (e.target as HTMLInputElement).value;
    });
    urlGroup.appendChild(urlInput);

    form.appendChild(urlGroup);

    // Category selector
    const catGroup = document.createElement('div');
    catGroup.className = 'add-subscription__field';

    const catLabel = document.createElement('label');
    catLabel.className = 'add-subscription__label';
    catLabel.textContent = t('move_to_category');
    catLabel.setAttribute('for', 'add-sub-category');
    catGroup.appendChild(catLabel);

    const catSelect = document.createElement('select');
    catSelect.className = 'add-subscription__select';
    catSelect.id = 'add-sub-category';
    catSelect.disabled = this.loading;
    catSelect.addEventListener('change', (e) => {
      this.categoryValue = (e.target as HTMLSelectElement).value;
    });

    for (const cat of this.categories) {
      const option = document.createElement('option');
      option.value = cat.id;
      option.textContent = cat.name;
      option.selected = cat.id === this.categoryValue;
      catSelect.appendChild(option);
    }

    catGroup.appendChild(catSelect);
    form.appendChild(catGroup);

    // Submit button
    const submitBtn = document.createElement('button');
    submitBtn.className = 'btn btn--primary add-subscription__submit';
    submitBtn.type = 'submit';
    submitBtn.disabled = this.loading;
    submitBtn.style.minWidth = '44px';
    submitBtn.style.minHeight = '44px';
    submitBtn.textContent = this.loading ? t('generating') : t('add');
    form.appendChild(submitBtn);

    this.element.appendChild(form);

    // Error display
    if (this.error) {
      const errorEl = document.createElement('div');
      errorEl.className = 'add-subscription__error';
      errorEl.setAttribute('role', 'alert');
      errorEl.textContent = this.error;
      this.element.appendChild(errorEl);
    }

    // Loading indicator
    if (this.loading) {
      const loadingEl = document.createElement('div');
      loadingEl.className = 'add-subscription__loading';
      loadingEl.setAttribute('aria-live', 'polite');
      loadingEl.textContent = t('generating');
      this.element.appendChild(loadingEl);
    }
  }
}
