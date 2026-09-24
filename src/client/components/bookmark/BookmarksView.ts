/**
 * BookmarksView — the 收藏 (bookmarks) page.
 *
 * Lists saved articles newest-saved first, reusing the same card language as
 * the mobile article list so the two pages feel like one product. Cards link
 * into the reader (#/articles/:id) and can be un-bookmarked inline, which
 * removes the row in place — no refetch, and the undo restores it if the
 * request fails.
 *
 * Reachable from the desktop nav rail and the mobile bottom nav.
 */

import { navigate } from '../../router.js';
import { getBookmarks, getSubscriptions, removeBookmark, type BookmarkEntry } from '../../services/api.js';
import { t, onLanguageChange } from '../../services/i18n.js';
import type { Subscription } from '../../../types/index.js';

const PAGE_SIZE = 30;

interface BookmarkCard extends BookmarkEntry {
  excerpt: string;
  thumbnail: string;
  feedTitle: string;
  feedUrl: string;
}

function stripHtml(html: string): string {
  const div = document.createElement('div');
  div.innerHTML = html;
  return (div.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function firstImage(html: string): string {
  const m = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  return m ? m[1] : '';
}

function relativeTime(iso: string): string {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return '';
  const minutes = Math.floor((Date.now() - ts) / 60000);
  if (minutes < 1) return t('time_now');
  if (minutes < 60) return `${minutes} ${t('time_minutes')}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${t('time_hours')}`;
  const days = Math.floor(hours / 24);
  return `${days} ${t('time_days')}`;
}

function faviconFor(feedUrl: string): string {
  if (!feedUrl) return '';
  try {
    const host = new URL(feedUrl).hostname;
    return `https://www.google.com/s2/favicons?domain=${host}&sz=64`;
  } catch {
    return '';
  }
}

export interface BookmarksViewOptions {
  container: HTMLElement;
}

export class BookmarksView {
  private container: HTMLElement;
  private element: HTMLElement;
  private items: BookmarkCard[] = [];
  private feeds: Subscription[] = [];
  private loading = false;
  private loadError = false;
  private scrollEl: HTMLElement | null = null;
  private listEl: HTMLElement | null = null;
  private countEl: HTMLElement | null = null;
  private unsubLang: (() => void) | null = null;

  constructor(options: BookmarksViewOptions) {
    this.container = options.container;
    this.element = document.createElement('div');
    this.element.className = 'bookmarks-view';
    this.container.appendChild(this.element);
    this.unsubLang = onLanguageChange(() => this.render());
  }

  getElement(): HTMLElement {
    return this.element;
  }

  async init(): Promise<void> {
    this.render();

    try {
      this.feeds = await getSubscriptions();
    } catch {
      // Feed names are cosmetic — fall back to the generic label
    }

    await this.load();
  }

  destroy(): void {
    this.unsubLang?.();
    this.unsubLang = null;
    this.scrollEl?.removeEventListener('scroll', this.handleScroll);
    this.element.remove();
  }

  private feedTitleOf(id: string): string {
    return this.feeds.find((f) => f.id === id)?.title ?? t('articles');
  }

  private feedUrlOf(id: string): string {
    return this.feeds.find((f) => f.id === id)?.url ?? '';
  }

  private async load(): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    this.loadError = false;

    try {
      const data = await getBookmarks(PAGE_SIZE, 0);
      this.items = data.bookmarks.map((entry) => ({
        ...entry,
        excerpt: stripHtml(entry.article.summary || '').slice(0, 140),
        thumbnail: firstImage(entry.article.summary || ''),
        feedTitle: this.feedTitleOf(entry.article.subscriptionId),
        feedUrl: this.feedUrlOf(entry.article.subscriptionId),
      }));
    } catch {
      this.loadError = true;
    } finally {
      this.loading = false;
      this.render();
    }
  }

  /** Render the whole view: header, then the sorted card list. */
  private render(): void {
    const scrollTop = this.scrollEl?.scrollTop ?? 0;
    this.element.innerHTML = '';

    // ---- Header ----
    const header = document.createElement('div');
    header.className = 'bookmarks-view__header';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'bookmarks-view__title-wrap';

    const title = document.createElement('h2');
    title.className = 'bookmarks-view__title';
    title.textContent = t('bookmarks');
    titleWrap.appendChild(title);

    this.countEl = document.createElement('span');
    this.countEl.className = 'bookmarks-view__count';
    this.countEl.textContent = String(this.items.length);
    titleWrap.appendChild(this.countEl);

    const refreshBtn = document.createElement('button');
    refreshBtn.type = 'button';
    refreshBtn.className = 'bookmarks-view__refresh';
    refreshBtn.textContent = '⟳';
    refreshBtn.title = t('refresh');
    refreshBtn.setAttribute('aria-label', t('refresh'));
    refreshBtn.addEventListener('click', () => void this.load());

    header.appendChild(titleWrap);
    header.appendChild(refreshBtn);
    this.element.appendChild(header);

    // ---- Scroll list ----
    const scroll = document.createElement('div');
    scroll.className = 'bookmarks-view__scroll';
    scroll.addEventListener('scroll', this.handleScroll);
    this.scrollEl = scroll;

    this.listEl = document.createElement('div');
    this.listEl.className = 'bookmarks-view__list';
    scroll.appendChild(this.listEl);

    this.element.appendChild(scroll);
    this.renderList();

    if (scrollTop) scroll.scrollTop = scrollTop;
  }

  private renderList(): void {
    if (!this.listEl) return;
    this.listEl.innerHTML = '';

    if (this.loading) {
      const loading = document.createElement('div');
      loading.className = 'bookmarks-view__loading';
      loading.textContent = t('loading');
      this.listEl.appendChild(loading);
      return;
    }

    if (this.loadError) {
      const error = document.createElement('div');
      error.className = 'bookmarks-view__error';
      error.setAttribute('role', 'alert');
      error.textContent = t('load_bookmarks_failed');
      this.listEl.appendChild(error);
      return;
    }

    if (this.items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'bookmarks-view__empty';
      empty.innerHTML = `
        <div class="bookmarks-view__empty-icon" aria-hidden="true">${BOOKMARK_GLYPH}</div>
        <p class="bookmarks-view__empty-title">${t('bookmarks_empty')}</p>
        <p class="bookmarks-view__empty-hint">${t('bookmarks_hint')}</p>`;
      this.listEl.appendChild(empty);
      return;
    }

    for (const item of this.items) {
      this.listEl.appendChild(this.renderCard(item));
    }
  }

  private renderCard(item: BookmarkCard): HTMLElement {
    const card = document.createElement('article');
    card.className = 'bookmark-card';
    card.dataset.articleId = item.article.id;
    card.tabIndex = 0;
    card.setAttribute('role', 'button');

    const textWrap = document.createElement('div');
    textWrap.className = 'bookmark-card__text';

    // Source line: favicon · feed name · saved-at
    const source = document.createElement('div');
    source.className = 'bookmark-card__source';

    const favicon = faviconFor(item.feedUrl);
    if (favicon) {
      const img = document.createElement('img');
      img.className = 'bookmark-card__favicon';
      img.src = favicon;
      img.alt = '';
      img.loading = 'lazy';
      img.onerror = () => img.remove();
      source.appendChild(img);
    }

    const feedName = document.createElement('span');
    feedName.className = 'bookmark-card__feed';
    feedName.textContent = item.feedTitle;
    source.appendChild(feedName);

    const sep = document.createElement('span');
    sep.className = 'bookmark-card__sep';
    sep.textContent = '·';
    source.appendChild(sep);

    const savedAt = document.createElement('time');
    savedAt.className = 'bookmark-card__time';
    savedAt.dateTime = item.bookmark.createdAt;
    savedAt.textContent = `${t('bookmarked_at')} ${relativeTime(item.bookmark.createdAt)}`;
    source.appendChild(savedAt);

    const title = document.createElement('h3');
    title.className = 'bookmark-card__title';
    title.textContent = item.article.title;

    const excerpt = document.createElement('p');
    excerpt.className = 'bookmark-card__excerpt';
    excerpt.textContent = item.excerpt;

    textWrap.appendChild(source);
    textWrap.appendChild(title);
    textWrap.appendChild(excerpt);
    card.appendChild(textWrap);

    if (item.thumbnail) {
      const thumb = document.createElement('img');
      thumb.className = 'bookmark-card__thumb';
      thumb.src = item.thumbnail;
      thumb.alt = '';
      thumb.loading = 'lazy';
      thumb.onerror = () => {
        thumb.remove();
        card.classList.add('bookmark-card--no-thumb');
      };
      card.appendChild(thumb);
    } else {
      card.classList.add('bookmark-card--no-thumb');
    }

    // Remove-bookmark control. Sits outside the link area; stops propagation
    // so un-saving never also opens the article.
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'bookmark-card__remove';
    removeBtn.title = t('bookmark_remove');
    removeBtn.setAttribute('aria-label', t('bookmark_remove'));
    removeBtn.innerHTML = BOOKMARK_GLYPH;
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      void this.remove(item, card);
    });
    card.appendChild(removeBtn);

    const open = () => navigate(`/articles/${item.article.id}`);
    card.addEventListener('click', open);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open();
      }
    });

    return card;
  }

  /**
   * Un-bookmark an item. Drops the row immediately and puts it back on
   * failure, so the list never lies about what is saved.
   */
  private async remove(item: BookmarkCard, card: HTMLElement): Promise<void> {
    const index = this.items.indexOf(item);
    if (index === -1) return;

    this.items.splice(index, 1);
    card.remove();
    this.updateCount();

    if (this.items.length === 0) {
      this.renderList();
    }

    try {
      await removeBookmark(item.article.id);
    } catch {
      // Restore the item at its original position
      this.items.splice(Math.min(index, this.items.length), 0, item);
      this.renderList();
      this.updateCount();
      this.showError(t('remove_bookmark_failed'));
    }
  }

  private updateCount(): void {
    if (this.countEl) this.countEl.textContent = String(this.items.length);
  }

  private showError(message: string): void {
    if (!this.element) return;
    let el = this.element.querySelector('.bookmarks-view__toast') as HTMLElement | null;
    if (!el) {
      el = document.createElement('div');
      el.className = 'bookmarks-view__toast';
      el.setAttribute('role', 'alert');
      this.element.appendChild(el);
    }
    el.textContent = message;
    setTimeout(() => el?.remove(), 4000);
  }

  private handleScroll = (): void => {
    // The list is loaded in a single page; scrolling is a no-op today but
    // keeps the hook in place for pagination.
  };
}

/** Bookmark glyph shared by cards, the empty state and the toolbar button. */
const BOOKMARK_GLYPH = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"
  stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"
  aria-hidden="true"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg>`;
