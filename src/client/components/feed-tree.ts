/**
 * FeedTree — Folo-style subscription tree for the desktop sidebar.
 * Collapsible categories with unread counts, feeds with favicons,
 * and an "all articles" root entry. Read-only (management lives in #/subscriptions).
 */

import { getSubscriptions } from '../services/api.js';
import { getCategories } from '../services/api.js';
import { t, onLanguageChange } from '../services/i18n.js';
import type { Subscription, Category } from '../../types/index.js';

export interface FeedTreeSelection {
  /** null = all articles */
  feedId: string | null;
}

function faviconCandidates(feedUrl: string): string[] {
  try {
    const u = new URL(feedUrl);
    // Direct favicon first (Google's s2 service is unreachable in some regions),
    // then the Google fallback.
    return [
      `${u.origin}/favicon.ico`,
      `https://www.google.com/s2/favicons?domain=${u.hostname}&sz=64`,
    ];
  } catch {
    return [];
  }
}

export class FeedTree {
  private element: HTMLElement;
  private feeds: Subscription[] = [];
  private categories: Category[] = [];
  private collapsed: Set<string> = new Set();
  /** null = all articles, 'cat:<id>' = category, feed id = single feed */
  private selection: string | null = null;
  private onSelect: (selection: string | null) => void;
  private unsubscribeLang: (() => void) | null = null;
  private loading = true;

  constructor(container: HTMLElement, selection: string | null, onSelect: (selection: string | null) => void) {
    this.element = document.createElement('nav');
    this.element.className = 'feed-tree';
    this.element.setAttribute('aria-label', 'Feeds');
    this.selection = selection;
    this.onSelect = onSelect;
    this.unsubscribeLang = onLanguageChange(() => this.render());
    container.appendChild(this.element);
    void this.load();
  }

  getElement(): HTMLElement {
    return this.element;
  }

  destroy(): void {
    this.unsubscribeLang?.();
    this.unsubscribeLang = null;
  }

  /** Refresh counts (e.g. after articles are marked read). */
  async reload(): Promise<void> {
    await this.load();
  }

  private async load(): Promise<void> {
    try {
      const [subs, cats] = await Promise.all([getSubscriptions(), getCategories()]);
      this.feeds = subs;
      this.categories = cats;
    } catch {
      // keep previous data on failure
    }
    this.loading = false;
    this.render();
  }

  /** Update the highlighted selection without reloading data. */
  setSelected(selection: string | null): void {
    this.selection = selection;
    this.element.querySelectorAll('.feed-tree__feed').forEach((el) => {
      el.classList.toggle('active', el.getAttribute('data-feed-id') === (selection ?? ''));
    });
    this.element.querySelectorAll('.feed-tree__all').forEach((el) => {
      el.classList.toggle('active', selection === null);
    });
    this.element.querySelectorAll('.feed-tree__category').forEach((el) => {
      el.classList.toggle('active', el.getAttribute('data-cat-id') === (selection ?? ''));
    });
  }

  private unreadFor(feed: Subscription): number {
    return feed.disabled ? 0 : (feed.unreadCount ?? 0);
  }

  private render(): void {
    this.element.innerHTML = '';

    // "All articles" root entry
    const allUnread = this.feeds.reduce((sum, f) => sum + this.unreadFor(f), 0);
    const allItem = document.createElement('div');
    allItem.className = `feed-tree__all${this.selection === null ? ' active' : ''}`;
    allItem.setAttribute('role', 'button');
    allItem.tabIndex = 0;
    allItem.innerHTML = `
      <span class="feed-tree__all-icon">📰</span>
      <span class="feed-tree__all-name">${t('all_articles')}</span>
      <span class="feed-tree__count">${allUnread || ''}</span>`;
    allItem.addEventListener('click', () => this.onSelect(null));
    this.element.appendChild(allItem);

    // Categories in order, feeds grouped under each
    const byCategory = new Map<string, Subscription[]>();
    for (const feed of this.feeds) {
      const list = byCategory.get(feed.categoryId) ?? [];
      list.push(feed);
      byCategory.set(feed.categoryId, list);
    }

    for (const category of this.categories) {
      const feeds = byCategory.get(category.id) ?? [];
      const unread = feeds.reduce((sum, f) => sum + this.unreadFor(f), 0);
      const isCollapsed = this.collapsed.has(category.id);

      const isSelected = this.selection === `cat:${category.id}`;
      const header = document.createElement('div');
      header.className = `feed-tree__category${isSelected ? ' active' : ''}`;
      header.setAttribute('data-cat-id', `cat:${category.id}`);
      header.setAttribute('role', 'button');
      header.tabIndex = 0;
      header.innerHTML = `
        <span class="feed-tree__chevron" role="button" aria-label="collapse">${isCollapsed ? '▸' : '▾'}</span>
        <span class="feed-tree__category-name">${escapeHtml(category.name)}</span>
        <span class="feed-tree__count">${unread || ''}</span>`;
      header.querySelector('.feed-tree__chevron')?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isCollapsed) this.collapsed.delete(category.id);
        else this.collapsed.add(category.id);
        this.render();
      });
      header.addEventListener('click', () => this.onSelect(`cat:${category.id}`));
      this.element.appendChild(header);

      if (!isCollapsed) {
        for (const feed of feeds) {
          const item = document.createElement('div');
          item.className = `feed-tree__feed${this.selection === feed.id ? ' active' : ''}${feed.disabled ? ' disabled' : ''}`;
          item.setAttribute('data-feed-id', feed.id);
          item.setAttribute('role', 'button');
          item.tabIndex = 0;
          item.title = feed.disabled ? t('marked_abnormal') : feed.title;

          const icon = document.createElement('img');
          icon.className = 'feed-tree__favicon';
          icon.alt = '';
          icon.loading = 'lazy';
          const candidates = faviconCandidates(feed.url);
          let candidateIndex = 0;
          if (candidates.length > 0) icon.src = candidates[0];
          icon.onerror = () => {
            candidateIndex++;
            if (candidateIndex < candidates.length) {
              icon.src = candidates[candidateIndex];
            } else {
              icon.style.visibility = 'hidden';
            }
          };

          const name = document.createElement('span');
          name.className = 'feed-tree__feed-name';
          name.textContent = feed.title;

          const count = document.createElement('span');
          count.className = 'feed-tree__count';
          count.textContent = String(this.unreadFor(feed) || '');

          item.appendChild(icon);
          item.appendChild(name);
          item.appendChild(count);

          // Folo-style unread dot at the right edge
          if (this.unreadFor(feed) > 0) {
            const dot = document.createElement('span');
            dot.className = 'feed-tree__dot';
            item.appendChild(dot);
          }

          item.addEventListener('click', () => this.onSelect(feed.id));
          this.element.appendChild(item);
        }
      }
    }

    if (this.loading && this.feeds.length === 0) {
      const loading = document.createElement('div');
      loading.className = 'feed-tree__loading';
      loading.textContent = t('generating');
      this.element.appendChild(loading);
    }
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
