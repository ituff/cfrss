/**
 * MobileArticleList — Folo-style article list for the mobile single-pane layout.
 *
 * Layout (mirrors the Folo mobile "文章" screen):
 *   ┌ title row: avatar · "文章" · theme toggle · mark-all-read
 *   ├ pill segmented control (primary tab) · circular icon button group
 *   │   (refresh · unread-only filter · all)
 *   └ card feed: unread dot · source favicon + name + relative time
 *                 title (2 lines) + excerpt (2 lines) · right thumbnail
 *
 * All header controls are inline SVG icons (see `../../icons.js`) rather than
 * text glyphs — the previous `◐ ✓ ⟳ 🖼 📅` set rendered at wildly different
 * sizes/weights per platform and read as noise.
 *
 * Keeps the desktop `ArticlePane` untouched; this is the compact mobile
 * presentation of the same `/api/articles` data.
 */

import { navigate } from '../../router.js';
import { getArticles, getSubscriptions, getCategories, refreshFeeds, setTheme } from '../../services/api.js';
import { t, onLanguageChange } from '../../services/i18n.js';
import { applyTheme, getCurrentTheme, THEMES } from '../../services/theme.js';
import {
  iconCheckCheck,
  iconFileText,
  iconList,
  iconMoon,
  iconRefresh,
  iconSun,
  iconUnread,
} from '../../icons.js';
import type { Article, Subscription, Category } from '../../../types/index.js';

const PAGE_SIZE = 20;

interface MobileArticle extends Article {
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

/** Derive a favicon URL for a feed (direct, then Google's cache, then site favicon). */
function faviconFor(feedUrl: string): string {
  if (!feedUrl) return '';
  try {
    const host = new URL(feedUrl).hostname;
    return `https://www.google.com/s2/favicons?domain=${host}&sz=64`;
  } catch {
    return '';
  }
}

export interface MobileArticleListOptions {
  container: HTMLElement;
  /** Feed/category filter, mirroring the desktop pane. */
  feedId?: string | null;
  categoryId?: string | null;
  onSelect?: (articleId: string) => void;
}

export class MobileArticleList {
  private container: HTMLElement;
  private element: HTMLElement;
  private articles: MobileArticle[] = [];
  private feeds: Subscription[] = [];
  private categories: Category[] = [];
  /**
   * Unread-only is the default: an RSS reader is a queue of things you haven't
   * read yet, so opening on "everything" buries the new items among old ones.
   * The "全部" button in the header switches to the full list.
   */
  private unreadOnly = true;
  private loading = false;
  private hasMore = true;
  private offset = 0;
  private feedId: string | null;
  private categoryId: string | null;
  private onSelect?: (articleId: string) => void;
  private unsubLang: (() => void) | null = null;
  private scrollEl: HTMLElement | null = null;
  private listEl: HTMLElement | null = null;
  private titleEl: HTMLElement | null = null;
  private themeBtn: HTMLButtonElement | null = null;
  private unreadBtn: HTMLButtonElement | null = null;
  private allBtn: HTMLButtonElement | null = null;

  constructor(options: MobileArticleListOptions) {
    this.container = options.container;
    this.feedId = options.feedId ?? null;
    this.categoryId = options.categoryId ?? null;
    this.onSelect = options.onSelect;
    this.element = document.createElement('div');
    this.element.className = 'mobile-articles';
    this.container.appendChild(this.element);
    this.unsubLang = onLanguageChange(() => this.render());
  }

  getElement(): HTMLElement {
    return this.element;
  }

  async init(): Promise<void> {
    this.render();
    try {
      const [subs, cats] = await Promise.all([getSubscriptions(), getCategories()]);
      this.feeds = subs;
      this.categories = cats;
    } catch {
      // Metadata is cosmetic — render without it
    }
    this.render();
    await this.loadMore();
  }

  destroy(): void {
    this.unsubLang?.();
    this.unsubLang = null;
    this.scrollEl?.removeEventListener('scroll', this.handleScroll);
    this.element.remove();
  }

  /** Ids of loaded articles, for swipe navigation in the reader. */
  getArticleIds(): string[] {
    return this.articles.map((a) => a.id);
  }

  private feedTitleOf(id: string): string {
    return this.feeds.find((f) => f.id === id)?.title ?? t('articles');
  }

  private feedUrlOf(id: string): string {
    return this.feeds.find((f) => f.id === id)?.url ?? '';
  }

  private headerTitle(): string {
    if (this.feedId) return this.feedTitleOf(this.feedId);
    if (this.categoryId) {
      return this.categories.find((c) => c.id === this.categoryId)?.name ?? t('all_articles');
    }
    return t('articles');
  }

  private async loadMore(): Promise<void> {
    if (this.loading || !this.hasMore) return;
    this.loading = true;

    try {
      const data = await getArticles({
        subscriptionId: this.feedId ?? undefined,
        categoryId: this.categoryId ?? undefined,
        unread: this.unreadOnly || undefined,
        limit: PAGE_SIZE,
        offset: this.offset,
      });
      for (const a of data.articles) {
        this.articles.push({
          ...a,
          excerpt: stripHtml(a.summary || '').slice(0, 140),
          thumbnail: firstImage(a.summary || ''),
          feedTitle: this.feedTitleOf(a.subscriptionId),
          feedUrl: this.feedUrlOf(a.subscriptionId),
        });
      }
      this.offset += data.articles.length;
      this.hasMore = !data.truncated && data.articles.length === PAGE_SIZE;
    } catch {
      // Keep what loaded; the next scroll retries
    } finally {
      this.loading = false;
      this.renderList();
    }
  }

  private handleScroll = (): void => {
    const el = this.scrollEl;
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 120) {
      void this.loadMore();
    }
  };

  private async handleRefresh(): Promise<void> {
    try {
      await refreshFeeds();
    } catch {
      // surfaced by the reload below
    }
    this.articles = [];
    this.offset = 0;
    this.hasMore = true;
    await this.loadMore();
  }

  /** Full render: title row, control row, scroll list. */
  private render(): void {
    this.element.innerHTML = '';

    // ---- Title row ----
    const titleRow = document.createElement('div');
    titleRow.className = 'mobile-articles__titlebar';

    const avatar = document.createElement('div');
    avatar.className = 'mobile-articles__avatar';
    avatar.setAttribute('aria-hidden', 'true');

    this.titleEl = document.createElement('div');
    this.titleEl.className = 'mobile-articles__heading';
    this.titleEl.textContent = this.headerTitle();

    const titleActions = document.createElement('div');
    titleActions.className = 'mobile-articles__title-actions';

    this.themeBtn = this.iconButton(this.themeIcon(), t('theme'), () => this.cycleTheme());
    const selectBtn = this.iconButton(iconCheckCheck(), t('mark_all_read'), () => void this.markAllRead());

    titleActions.appendChild(this.themeBtn);
    titleActions.appendChild(selectBtn);

    titleRow.appendChild(avatar);
    titleRow.appendChild(this.titleEl);
    titleRow.appendChild(titleActions);
    this.element.appendChild(titleRow);

    // ---- Control row: pill tabs + circular buttons ----
    const controls = document.createElement('div');
    controls.className = 'mobile-articles__controls';

    const tab = document.createElement('button');
    tab.className = 'mobile-articles__tab';
    tab.type = 'button';
    tab.innerHTML = `<span class="mobile-articles__tab-icon" aria-hidden="true">${iconFileText(16)}</span><span>${t('articles')}</span><span class="mobile-articles__tab-dot" aria-hidden="true"></span>`;
    controls.appendChild(tab);

    const btnGroup = document.createElement('div');
    btnGroup.className = 'mobile-articles__btn-group';
    btnGroup.appendChild(this.iconButton(iconRefresh(), t('refresh'), () => void this.handleRefresh()));
    // The unread/all pair drives one piece of state; each button selects a
    // side of it (rather than both toggling), so the row always shows which
    // filter is active via aria-pressed.
    this.unreadBtn = this.iconButton(iconUnread(), t('unread_only'), () => this.setUnreadOnly(true));
    this.allBtn = this.iconButton(iconList(), t('all'), () => this.setUnreadOnly(false));
    btnGroup.appendChild(this.unreadBtn);
    btnGroup.appendChild(this.allBtn);
    this.syncFilterButtons();
    controls.appendChild(btnGroup);

    this.element.appendChild(controls);

    // ---- Scroll list ----
    const scroll = document.createElement('div');
    scroll.className = 'mobile-articles__scroll';
    scroll.addEventListener('scroll', this.handleScroll);
    this.scrollEl = scroll;

    this.listEl = document.createElement('div');
    this.listEl.className = 'mobile-articles__list';
    scroll.appendChild(this.listEl);

    this.element.appendChild(scroll);
    this.renderList();
  }

  /** Build a circular icon button from inline SVG markup. */
  private iconButton(markup: string, label: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mobile-articles__icon-btn';
    btn.innerHTML = markup;
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.addEventListener('click', onClick);
    return btn;
  }

  /** Show the filter the user is currently on — colour alone is not enough. */
  private syncFilterButtons(): void {
    this.unreadBtn?.setAttribute('aria-pressed', String(this.unreadOnly));
    this.allBtn?.setAttribute('aria-pressed', String(!this.unreadOnly));
  }

  /** Select the unread-only or all-articles filter and reload from offset 0. */
  private setUnreadOnly(value: boolean): void {
    if (this.unreadOnly === value) return;
    this.unreadOnly = value;
    this.syncFilterButtons();
    this.articles = [];
    this.offset = 0;
    this.hasMore = true;
    void this.loadMore();
  }

  /**
   * Icon for the theme button: it previews the *next* state, so a light theme
   * shows a moon and a dark theme shows a sun.
   */
  private themeIcon(): string {
    const current = getCurrentTheme();
    return current === 'light' || current === 'eink' ? iconMoon() : iconSun();
  }

  private cycleTheme(): void {
    const current = getCurrentTheme();
    const next = THEMES[(THEMES.indexOf(current) + 1) % THEMES.length]!;
    // applyTheme writes both localStorage keys (incl. the `theme_device`
    // first-paint cache) — writing only `theme` caused a theme flash on the
    // next load.
    applyTheme(next);
    if (this.themeBtn) this.themeBtn.innerHTML = this.themeIcon();
    void setTheme(next).catch(() => undefined);
  }

  private async markAllRead(): Promise<void> {
    const unread = this.articles.filter((a) => !a.isRead);
    for (const article of unread) {
      article.isRead = true;
      void fetch(`/api/articles/${article.id}/read`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isRead: true }),
      }).catch(() => undefined);
    }
    this.renderList();
  }

  /** Re-render only the card list (keeps scroll position). */
  private renderList(): void {
    if (!this.listEl) return;
    const scrollTop = this.scrollEl?.scrollTop ?? 0;
    this.listEl.innerHTML = '';

    if (this.articles.length === 0 && !this.loading) {
      const empty = document.createElement('div');
      empty.className = 'mobile-articles__empty';
      // Distinguish "you've read everything" from "this feed has nothing" —
      // otherwise the default unread filter makes a read-up list look broken.
      empty.textContent = this.unreadOnly ? t('no_unread') : t('no_articles');
      this.listEl.appendChild(empty);
    }

    for (const article of this.articles) {
      this.listEl.appendChild(this.renderCard(article));
    }

    if (this.loading) {
      const loading = document.createElement('div');
      loading.className = 'mobile-articles__loading';
      loading.textContent = t('generating');
      this.listEl.appendChild(loading);
    }

    if (this.scrollEl) this.scrollEl.scrollTop = scrollTop;
  }

  private renderCard(article: MobileArticle): HTMLElement {
    const card = document.createElement('article');
    card.className = `mobile-article-card${article.isRead ? ' read' : ''}`;
    card.tabIndex = 0;
    card.setAttribute('role', 'button');

    const textWrap = document.createElement('div');
    textWrap.className = 'mobile-article-card__text';

    // Source line: unread dot · favicon · name · time
    const source = document.createElement('div');
    source.className = 'mobile-article-card__source';

    if (!article.isRead) {
      const dot = document.createElement('span');
      dot.className = 'mobile-article-card__dot';
      dot.setAttribute('aria-label', t('unread'));
      source.appendChild(dot);
    }

    const favicon = faviconFor(article.feedUrl);
    if (favicon) {
      const img = document.createElement('img');
      img.className = 'mobile-article-card__favicon';
      img.src = favicon;
      img.alt = '';
      img.loading = 'lazy';
      img.onerror = () => img.remove();
      source.appendChild(img);
    }

    const feedName = document.createElement('span');
    feedName.className = 'mobile-article-card__feed';
    feedName.textContent = article.feedTitle;
    source.appendChild(feedName);

    const sep = document.createElement('span');
    sep.className = 'mobile-article-card__sep';
    sep.textContent = '·';
    source.appendChild(sep);

    const time = document.createElement('time');
    time.className = 'mobile-article-card__time';
    time.dateTime = article.publishedAt;
    time.textContent = relativeTime(article.publishedAt);
    source.appendChild(time);

    const title = document.createElement('h3');
    title.className = 'mobile-article-card__title';
    title.textContent = article.title;

    const excerpt = document.createElement('p');
    excerpt.className = 'mobile-article-card__excerpt';
    excerpt.textContent = article.excerpt;

    textWrap.appendChild(source);
    textWrap.appendChild(title);
    textWrap.appendChild(excerpt);
    card.appendChild(textWrap);

    if (article.thumbnail) {
      const thumb = document.createElement('img');
      thumb.className = 'mobile-article-card__thumb';
      thumb.src = article.thumbnail;
      thumb.alt = '';
      thumb.loading = 'lazy';
      thumb.onerror = () => {
        thumb.remove();
        card.classList.add('mobile-article-card--no-thumb');
      };
      card.appendChild(thumb);
    } else {
      card.classList.add('mobile-article-card--no-thumb');
    }

    const open = () => this.openArticle(article);
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
   * Open an article.
   *
   * The read state is deliberately NOT set here. Selecting navigates away,
   * which destroys this list, so a local `isRead` write is discarded before it
   * can affect any render — and `ArticleView` already marks the article read
   * once it has actually loaded it. Doing it here as well meant:
   *   - every tap fired PUT /api/articles/:id/read twice, and
   *   - a tap whose article then failed to load still consumed it from the
   *     unread queue, so it vanished without ever being read.
   */
  private openArticle(article: MobileArticle): void {
    if (this.onSelect) {
      this.onSelect(article.id);
    } else {
      navigate(`/articles/${article.id}`);
    }
  }
}
