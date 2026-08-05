/**
 * SubscriptionList — Main subscription management component.
 * Fetches subscriptions and categories from the API, groups them by category,
 * and renders CategoryGroup instances. Provides add subscription and OPML import/export buttons.
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 6.1
 */

import { t, onLanguageChange } from '../../services/i18n.js';
import { CategoryGroup } from './CategoryGroup.js';
import { AddSubscription } from './AddSubscription.js';
import { OPMLImport } from './OPMLImport.js';

import type { Subscription, Category } from '../../../types/index.js';

export class SubscriptionList {
  private element: HTMLElement;
  private subscriptions: Subscription[] = [];
  private categories: Category[] = [];
  private categoryGroups: CategoryGroup[] = [];
  private addSubscription: AddSubscription | null = null;
  private opmlImport: OPMLImport | null = null;
  private showAddForm = false;
  private showImportForm = false;
  private loading = false;
  private error: string | null = null;
  private unsubLanguage: (() => void) | null = null;

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'subscription-list';
    this.unsubLanguage = onLanguageChange(() => this.render());
    this.load();
  }

  /**
   * Get the rendered DOM element.
   */
  getElement(): HTMLElement {
    return this.element;
  }

  /**
   * Clean up event listeners.
   */
  destroy(): void {
    if (this.unsubLanguage) {
      this.unsubLanguage();
      this.unsubLanguage = null;
    }
  }

  /**
   * Load subscriptions and categories from the API.
   */
  private async load(): Promise<void> {
    this.loading = true;
    this.error = null;
    this.render();

    try {
      const [subsRes, catsRes] = await Promise.all([
        fetch('/api/subscriptions'),
        fetch('/api/categories'),
      ]);

      if (!subsRes.ok) throw new Error(`Failed to load subscriptions: ${subsRes.status}`);
      if (!catsRes.ok) throw new Error(`Failed to load categories: ${catsRes.status}`);

      this.subscriptions = await subsRes.json();
      this.categories = await catsRes.json();
    } catch (err) {
      this.error = err instanceof Error ? err.message : t('network_error');
    } finally {
      this.loading = false;
      this.render();
    }
  }

  /**
   * Delete a subscription by ID with user confirmation.
   */
  private async deleteSubscription(id: string, title: string): Promise<void> {
    const confirmed = window.confirm(`${t('delete_subscription')}: "${title}"?`);
    if (!confirmed) return;

    try {
      const res = await fetch(`/api/subscriptions/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
      await this.load();
    } catch (err) {
      alert(err instanceof Error ? err.message : t('network_error'));
    }
  }

  /**
   * Handle successful subscription addition.
   */
  private handleSubscriptionAdded(): void {
    this.showAddForm = false;
    this.load();
  }

  /**
   * Handle OPML import completion.
   */
  private handleImportComplete(): void {
    this.load();
  }

  /**
   * Export subscriptions as OPML.
   */
  private async exportOPML(): Promise<void> {
    try {
      const res = await fetch('/api/opml/export');
      if (!res.ok) throw new Error(`Export failed: ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'subscriptions.opml';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(err instanceof Error ? err.message : t('network_error'));
    }
  }

  /**
   * Group subscriptions by their category ID.
   */
  private groupByCategory(): Map<string, Subscription[]> {
    const grouped = new Map<string, Subscription[]>();
    for (const cat of this.categories) {
      grouped.set(cat.id, []);
    }
    for (const sub of this.subscriptions) {
      const list = grouped.get(sub.categoryId);
      if (list) {
        list.push(sub);
      } else {
        // fallback to default if category not found
        const defaultList = grouped.get('default') || [];
        defaultList.push(sub);
        grouped.set('default', defaultList);
      }
    }
    return grouped;
  }

  /**
   * Render the full component.
   */
  private render(): void {
    this.element.innerHTML = '';
    this.categoryGroups = [];

    // Header with actions
    const header = document.createElement('div');
    header.className = 'subscription-list__header';

    const title = document.createElement('h2');
    title.className = 'subscription-list__title';
    title.textContent = t('subscriptions');
    header.appendChild(title);

    const actions = document.createElement('div');
    actions.className = 'subscription-list__actions';

    const addBtn = document.createElement('button');
    addBtn.className = 'btn btn--primary';
    addBtn.textContent = t('add_subscription');
    addBtn.style.minWidth = '44px';
    addBtn.style.minHeight = '44px';
    addBtn.addEventListener('click', () => {
      this.showAddForm = !this.showAddForm;
      this.render();
    });
    actions.appendChild(addBtn);

    const importBtn = document.createElement('button');
    importBtn.className = 'btn btn--secondary';
    importBtn.textContent = t('import_opml');
    importBtn.style.minWidth = '44px';
    importBtn.style.minHeight = '44px';
    importBtn.addEventListener('click', () => {
      this.showImportForm = !this.showImportForm;
      this.render();
    });
    actions.appendChild(importBtn);

    const exportBtn = document.createElement('button');
    exportBtn.className = 'btn btn--secondary';
    exportBtn.textContent = t('export_opml');
    exportBtn.style.minWidth = '44px';
    exportBtn.style.minHeight = '44px';
    exportBtn.addEventListener('click', () => this.exportOPML());
    actions.appendChild(exportBtn);

    header.appendChild(actions);
    this.element.appendChild(header);

    // Add subscription form (toggled)
    if (this.showAddForm) {
      this.addSubscription = new AddSubscription(
        this.categories,
        () => this.handleSubscriptionAdded()
      );
      this.element.appendChild(this.addSubscription.getElement());
    }

    // OPML Import form (toggled)
    if (this.showImportForm) {
      this.opmlImport = new OPMLImport(() => this.handleImportComplete());
      this.element.appendChild(this.opmlImport.getElement());
    }

    // Loading state
    if (this.loading) {
      const loader = document.createElement('div');
      loader.className = 'subscription-list__loading';
      loader.textContent = '...';
      this.element.appendChild(loader);
      return;
    }

    // Error state
    if (this.error) {
      const errorEl = document.createElement('div');
      errorEl.className = 'subscription-list__error';
      errorEl.textContent = this.error;
      const retryBtn = document.createElement('button');
      retryBtn.className = 'btn btn--secondary';
      retryBtn.textContent = t('retry');
      retryBtn.addEventListener('click', () => this.load());
      errorEl.appendChild(retryBtn);
      this.element.appendChild(errorEl);
      return;
    }

    // Empty state
    if (this.subscriptions.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'subscription-list__empty';
      empty.textContent = t('no_subscriptions');
      this.element.appendChild(empty);
      return;
    }

    // Render categories with subscriptions
    const grouped = this.groupByCategory();
    const sortedCategories = [...this.categories].sort((a, b) => a.order - b.order);

    for (const cat of sortedCategories) {
      const subs = grouped.get(cat.id) || [];
      const group = new CategoryGroup(cat, subs, (id, title) =>
        this.deleteSubscription(id, title)
      );
      this.categoryGroups.push(group);
      this.element.appendChild(group.getElement());
    }
  }
}
