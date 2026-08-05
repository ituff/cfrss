/**
 * ArticleList — scrollable list of articles with infinite scroll and unread indicators.
 * Fetches articles from GET /api/articles, supports optional ?unread=true filter.
 * Integrates pull-to-refresh gesture and marks articles as read on click.
 *
 * Requirements: 14.2, 3.2
 */

import { navigate } from '../../router.js';
import { PullToRefreshDetector } from '../../gestures.js';

export interface ArticleListItem {
  id: string;
  title: string;
  author: string;
  publishedAt: string;
  summary: string;
  isRead: boolean;
}

export interface ArticleListOptions {
  /** Container element to render into */
  container: HTMLElement;
  /** Whether to show only unread articles */
  unreadOnly?: boolean;
}

const PAGE_SIZE = 20;

export class ArticleList {
  private container: HTMLElement;
  private unreadOnly: boolean;
  private articles: ArticleListItem[] = [];
  private loading = false;
  private hasMore = true;
  private offset = 0;
  private listEl: HTMLElement | null = null;
  private pullToRefresh: PullToRefreshDetector | null = null;
  private scrollContainer: HTMLElement | null = null;

  constructor(options: ArticleListOptions) {
    this.container = options.container;
    this.unreadOnly = options.unreadOnly ?? false;
  }

  /**
   * Initialize the article list — render and load first page.
   */
  async init(): Promise<void> {
    this.render();
    await this.loadMore();
  }

  /**
   * Clean up event listeners and gesture detectors.
   */
  destroy(): void {
    this.pullToRefresh?.detach();
    this.pullToRefresh = null;
    if (this.scrollContainer) {
      this.scrollContainer.removeEventListener('scroll', this.handleScroll);
    }
  }

  /**
   * Get all currently loaded article IDs in display order.
   */
  getArticleIds(): string[] {
    return this.articles.map((a) => a.id);
  }

  /**
   * Render the list shell into the container.
   */
  private render(): void {
    this.container.innerHTML = '';

    const wrapper = document.createElement('div');
    wrapper.className = 'article-list-wrapper';

    this.scrollContainer = document.createElement('div');
    this.scrollContainer.className = 'article-list-scroll';
    this.scrollContainer.setAttribute('role', 'feed');
    this.scrollContainer.setAttribute('aria-label', 'Article list');

    this.listEl = document.createElement('ul');
    this.listEl.className = 'article-list';
    this.listEl.setAttribute('role', 'list');

    this.scrollContainer.appendChild(this.listEl);
    wrapper.appendChild(this.scrollContainer);
    this.container.appendChild(wrapper);

    // Infinite scroll
    this.scrollContainer.addEventListener('scroll', this.handleScroll);

    // Pull-to-refresh
    this.pullToRefresh = new PullToRefreshDetector({
      element: this.scrollContainer,
      onRefresh: () => this.refresh(),
    });
    this.pullToRefresh.attach();
  }

  /**
   * Fetch articles from the API.
   */
  private async fetchArticles(offset: number, limit: number): Promise<ArticleListItem[]> {
    const params = new URLSearchParams({
      offset: String(offset),
      limit: String(limit),
    });
    if (this.unreadOnly) {
      params.set('unread', 'true');
    }

    const response = await fetch(`/api/articles?${params.toString()}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch articles: ${response.status}`);
    }

    const data = await response.json() as { articles: ArticleListItem[] };
    return data.articles ?? [];
  }

  /**
   * Load the next page of articles (infinite scroll).
   */
  private async loadMore(): Promise<void> {
    if (this.loading || !this.hasMore) return;

    this.loading = true;
    this.showLoadingIndicator();

    try {
      const newArticles = await this.fetchArticles(this.offset, PAGE_SIZE);

      if (newArticles.length < PAGE_SIZE) {
        this.hasMore = false;
      }

      this.articles.push(...newArticles);
      this.offset += newArticles.length;
      this.renderArticles(newArticles);
    } catch (err) {
      this.showError('Failed to load articles. Please try again.');
    } finally {
      this.loading = false;
      this.hideLoadingIndicator();
    }

    // Show empty state if no articles at all
    if (this.articles.length === 0) {
      this.showEmpty();
    }
  }

  /**
   * Refresh the article list from scratch.
   */
  private async refresh(): Promise<void> {
    this.articles = [];
    this.offset = 0;
    this.hasMore = true;

    if (this.listEl) {
      this.listEl.innerHTML = '';
    }

    await this.loadMore();
  }

  /**
   * Render a batch of new articles into the list.
   */
  private renderArticles(articles: ArticleListItem[]): void {
    if (!this.listEl) return;

    for (const article of articles) {
      const li = document.createElement('li');
      li.className = `article-list-item${article.isRead ? '' : ' unread'}`;
      li.setAttribute('role', 'listitem');
      li.dataset.articleId = article.id;

      const unreadDot = article.isRead
        ? ''
        : '<span class="unread-indicator" aria-label="Unread"></span>';

      const date = this.formatDate(article.publishedAt);

      li.innerHTML = `
        ${unreadDot}
        <div class="article-item-content">
          <h3 class="article-item-title">${this.escapeHtml(article.title)}</h3>
          <div class="article-item-meta">
            <span class="article-item-author">${this.escapeHtml(article.author)}</span>
            <time class="article-item-date" datetime="${article.publishedAt}">${date}</time>
          </div>
        </div>
      `;

      // Min touch target 44x44px enforced via CSS
      li.style.minHeight = '44px';
      li.style.cursor = 'pointer';

      li.addEventListener('click', () => this.handleArticleClick(article));
      this.listEl.appendChild(li);
    }
  }

  /**
   * Handle click on an article — mark as read and navigate.
   */
  private async handleArticleClick(article: ArticleListItem): Promise<void> {
    // Mark as read locally
    if (!article.isRead) {
      article.isRead = true;
      const itemEl = this.listEl?.querySelector(`[data-article-id="${article.id}"]`);
      if (itemEl) {
        itemEl.classList.remove('unread');
        const dot = itemEl.querySelector('.unread-indicator');
        dot?.remove();
      }

      // Mark as read on server (fire-and-forget)
      this.markAsRead(article.id).catch(() => {
        // Silent failure — will sync next time
      });
    }

    // Navigate to article view
    navigate(`/articles/${article.id}`);
  }

  /**
   * Mark an article as read via the API.
   */
  private async markAsRead(articleId: string): Promise<void> {
    await fetch(`/api/articles/${articleId}/read`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isRead: true }),
    });
  }

  /**
   * Handle infinite scroll — load more when near bottom.
   */
  private handleScroll = (): void => {
    if (!this.scrollContainer || this.loading || !this.hasMore) return;

    const { scrollTop, scrollHeight, clientHeight } = this.scrollContainer;
    // Trigger load when within 100px of bottom
    if (scrollHeight - scrollTop - clientHeight < 100) {
      this.loadMore();
    }
  };

  /**
   * Show a loading spinner at the bottom of the list.
   */
  private showLoadingIndicator(): void {
    if (!this.scrollContainer) return;
    let indicator = this.scrollContainer.querySelector('.loading-indicator');
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.className = 'loading-indicator';
      indicator.setAttribute('aria-live', 'polite');
      indicator.textContent = 'Loading...';
      this.scrollContainer.appendChild(indicator);
    }
  }

  /**
   * Hide the loading spinner.
   */
  private hideLoadingIndicator(): void {
    const indicator = this.scrollContainer?.querySelector('.loading-indicator');
    indicator?.remove();
  }

  /**
   * Show empty state when no articles are available.
   */
  private showEmpty(): void {
    if (!this.listEl) return;
    this.listEl.innerHTML = `
      <li class="article-list-empty" role="listitem">
        <p>No articles</p>
      </li>
    `;
  }

  /**
   * Show an error message in the list area.
   */
  private showError(message: string): void {
    if (!this.scrollContainer) return;
    let errorEl = this.scrollContainer.querySelector('.article-list-error');
    if (!errorEl) {
      errorEl = document.createElement('div');
      errorEl.className = 'article-list-error';
      errorEl.setAttribute('role', 'alert');
      this.scrollContainer.appendChild(errorEl);
    }
    errorEl.textContent = message;

    // Auto-hide after 5 seconds
    setTimeout(() => errorEl?.remove(), 5000);
  }

  /**
   * Format a date string for display.
   */
  private formatDate(isoDate: string): string {
    try {
      const date = new Date(isoDate);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffHours = diffMs / (1000 * 60 * 60);

      if (diffHours < 1) {
        const mins = Math.floor(diffMs / (1000 * 60));
        return `${mins}m ago`;
      }
      if (diffHours < 24) {
        return `${Math.floor(diffHours)}h ago`;
      }
      if (diffHours < 24 * 7) {
        return `${Math.floor(diffHours / 24)}d ago`;
      }
      return date.toLocaleDateString();
    } catch {
      return isoDate;
    }
  }

  /**
   * Escape HTML to prevent XSS in rendered content.
   */
  private escapeHtml(str: string): string {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
}
