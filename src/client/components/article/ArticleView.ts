/**
 * ArticleView — full article reading view.
 * Fetches a single article from GET /api/articles/:id and renders its content.
 * Provides action buttons for Summarize, Translate, and Read Aloud.
 * Integrates swipe gestures for next/prev article navigation.
 * Marks the article as read when opened.
 *
 * Requirements: 14.2, 3.2
 */

import { navigate } from '../../router.js';
import { ArticleSwipeNavigator } from '../../gestures.js';
import { getCurrentArticleId, setCurrentArticleId } from '../../state.js';

export interface ArticleDetail {
  id: string;
  title: string;
  author: string;
  publishedAt: string;
  htmlContent: string;
  sourceUrl: string;
}

export interface ArticleViewOptions {
  /** Container element to render into */
  container: HTMLElement;
  /** The article ID to display */
  articleId: string;
  /** Function to get all article IDs in order (for swipe navigation) */
  getArticleIds?: () => string[];
}

export class ArticleView {
  private container: HTMLElement;
  private articleId: string;
  private article: ArticleDetail | null = null;
  private swipeNavigator: ArticleSwipeNavigator | null = null;
  private getArticleIds: () => string[];
  private boundaryMsgTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(options: ArticleViewOptions) {
    this.container = options.container;
    this.articleId = options.articleId;
    this.getArticleIds = options.getArticleIds ?? (() => []);
  }

  /**
   * Initialize the article view — fetch and render the article, mark as read.
   */
  async init(): Promise<void> {
    this.renderLoading();

    try {
      this.article = await this.fetchArticle(this.articleId);
      this.renderArticle();
      this.setupSwipeNavigation();

      // Mark as read
      setCurrentArticleId(this.articleId);
      this.markAsRead(this.articleId).catch(() => {
        // Silent failure
      });
    } catch (err) {
      this.renderError('Failed to load article. Please try again.');
    }
  }

  /**
   * Clean up event listeners and gesture detectors.
   */
  destroy(): void {
    this.swipeNavigator?.detach();
    this.swipeNavigator = null;
    if (this.boundaryMsgTimeout) {
      clearTimeout(this.boundaryMsgTimeout);
      this.boundaryMsgTimeout = null;
    }
  }

  /**
   * Get the current article ID.
   */
  getArticleId(): string {
    return this.articleId;
  }

  /**
   * Fetch article detail from the API.
   */
  private async fetchArticle(id: string): Promise<ArticleDetail> {
    const response = await fetch(`/api/articles/${encodeURIComponent(id)}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch article: ${response.status}`);
    }
    return await response.json() as ArticleDetail;
  }

  /**
   * Mark an article as read via the API.
   */
  private async markAsRead(articleId: string): Promise<void> {
    await fetch(`/api/articles/${encodeURIComponent(articleId)}/read`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isRead: true }),
    });
  }

  /**
   * Render the full article content.
   */
  private renderArticle(): void {
    if (!this.article) return;

    this.container.innerHTML = '';

    const view = document.createElement('article');
    view.className = 'article-view';
    view.setAttribute('role', 'article');

    // Header
    const header = document.createElement('header');
    header.className = 'article-view-header';
    header.innerHTML = `
      <h1 class="article-view-title">${this.escapeHtml(this.article.title)}</h1>
      <div class="article-view-meta">
        <span class="article-view-author">${this.escapeHtml(this.article.author)}</span>
        <time class="article-view-date" datetime="${this.article.publishedAt}">
          ${this.formatDate(this.article.publishedAt)}
        </time>
      </div>
    `;

    // Action buttons
    const actions = document.createElement('div');
    actions.className = 'article-view-actions';
    actions.innerHTML = `
      <button class="action-btn action-summarize" type="button" aria-label="Summarize article">
        Summarize
      </button>
      <button class="action-btn action-translate" type="button" aria-label="Translate article">
        Translate
      </button>
      <button class="action-btn action-read-aloud" type="button" aria-label="Read article aloud">
        Read Aloud
      </button>
    `;

    // Min touch target sizing
    actions.querySelectorAll('.action-btn').forEach((btn) => {
      (btn as HTMLElement).style.minWidth = '44px';
      (btn as HTMLElement).style.minHeight = '44px';
    });

    // Article body (HTML content rendered directly)
    const body = document.createElement('div');
    body.className = 'article-view-body';
    body.innerHTML = this.article.htmlContent;

    // Source link
    const sourceLink = document.createElement('footer');
    sourceLink.className = 'article-view-footer';
    sourceLink.innerHTML = `
      <a href="${this.escapeHtml(this.article.sourceUrl)}" 
         target="_blank" rel="noopener noreferrer"
         class="article-source-link">
        View original
      </a>
    `;

    // Boundary message container (for swipe navigation feedback)
    const boundaryMsg = document.createElement('div');
    boundaryMsg.className = 'article-boundary-msg';
    boundaryMsg.setAttribute('aria-live', 'polite');
    boundaryMsg.hidden = true;

    view.appendChild(header);
    view.appendChild(actions);
    view.appendChild(body);
    view.appendChild(sourceLink);
    view.appendChild(boundaryMsg);

    this.container.appendChild(view);

    // Wire action button events
    this.bindActionButtons(actions);
  }

  /**
   * Set up swipe gesture navigation for prev/next article.
   */
  private setupSwipeNavigation(): void {
    const viewEl = this.container.querySelector('.article-view') as HTMLElement;
    if (!viewEl) return;

    this.swipeNavigator = new ArticleSwipeNavigator({
      element: viewEl,
      getArticleIds: this.getArticleIds,
      getCurrentArticleId: () => this.articleId,
      navigateToArticle: (id: string) => {
        navigate(`/articles/${id}`);
      },
      showBoundaryMessage: (direction) => {
        this.showBoundaryMessage(
          direction === 'start' ? 'No previous article' : 'No more articles'
        );
      },
    });
    this.swipeNavigator.attach();
  }

  /**
   * Show a temporary boundary message when swiping at list edges.
   */
  private showBoundaryMessage(message: string): void {
    const msgEl = this.container.querySelector('.article-boundary-msg') as HTMLElement;
    if (!msgEl) return;

    msgEl.textContent = message;
    msgEl.hidden = false;

    if (this.boundaryMsgTimeout) {
      clearTimeout(this.boundaryMsgTimeout);
    }
    this.boundaryMsgTimeout = setTimeout(() => {
      msgEl.hidden = true;
      msgEl.textContent = '';
    }, 2000);
  }

  /**
   * Bind click handlers to action buttons.
   * These are stubs that will be connected to LLM and TTS services.
   */
  private bindActionButtons(actions: HTMLElement): void {
    const summarizeBtn = actions.querySelector('.action-summarize');
    const translateBtn = actions.querySelector('.action-translate');
    const readAloudBtn = actions.querySelector('.action-read-aloud');

    summarizeBtn?.addEventListener('click', () => {
      this.dispatchAction('summarize');
    });
    translateBtn?.addEventListener('click', () => {
      this.dispatchAction('translate');
    });
    readAloudBtn?.addEventListener('click', () => {
      this.dispatchAction('read-aloud');
    });
  }

  /**
   * Dispatch a custom event for action button clicks.
   * Parent components or services can listen for these to trigger LLM/TTS features.
   */
  private dispatchAction(action: 'summarize' | 'translate' | 'read-aloud'): void {
    const event = new CustomEvent('article-action', {
      bubbles: true,
      detail: {
        action,
        articleId: this.articleId,
        article: this.article,
      },
    });
    this.container.dispatchEvent(event);
  }

  /**
   * Render a loading state.
   */
  private renderLoading(): void {
    this.container.innerHTML = `
      <div class="article-view-loading" aria-live="polite">
        <p>Loading article...</p>
      </div>
    `;
  }

  /**
   * Render an error state.
   */
  private renderError(message: string): void {
    this.container.innerHTML = `
      <div class="article-view-error" role="alert">
        <p>${this.escapeHtml(message)}</p>
        <button class="retry-btn" type="button" style="min-width:44px;min-height:44px;">
          Retry
        </button>
      </div>
    `;

    const retryBtn = this.container.querySelector('.retry-btn');
    retryBtn?.addEventListener('click', () => this.init());
  }

  /**
   * Format a date string for display.
   */
  private formatDate(isoDate: string): string {
    try {
      const date = new Date(isoDate);
      return date.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return isoDate;
    }
  }

  /**
   * Escape HTML to prevent XSS in user-provided text fields.
   */
  private escapeHtml(str: string): string {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
}
