/**
 * CategoryGroup — A collapsible category section in the subscription list.
 * Shows category name with subscription count, lists subscriptions within.
 * Supports full management: rename/delete the category, move/delete feeds,
 * edit a feed's title + URL inline, and re-enable feeds marked abnormal.
 *
 * All row actions are inline SVG icons (see `../../icons.js`) rather than
 * emoji / text glyphs — emoji render at inconsistent sizes and weights across
 * platforms, and the previous `✏️ 🗑 🔄 ×` set was ambiguous at a glance.
 *
 * Requirements: 5.3, 5.4, 5.8
 */

import { t } from '../../services/i18n.js';
import {
  iconAlert,
  iconChevron,
  iconClose,
  iconPencil,
  iconRotateCw,
  iconTrash,
} from '../../icons.js';
import type { Subscription, Category } from '../../../types/index.js';

export interface CategoryGroupCallbacks {
  onDelete: (id: string, title: string) => void;
  onEdit: (id: string, updates: { title?: string; url?: string }) => Promise<void> | void;
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
  /** Id of the subscription currently open in the inline editor, if any. */
  private editingId: string | null = null;
  /** Draft values for the inline editor. */
  private editTitle = '';
  private editUrl = '';
  private editError: string | null = null;
  private editSaving = false;

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
      if (diffMin < 1) return t('time_now');
      if (diffMin < 60) return `${diffMin} ${t('time_minutes')}`;
      const diffHrs = Math.floor(diffMin / 60);
      if (diffHrs < 24) return `${diffHrs} ${t('time_hours')}`;
      return `${Math.floor(diffHrs / 24)} ${t('time_days')}`;
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
    toggleBtn.type = 'button';
    toggleBtn.className = `category-group__toggle${this.collapsed ? '' : ' category-group__toggle--open'}`;
    // Fixed-direction chevron; the `--open` class rotates it 90°. Swapping the
    // ▸/▾ glyphs instead would reflow the header, since the two have different
    // advance widths.
    toggleBtn.innerHTML = iconChevron();
    toggleBtn.setAttribute('aria-label', this.collapsed ? t('expand') : t('collapse'));
    toggleBtn.setAttribute('aria-expanded', String(!this.collapsed));
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
      renameBtn.type = 'button';
      renameBtn.className = 'category-group__action';
      renameBtn.innerHTML = iconPencil();
      renameBtn.title = t('rename_category');
      renameBtn.setAttribute('aria-label', `${t('rename_category')} ${this.category.name}`);
      renameBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.cb.onRenameCategory(this.category.id, this.category.name);
      });
      header.appendChild(renameBtn);

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'category-group__action category-group__action--danger';
      deleteBtn.innerHTML = iconTrash();
      deleteBtn.title = t('delete_category');
      deleteBtn.setAttribute('aria-label', `${t('delete_category')} ${this.category.name}`);
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

      // Open in the inline editor instead of the compact row.
      if (this.editingId === sub.id) {
        item.className = 'category-group__item category-group__item--editing';
        item.appendChild(this.renderEditor(sub));
        list.appendChild(item);
        continue;
      }

      const link = document.createElement('div');
      link.className = 'category-group__link';

      const titleEl = document.createElement('span');
      titleEl.className = 'category-group__sub-title';
      titleEl.textContent = sub.title;
      if (sub.disabled) {
        // Separate node (not a `⚠` appended to the title text) so the marker
        // can carry its own colour and accessible name.
        const warn = document.createElement('span');
        warn.className = 'category-group__alert';
        warn.innerHTML = iconAlert(14);
        warn.title = t('marked_abnormal');
        warn.setAttribute('aria-label', t('marked_abnormal'));
        titleEl.appendChild(warn);
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

      // Edit button: opens the inline title + URL editor
      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'category-group__action';
      editBtn.innerHTML = iconPencil();
      editBtn.title = t('edit_subscription');
      editBtn.setAttribute('aria-label', `${t('edit_subscription')} ${sub.title}`);
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.openEditor(sub);
      });
      link.appendChild(editBtn);

      // Re-enable button for abnormal feeds
      if (sub.disabled) {
        const enableBtn = document.createElement('button');
        enableBtn.type = 'button';
        enableBtn.className = 'category-group__action';
        enableBtn.innerHTML = iconRotateCw();
        enableBtn.title = t('enable');
        enableBtn.setAttribute('aria-label', `${t('enable')} ${sub.title}`);
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
      deleteBtn.type = 'button';
      deleteBtn.innerHTML = iconClose();
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

  // === Inline subscription editor =====================================

  /** Open the inline editor for a feed, seeding the draft from its current values. */
  private openEditor(sub: Subscription): void {
    this.editingId = sub.id;
    this.editTitle = sub.title;
    this.editUrl = sub.url;
    this.editError = null;
    this.editSaving = false;
    this.render();
  }

  /** Close the editor without saving. */
  private closeEditor(): void {
    this.editingId = null;
    this.editError = null;
    this.editSaving = false;
    this.render();
  }

  /**
   * Validate the draft and hand it to the owner.
   *
   * Both fields stay editable at all times — the previous implementation asked
   * for the title first and returned early when that prompt was cancelled, which
   * made the URL effectively unreachable.
   */
  private async commitEditor(sub: Subscription): Promise<void> {
    const title = this.editTitle.trim();
    const url = this.editUrl.trim();

    if (!title) {
      this.editError = t('field_subscription_title') + ' — ' + t('error_title_required');
      this.render();
      return;
    }
    if (!url) {
      this.editError = t('field_feed_url') + ' — ' + t('error_url_required');
      this.render();
      return;
    }
    if (!/^https?:\/\//i.test(url)) {
      this.editError = t('error_url_protocol');
      this.render();
      return;
    }

    const updates: { title?: string; url?: string } = {};
    if (title !== sub.title) updates.title = title;
    if (url !== sub.url) updates.url = url;

    if (Object.keys(updates).length === 0) {
      this.closeEditor();
      return;
    }

    this.editSaving = true;
    this.editError = null;
    this.render();

    try {
      await this.cb.onEdit(sub.id, updates);
      this.editingId = null;
      this.editSaving = false;
      this.render();
    } catch (err) {
      this.editSaving = false;
      this.editError = err instanceof Error ? err.message : t('network_error');
      this.render();
    }
  }

  /**
   * Build the inline edit form: title + RSS URL side by side, with save/cancel.
   */
  private renderEditor(sub: Subscription): HTMLElement {
    const form = document.createElement('form');
    form.className = 'category-group__editor';
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      void this.commitEditor(sub);
    });
    // Keep clicks inside the editor from toggling the category.
    form.addEventListener('click', (e) => e.stopPropagation());

    const field = (
      id: string,
      labelText: string,
      value: string,
      type: string,
      placeholder: string,
      onInput: (v: string) => void
    ): HTMLElement => {
      const wrap = document.createElement('div');
      wrap.className = 'category-group__editor-field';

      const label = document.createElement('label');
      label.className = 'category-group__editor-label';
      label.textContent = labelText;
      label.setAttribute('for', id);
      wrap.appendChild(label);

      const input = document.createElement('input');
      input.className = 'category-group__editor-input';
      input.type = type;
      input.id = id;
      input.value = value;
      input.placeholder = placeholder;
      input.maxLength = type === 'url' ? 2048 : 200;
      input.disabled = this.editSaving;
      input.addEventListener('input', () => onInput(input.value));
      wrap.appendChild(input);

      return wrap;
    };

    form.appendChild(
      field(
        `edit-title-${sub.id}`,
        t('field_subscription_title'),
        this.editTitle,
        'text',
        t('field_subscription_title'),
        (v) => { this.editTitle = v; }
      )
    );

    form.appendChild(
      field(
        `edit-url-${sub.id}`,
        t('field_feed_url'),
        this.editUrl,
        'url',
        'https://example.com/feed.xml',
        (v) => { this.editUrl = v; }
      )
    );

    const actions = document.createElement('div');
    actions.className = 'category-group__editor-actions';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn btn--primary category-group__editor-save';
    saveBtn.type = 'submit';
    saveBtn.disabled = this.editSaving;
    saveBtn.textContent = this.editSaving ? t('generating') : t('save');
    actions.appendChild(saveBtn);

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn btn--secondary category-group__editor-cancel';
    cancelBtn.type = 'button';
    cancelBtn.disabled = this.editSaving;
    cancelBtn.textContent = t('cancel');
    cancelBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeEditor();
    });
    actions.appendChild(cancelBtn);

    form.appendChild(actions);

    if (this.editError) {
      const err = document.createElement('div');
      err.className = 'category-group__editor-error';
      err.setAttribute('role', 'alert');
      err.textContent = this.editError;
      form.appendChild(err);
    }

    return form;
  }
}
