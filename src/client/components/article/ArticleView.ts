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
import { t } from '../../services/i18n.js';
import { ArticleSummary } from '../llm/ArticleSummary.js';
import { ArticleTranslation } from '../llm/ArticleTranslation.js';
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
  private summary: ArticleSummary | null = null;
  private translation: ArticleTranslation | null = null;
  private llmHost: HTMLElement | null = null;
  private bodyEl: HTMLElement | null = null;

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
    this.teardownLlmPanels();
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
    // API wraps the payload: { article: {...} }
    const data = await response.json() as { article: ArticleDetail };
    return data.article;
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

    this.teardownLlmPanels();
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
      <button class="action-btn action-summarize" type="button" aria-label="${t('summarize')}">
        <span class="action-btn__icon" aria-hidden="true">✦</span>${t('summarize')}
      </button>
      <button class="action-btn action-translate" type="button" aria-label="${t('translate')}">
        <span class="action-btn__icon" aria-hidden="true">🌐</span>${t('translate')}
      </button>
      <button class="action-btn action-read-aloud" type="button" aria-label="${t('read_aloud')}">
        <span class="action-btn__icon" aria-hidden="true">🔊</span>${t('read_aloud')}
      </button>
    `;

    // LLM panels host (summary / translation render here)
    this.llmHost = document.createElement('div');
    this.llmHost.className = 'article-view-llm';

    // Article body (HTML content rendered directly)
    const body = document.createElement('div');
    body.className = 'article-view-body';
    body.innerHTML = this.article.htmlContent;
    this.bodyEl = body;

    // Source link
    const sourceLink = document.createElement('footer');
    sourceLink.className = 'article-view-footer';
    sourceLink.innerHTML = `
      <a href="${this.escapeHtml(this.article.sourceUrl)}" 
         target="_blank" rel="noopener noreferrer"
         class="article-source-link">
        ${t('show_original')} ↗
      </a>
    `;

    // Boundary message container (for swipe navigation feedback)
    const boundaryMsg = document.createElement('div');
    boundaryMsg.className = 'article-boundary-msg';
    boundaryMsg.setAttribute('aria-live', 'polite');
    boundaryMsg.hidden = true;

    view.appendChild(header);
    view.appendChild(actions);
    view.appendChild(this.llmHost);
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

    summarizeBtn?.addEventListener('click', () => this.toggleSummary());
    translateBtn?.addEventListener('click', () => this.toggleTranslation());
    readAloudBtn?.addEventListener('click', () => {
      this.dispatchAction('read-aloud');
    });
  }

  /**
   * Toggle the LLM summary panel above the article body.
   */
  private toggleSummary(): void {
    if (!this.llmHost || !this.article) return;

    if (this.summary) {
      this.summary.destroy();
      this.summary = null;
      this.llmHost.querySelector('.summary-slot')?.remove();
      return;
    }

    const slot = document.createElement('div');
    slot.className = 'summary-slot';
    this.llmHost.appendChild(slot);

    this.summary = new ArticleSummary({
      container: slot,
      articleId: this.articleId,
    });
    void this.summary.start();
  }

  /**
   * Toggle the translation panel; restores the original body on close.
   */
  private toggleTranslation(): void {
    if (!this.llmHost || !this.bodyEl || !this.article) return;

    if (this.translation) {
      this.closeTranslation();
      return;
    }

    const slot = document.createElement('div');
    slot.className = 'translation-slot';
    this.llmHost.appendChild(slot);

    // Hide the original body while the translation is open (replace mode)
    this.bodyEl.style.display = 'none';

    this.translation = new ArticleTranslation({
      container: slot,
      articleId: this.articleId,
      originalContent: this.article.htmlContent,
      onShowOriginal: () => this.closeTranslation(),
    });
    void this.translation.start();
  }

  /** Restore the original article body and remove the translation panel. */
  private closeTranslation(): void {
    if (this.bodyEl) {
      this.bodyEl.style.display = '';
    }
    this.translation?.destroy();
    this.translation = null;
    this.llmHost?.querySelector('.translation-slot')?.remove();
  }

  /** Tear down any open LLM panels (called when a new article renders). */
  private teardownLlmPanels(): void {
    this.summary?.destroy();
    this.summary = null;
    this.translation?.destroy();
    this.translation = null;
    this.llmHost = null;
    this.bodyEl = null;
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
