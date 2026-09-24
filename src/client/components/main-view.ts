/**
 * MainView — the Folo-style desktop main view: subscription tree,
 * article preview list, and reading pane side by side.
 * Stays mounted across home/articles/article-detail routes; only the
 * selection and the reader react to route changes.
 *
 * Filter state lives in the route query (?subscription= / ?category=) so it
 * survives opening an article (article-detail keeps the query).
 */

import { navigate, type Route } from '../router.js';
import { ArticlePane } from './article-pane.js';
import { FeedTree } from './feed-tree.js';
import { ArticleView } from './article/ArticleView.js';
import { t } from '../services/i18n.js';
import type { Subscription, Category } from '../../types/index.js';

const MAIN_ROUTES = new Set(['home', 'articles', 'article-detail']);

export function isMainRoute(path: string): boolean {
  return MAIN_ROUTES.has(path);
}

interface PaneFilter {
  feedId: string | null;
  categoryId: string | null;
}

/** Extract the filter from route query params. */
function filterFromRoute(route: Route): PaneFilter {
  return {
    feedId: route.query.subscription ?? null,
    categoryId: route.query.category ?? null,
  };
}

/** Build the query string preserving the filter for detail URLs. */
function filterQuery(filter: PaneFilter): string {
  if (filter.feedId) return `?subscription=${filter.feedId}`;
  if (filter.categoryId) return `?category=${filter.categoryId}`;
  return '';
}

export class MainView {
  private element: HTMLElement;
  private route: Route;
  private tree: FeedTree | null = null;
  private pane: ArticlePane | null = null;
  private readerContainer: HTMLElement | null = null;
  private reader: ArticleView | null = null;
  private feeds: Subscription[] = [];
  private categories: Category[] = [];
  private generation = 0;
  private currentFilter: PaneFilter = { feedId: null, categoryId: null };

  constructor(container: HTMLElement, route: Route) {
    this.element = document.createElement('div');
    this.element.className = 'main-view';
    container.appendChild(this.element);
    this.route = route;
    void this.init();
  }

  private async init(): Promise<void> {
    const gen = ++this.generation;

    // Tree column
    const treeHost = document.createElement('div');
    treeHost.className = 'main-view__tree';
    this.element.appendChild(treeHost);

    // List column
    const paneHost = document.createElement('div');
    paneHost.className = 'main-view__list';
    this.element.appendChild(paneHost);

    // Reader column
    this.readerContainer = document.createElement('div');
    this.readerContainer.className = 'main-view__reader';
    this.element.appendChild(this.readerContainer);

    this.currentFilter = filterFromRoute(this.route);
    this.tree = new FeedTree(treeHost, this.treeSelectionFromFilter(this.currentFilter), (selection) => {
      // Tree selection is the single source of truth: reflect it into the route
      if (selection === null) {
        navigate('/articles');
      } else if (selection.startsWith('cat:')) {
        navigate(`/articles?category=${selection.slice(4)}`);
      } else {
        navigate(`/articles?subscription=${selection}`);
      }
    });

    // Feed/category metadata for card headers
    try {
      const { getSubscriptions, getCategories } = await import('../services/api.js');
      const [subs, cats] = await Promise.all([getSubscriptions(), getCategories()]);
      this.feeds = subs;
      this.categories = cats;
    } catch {
      this.feeds = [];
      this.categories = [];
    }
    if (gen !== this.generation) return;

    this.pane = new ArticlePane(paneHost, this.currentFilter, {
      onSelect: (id) => navigate(`/articles/${id}${filterQuery(this.currentFilter)}`),
      feedTitleOf: (subscriptionId) =>
        this.feeds.find((f) => f.id === subscriptionId)?.title ?? t('articles'),
      feedUrlOf: (subscriptionId) =>
        this.feeds.find((f) => f.id === subscriptionId)?.url ?? '',
      categoryTitleOf: (categoryId) =>
        this.categories.find((c) => c.id === categoryId)?.name ?? t('all_articles'),
    });

    this.syncFromRoute();
  }

  /** Map a filter to the tree's selection string ('cat:<id>' / feed id / null). */
  private treeSelectionFromFilter(filter: PaneFilter): string | null {
    if (filter.feedId) return filter.feedId;
    if (filter.categoryId) return `cat:${filter.categoryId}`;
    return null;
  }

  update(route: Route): void {
    this.route = route;
    this.syncFromRoute();
  }

  destroy(): void {
    this.generation++;
    this.tree?.destroy();
    this.tree = null;
    this.pane?.destroy();
    this.pane = null;
    this.reader?.destroy();
    this.reader = null;
    this.element.innerHTML = '';
  }

  /**
   * React to a route change: sync feed/category filter from query params and
   * load the selected article into the reader pane.
   */
  private syncFromRoute(): void {
    const filter = filterFromRoute(this.route);
    if (filter.feedId !== this.currentFilter.feedId || filter.categoryId !== this.currentFilter.categoryId) {
      this.currentFilter = filter;
      this.tree?.setSelected(this.treeSelectionFromFilter(filter));
      this.pane?.setFilter(filter);
    }

    if (this.route.path === 'article-detail' && this.route.params.id) {
      this.pane?.setSelected(this.route.params.id);
      this.loadReader(this.route.params.id);
    } else {
      // Non-detail route: clear the reader
      if (this.reader) {
        this.reader.destroy();
        this.reader = null;
      }
      this.readerContainer?.querySelectorAll('.article-reader').forEach((el) => el.remove());
      this.pane?.setSelected(null);
      this.renderReaderPlaceholder();
    }
  }

  private placeholderRendered = false;

  private renderReaderPlaceholder(): void {
    if (!this.readerContainer || this.placeholderRendered) return;
    const existing = this.readerContainer.querySelector('.main-view__reader-empty');
    if (existing) return;
    const empty = document.createElement('div');
    empty.className = 'main-view__reader-empty';
    empty.textContent = t('select_article_hint');
    this.readerContainer.appendChild(empty);
    this.placeholderRendered = true;
  }

  private loadReader(articleId: string): void {
    if (!this.readerContainer) return;
    this.placeholderRendered = false;
    this.readerContainer.querySelector('.main-view__reader-empty')?.remove();
    this.reader?.destroy();
    this.readerContainer.innerHTML = '';

    const host = document.createElement('div');
    host.className = 'route-view';
    this.readerContainer.appendChild(host);

    const feedIds = () => this.pane?.getArticleIds() ?? [];
    this.reader = new ArticleView({
      container: host,
      articleId,
      getArticleIds: feedIds,
    });
    void this.reader.init();

    // Marking read changes unread counts — refresh the tree shortly after
    setTimeout(() => {
      this.pane?.markRead(articleId);
      void this.tree?.reload();
    }, 1500);
  }
}
