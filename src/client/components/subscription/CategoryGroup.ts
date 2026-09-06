/**
 * CategoryGroup — A collapsible category section in the subscription list.
 * Shows category name with subscription count, lists subscriptions within.
 * Supports full management: rename/delete the category, move/delete feeds,
 * and re-enable feeds marked abnormal.
 *
 * Requirements: 5.3, 5.4, 5.8
 */

import { t } from '../../services/i18n.js';
import type { Subscription, Category } from '../../../types/index.js';

export interface CategoryGroupCallbacks {
  onDelete: (id: string, title: string) => void;
  onEdit: (feed: Subscription) => void;
  onRenameCategory: (id: string, currentName: string) => void;
  onDeleteCategory: (id: string, name: string) => void;
  onMove: (feedId: string, toCategoryId: string) => void;
  onEnable: (feedId: string) => void;
}

export class CategoryGroup {
  private element: HTMLElement;
  private category: Category;
  private subscriptions: Subscription[];
  private categories: Category[];
  private collapsed = false;
  private cb: CategoryGroupCallbacks;

  constructor(
    category: Category,
    subscriptions: Subscription[],
    categories: Category[],
    cb: CategoryGroupCallbacks
  ) {
    this.category = category;
    this.subscriptions = subscriptions;
    this.categories = categories;
    this.cb = cb;
    this.element = document.createElement('div');
    this.element.className = 'category-group';
    this.render();
  }

  getElement(): HTMLElement {
    return this.element;
  }

  private toggle(): void {
    this.collapsed = !this.collapsed;
    this.render();
  }

  private formatLastFetched(dateStr: string | null): string {
    if (!dateStr) return '—';
    try {
      const date = new Date(dateStr);
      const diffMs = Date.now() - date.getTime();
      const diffMin = Math.floor(diffMs / 60000);
      if (diffMin < 1) return 'just now';
      if (diffMin < 60) return `${diffMin}m ago`;
      const diffHrs = Math.floor(diffMin / 60);
      if (diffHrs < 24) return `${diffHrs}h ago`;
      return `${Math.floor(diffHrs / 24)}d ago`;
    } catch {
      return '—';
    }
  }

  private render(): void {
    this.element.innerHTML = '';

    // Category header: toggle + name + count + management actions
    const header = document.createElement('div');
    header.className = 'category-group__header';

    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'category-group__toggle';
    toggleBtn.textContent = this.collapsed ? '▸' : '▾';
    toggleBtn.setAttribute('aria-label', t('subscriptions'));
    toggleBtn.addEventListener('click', () => this.toggle());
    header.appendChild(toggleBtn);

    const name = document.createElement('span');
    name.className = 'category-group__name';
    name.textContent = this.category.name;
    name.addEventListener('click', () => this.toggle());
    header.appendChild(name);

    const count = document.createElement('span');
    count.className = 'category-group__count';
    count.textContent = `(${this.subscriptions.length})`;
    header.appendChild(count);

    // Management actions (default category cannot be renamed/deleted)
    if (this.category.id !== 'default') {
      const renameBtn = document.createElement('button');
      renameBtn.className = 'category-group__action';
      renameBtn.textContent = '✏️';
      renameBtn.title = t('rename_category');
      renameBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.cb.onRenameCategory(this.category.id, this.category.name);
      });
      header.appendChild(renameBtn);

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'category-group__action';
      deleteBtn.textContent = '🗑';
      deleteBtn.title = t('delete_category');
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.cb.onDeleteCategory(this.category.id, this.category.name);
      });
      header.appendChild(deleteBtn);
    }

    this.element.appendChild(header);

    if (this.collapsed) return;

    // Feeds
    const list = document.createElement('ul');
    list.className = 'category-group__list';
    list.setAttribute('role', 'list');

    if (this.subscriptions.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'category-group__empty';
      empty.textContent = t('no_subscriptions');
      list.appendChild(empty);
    }

    for (const sub of this.subscriptions) {
      const item = document.createElement('li');
      item.className = 'category-group__item';

      const link = document.createElement('div');
      link.className = 'category-group__link';

      const titleEl = document.createElement('span');
      titleEl.className = 'category-group__sub-title';
      titleEl.textContent = sub.disabled ? `${sub.title} ⚠` : sub.title;
      if (sub.disabled) {
        titleEl.title = t('marked_abnormal');
        titleEl.style.opacity = '0.6';
      }
      link.appendChild(titleEl);

      const meta = document.createElement('span');
      meta.className = 'category-group__last-fetched';
      meta.textContent = this.formatLastFetched(sub.lastFetchedAt);
      link.appendChild(meta);

      // Move-to-category select
      const moveSelect = document.createElement('select');
      moveSelect.className = 'category-group__move';
      moveSelect.title = t('move_to_category');
      for (const cat of this.categories) {
        const opt = document.createElement('option');
        opt.value = cat.id;
        opt.textContent = cat.name;
        if (cat.id === sub.categoryId) opt.selected = true;
        moveSelect.appendChild(opt);
      }
      moveSelect.addEventListener('click', (e) => e.stopPropagation());
      moveSelect.addEventListener('change', () => {
        if (moveSelect.value && moveSelect.value !== sub.categoryId) {
          this.cb.onMove(sub.id, moveSelect.value);
        }
      });
      link.appendChild(moveSelect);

      // Edit button: change title / RSS URL
      const editBtn = document.createElement('button');
      editBtn.className = 'category-group__action';
      editBtn.textContent = '✏️';
      editBtn.title = t('edit_subscription');
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.cb.onEdit(sub);
      });
      link.appendChild(editBtn);

      // Re-enable button for abnormal feeds
      if (sub.disabled) {
        const enableBtn = document.createElement('button');
        enableBtn.className = 'category-group__action';
        enableBtn.textContent = '🔄';
        enableBtn.title = t('enable');
        enableBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.cb.onEnable(sub.id);
        });
        link.appendChild(enableBtn);
      }

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
        this.cb.onDelete(sub.id, sub.title);
      });
      item.appendChild(deleteBtn);

      list.appendChild(item);
    }

    this.element.appendChild(list);
  }
}
