/**
 * CategoryGroup — A collapsible category section in the subscription list.
 * Shows category name with subscription count, lists subscriptions within.
 * Each subscription shows title and last-fetched time.
 * Click navigates to that subscription's articles.
 *
 * Requirements: 5.3, 5.4
 */

import { t } from '../../services/i18n.js';
import { navigate } from '../../router.js';
import type { Subscription, Category } from '../../../types/index.js';

export class CategoryGroup {
  private element: HTMLElement;
  private category: Category;
  private subscriptions: Subscription[];
  private collapsed = false;
  private onDelete: (id: string, title: string) => void;

  constructor(
    category: Category,
    subscriptions: Subscription[],
    onDelete: (id: string, title: string) => void
  ) {
    this.category = category;
    this.subscriptions = subscriptions;
    this.onDelete = onDelete;
    this.element = document.createElement('div');
    this.element.className = 'category-group';
    this.render();
  }

  /**
   * Get the rendered DOM element.
   */
  getElement(): HTMLElement {
    return this.element;
  }

  /**
   * Toggle collapse/expand state.
   */
  private toggle(): void {
    this.collapsed = !this.collapsed;
    this.render();
  }

  /**
   * Format a date string to a human-readable relative time.
   */
  private formatLastFetched(dateStr: string | null): string {
    if (!dateStr) return '—';
    try {
      const date = new Date(dateStr);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMin = Math.floor(diffMs / 60000);
      if (diffMin < 1) return 'just now';
      if (diffMin < 60) return `${diffMin}m ago`;
      const diffHrs = Math.floor(diffMin / 60);
      if (diffHrs < 24) return `${diffHrs}h ago`;
      const diffDays = Math.floor(diffHrs / 24);
      return `${diffDays}d ago`;
    } catch {
      return '—';
    }
  }

  /**
   * Render the category group.
   */
  private render(): void {
    this.element.innerHTML = '';

    // Header row: collapsible toggle + category name + count
    const header = document.createElement('div');
    header.className = 'category-group__header';
    header.setAttribute('role', 'button');
    header.setAttribute('aria-expanded', String(!this.collapsed));
    header.setAttribute('tabindex', '0');
    header.style.minHeight = '44px';
    header.style.cursor = 'pointer';
    header.style.display = 'flex';
    header.style.alignItems = 'center';
    header.style.gap = '8px';

    header.addEventListener('click', () => this.toggle());
    header.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.toggle();
      }
    });

    const arrow = document.createElement('span');
    arrow.className = 'category-group__arrow';
    arrow.textContent = this.collapsed ? '▶' : '▼';
    header.appendChild(arrow);

    const name = document.createElement('span');
    name.className = 'category-group__name';
    name.textContent = this.category.name;
    header.appendChild(name);

    const count = document.createElement('span');
    count.className = 'category-group__count';
    count.textContent = `(${this.subscriptions.length})`;
    header.appendChild(count);

    this.element.appendChild(header);

    // Subscription items (hidden when collapsed)
    if (!this.collapsed) {
      const list = document.createElement('ul');
      list.className = 'category-group__list';
      list.setAttribute('role', 'list');

      for (const sub of this.subscriptions) {
        const item = document.createElement('li');
        item.className = 'category-group__item';
        item.style.minHeight = '44px';
        item.style.display = 'flex';
        item.style.alignItems = 'center';
        item.style.justifyContent = 'space-between';

        // Clickable subscription title
        const link = document.createElement('a');
        link.className = 'category-group__link';
        link.href = `#/articles?subscription=${sub.id}`;
        link.setAttribute('aria-label', sub.title);
        link.addEventListener('click', (e) => {
          e.preventDefault();
          navigate(`/articles?subscription=${sub.id}`);
        });

        const titleEl = document.createElement('span');
        titleEl.className = 'category-group__sub-title';
        titleEl.textContent = sub.title;
        link.appendChild(titleEl);

        const fetchedEl = document.createElement('span');
        fetchedEl.className = 'category-group__last-fetched';
        fetchedEl.textContent = this.formatLastFetched(sub.lastFetchedAt);
        link.appendChild(fetchedEl);

        item.appendChild(link);

        // Delete button
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'btn btn--icon btn--danger';
        deleteBtn.textContent = '×';
        deleteBtn.title = t('delete');
        deleteBtn.style.minWidth = '44px';
        deleteBtn.style.minHeight = '44px';
        deleteBtn.setAttribute('aria-label', `${t('delete')} ${sub.title}`);
        deleteBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.onDelete(sub.id, sub.title);
        });
        item.appendChild(deleteBtn);

        list.appendChild(item);
      }

      this.element.appendChild(list);
    }
  }
}
