/**
 * ArticlePane — Folo-style article preview list (middle column).
 * Cards show feed favicon, feed title, relative time, article title,
 * a plain-text excerpt and a thumbnail extracted from the summary HTML.
 * Supports infinite scroll, unread-only toggle and per-feed filtering.
 */

import { getArticles, refreshFeeds } from '../services/api.js';
import { t, onLanguageChange } from '../services/i18n.js';
import type { Article } from '../../types/index.js';

const PAGE_SIZE = 20;

export interface ArticlePaneOptions {
  onSelect: (articleId: string) => void;
  /** feed title lookup for card headers */
  feedTitleOf: (subscriptionId: string) => string;
  feedUrlOf: (subscriptionId: string) => string;
}

interface PaneArticle extends Article {
  excerpt: string;
  thumbnail: string;
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
  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return t('time_now');
  if (minutes < 60) return `${minutes} ${t('time_minutes')}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${t('time_hours')}`;
  const days = Math.floor(hours / 24);
  return `${days} ${t('time_days')}`;
}

export class ArticlePane {
  private element: HTMLElement;
  private articles: PaneArticle[] = [];
  private loading = false;
  private hasMore = true;
  private offset = 0;
  private feedId: string | null = null;
  private unreadOnly = false;
  private selectedId: string | null = null;
  private options: ArticlePaneOptions;
  private unsubscribeLang: (() => void) | null = null;
  private listEl: HTMLElement | null = null;
  private headerTitleEl: HTMLElement | null = null;
  private scrollEl: HTMLElement | null = null;
  private refreshing = false;

  constructor(container: HTMLElement, feedId: string | null, options: ArticlePaneOptions) {
    this.element = document.createElement('section');
    this.element.className = 'article-pane';
    this.feedId = feedId;
    this.options = options;
    this.unsubscribeLang = onLanguageChange(() => this.render());
    container.appendChild(this.element);
    void this.reload();
  }

  getElement(): HTMLElement {
    return this.element;
  }

  destroy(): void {
    this.unsubscribeLang?.();
    this.unsubscribeLang = null;
    this.scrollEl?.removeEventListener('scroll', this.handleScroll);
  }

  getArticleIds(): string[] {
    return this.articles.map((a) => a.id);
  }

  /** Update a card's read state locally (no refetch). */
  markRead(articleId: string): void {
    const article = this.articles.find((a) => a.id === articleId);
    if (article && !article.isRead) {
      article.isRead = true;
      this.element
        .querySelector(`.article-pane__card[data-id="${articleId}"]`)
        ?.classList.add('read');
    }
  }

  /** Change the feed filter and reload. */
  setFeed(feedId: string | null): void {
    if (feedId === this.feedId) return;
    this.feedId = feedId;
    void this.reload();
  }

  /** Highlight the article open in the reader. */
  setSelected(articleId: string | null): void {
    this.selectedId = articleId;
    this.element.querySelectorAll('.article-pane__card').forEach((el) => {
      el.classList.toggle('active', el.getAttribute('data-id') === articleId);
    });
    if (articleId) {
      this.element.querySelector(`.article-pane__card[data-id="${articleId}"]`)?.scrollIntoView({ block: 'nearest' });
    }
  }

  async reload(): Promise<void> {
    this.articles = [];
    this.offset = 0;
    this.hasMore = true;
    this.render();
    await this.loadMore();
  }

  private async loadMore(): Promise<void> {
    if (this.loading || !this.hasMore) return;
    this.loading = true;

    try {
      const data = await getArticles({
        subscriptionId: this.feedId ?? undefined,
        unread: this.unreadOnly || undefined,
        limit: PAGE_SIZE,
        offset: this.offset,
      });
      for (const a of data.articles) {
        this.articles.push({
          ...a,
          excerpt: stripHtml(a.summary || '').slice(0, 120),
          thumbnail: firstImage(a.summary || ''),
        });
      }
      this.offset += data.articles.length;
      this.hasMore = !data.truncated && data.articles.length === PAGE_SIZE;
    } catch {
      // keep whatever loaded; next scroll retries
    } finally {
      this.loading = false;
      this.render();
    }
  }

  private handleScroll = (): void => {
    const el = this.scrollEl;
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 80) {
      void this.loadMore();
    }
  };

  private async handleRefresh(): Promise<void> {
    if (this.refreshing) return;
    this.refreshing = true;
    this.setHeaderRefreshing(true);
    try {
      await refreshFeeds();
    } catch {
      // refresh errors surfaced via list reload failure
    }
    this.refreshing = false;
    this.setHeaderRefreshing(false);
    await this.reload();
  }

  private setHeaderRefreshing(on: boolean): void {
    const btn = this.element.querySelector('.article-pane__refresh') as HTMLElement | null;
    if (btn) {
      btn.classList.toggle('spinning', on);
      btn.setAttribute('aria-busy', String(on));
    }
  }

  private render(): void {
    // Preserve scroll position across re-render
    const scrollTop = this.scrollEl?.scrollTop ?? 0;

    this.element.innerHTML = '';

    // Header
    const header = document.createElement('div');
    header.className = 'article-pane__header';

    this.headerTitleEl = document.createElement('div');
    this.headerTitleEl.className = 'article-pane__title';
    this.headerTitleEl.textContent = this.feedId
      ? (this.options.feedTitleOf(this.feedId) || t('articles'))
      : t('all_articles');

    const actions = document.createElement('div');
    actions.className = 'article-pane__actions';

    const unreadBtn = document.createElement('button');
    unreadBtn.className = `article-pane__seg-btn${this.unreadOnly ? ' active' : ''}`;
    unreadBtn.textContent = t('unread');
    unreadBtn.title = t('unread_only');
    unreadBtn.addEventListener('click', () => {
      if (!this.unreadOnly) {
        this.unreadOnly = true;
        void this.reload();
      }
    });

    const allBtn = document.createElement('button');
    allBtn.className = `article-pane__seg-btn${this.unreadOnly ? '' : ' active'}`;
    allBtn.textContent = t('all');
    allBtn.title = t('all');
    allBtn.addEventListener('click', () => {
      if (this.unreadOnly) {
        this.unreadOnly = false;
        void this.reload();
      }
    });

    // Segmented unread/all filter
    const seg = document.createElement('div');
    seg.className = 'article-pane__seg';
    seg.setAttribute('role', 'tablist');
    seg.appendChild(unreadBtn);
    seg.appendChild(allBtn);

    const refreshBtn = document.createElement('button');
    refreshBtn.className = 'article-pane__action article-pane__refresh';
    refreshBtn.textContent = '⟳';
    refreshBtn.title = t('refresh');
    refreshBtn.addEventListener('click', () => void this.handleRefresh());

    actions.appendChild(seg);
    actions.appendChild(refreshBtn);
    header.appendChild(this.headerTitleEl);
    header.appendChild(actions);
    this.element.appendChild(header);

    // Scrollable card list
    this.scrollEl = document.createElement('div');
    this.scrollEl.className = 'article-pane__scroll';
    this.scrollEl.addEventListener('scroll', this.handleScroll);

    if (this.articles.length === 0 && !this.loading) {
      const empty = document.createElement('div');
      empty.className = 'article-pane__empty';
      empty.textContent = t('no_articles');
      this.scrollEl.appendChild(empty);
    }

    for (const article of this.articles) {
      this.scrollEl.appendChild(this.renderCard(article));
    }

    if (this.loading) {
      const loading = document.createElement('div');
      loading.className = 'article-pane__loading';
      loading.textContent = t('generating');
      this.scrollEl.appendChild(loading);
    }

    this.element.appendChild(this.scrollEl);
    this.scrollEl.scrollTop = scrollTop;
  }

  private renderCard(article: PaneArticle): HTMLElement {
    const card = document.createElement('article');
    card.className = `article-pane__card${article.id === this.selectedId ? ' active' : ''}${article.isRead ? ' read' : ''}`;
    card.setAttribute('data-id', article.id);
    card.tabIndex = 0;
    card.setAttribute('role', 'button');

    const textWrap = document.createElement('div');
    textWrap.className = 'article-pane__card-text';

    const meta = document.createElement('div');
    meta.className = 'article-pane__card-meta';
    meta.textContent = `${this.options.feedTitleOf(article.subscriptionId)} · ${relativeTime(article.publishedAt)}`;

    const title = document.createElement('div');
    title.className = 'article-pane__card-title';
    title.textContent = article.title;

    const excerpt = document.createElement('div');
    excerpt.className = 'article-pane__card-excerpt';
    excerpt.textContent = article.excerpt;

    textWrap.appendChild(meta);
    textWrap.appendChild(title);
    textWrap.appendChild(excerpt);
    card.appendChild(textWrap);

    if (article.thumbnail) {
      const img = document.createElement('img');
      img.className = 'article-pane__card-thumb';
      img.src = article.thumbnail;
      img.alt = '';
      img.loading = 'lazy';
      img.onerror = () => img.remove();
      card.appendChild(img);
    }

    card.addEventListener('click', () => this.options.onSelect(article.id));
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.options.onSelect(article.id);
    });

    return card;
  }
}
