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
import { getBookmarkState, addBookmark, removeBookmark } from '../../services/api.js';
import { ArticleSummary } from '../llm/ArticleSummary.js';
import { ArticleTranslation } from '../llm/ArticleTranslation.js';
import { ReadAloudPlayer } from '../player/ReadAloudPlayer.js';
import { ArticleSwipeNavigator } from '../../gestures.js';
import { getCurrentArticleId, setCurrentArticleId } from '../../state.js';

/**
 * Bookmark icon — an inline SVG so the saved state can be expressed by
 * `fill` alone (a glyph swap like ☆/★ would shift the text baseline).
 * Sized explicitly; `currentColor` keeps it themed in light/dark/e-ink.
 */
const BOOKMARK_ICON = `<svg class="action-btn__svg" width="14" height="14" viewBox="0 0 24 24"
  fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
  stroke-linejoin="round" aria-hidden="true">
  <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path>
</svg>`;

export interface ArticleDetail {
  id: string;
  title: string;
  author: string;
  publishedAt: string;
  htmlContent: string;
  /** Feed-provided summary — used as the body fallback when full content is unavailable */
  summary?: string;
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
  private readAloudPlayer: ReadAloudPlayer | null = null;
  private llmHost: HTMLElement | null = null;
  private readAloudHost: HTMLElement | null = null;
  private bodyEl: HTMLElement | null = null;
  /** Bookmark state for the current article (optimistic; synced with the API). */
  private bookmarked = false;
  private bookmarkBtn: HTMLButtonElement | null = null;
  private bookmarkBusy = false;

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

      // Restore the bookmark state for this article
      this.syncBookmarkState(this.articleId).catch(() => {
        // Silent failure — the button stays in its default unbookmarked state
      });
    } catch (err) {
      this.renderError(t('load_article_failed'));
    }
  }

  /**
   * Clean up event listeners and gesture detectors.
   */
  destroy(): void {
    this.teardownLlmPanels();
    this.teardownReadAloud();
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

    this.teardownReadAloud();
    this.teardownLlmPanels();
    this.container.innerHTML = '';

    const view = document.createElement('article');
    view.className = 'article-view';
    view.setAttribute('role', 'article');

    // Header
    const header = document.createElement('header');
    header.className = 'article-view-header';
    const author = this.normalizeAuthor(this.article.author);
    header.innerHTML = `
      <h1 class="article-view-title">${this.escapeHtml(this.article.title)}</h1>
      <div class="article-view-meta">
        ${author ? `<span class="article-view-author">${this.escapeHtml(author)}</span>` : ''}
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
      <button class="action-btn action-bookmark" type="button"
              aria-label="${t('bookmark_add')}" title="${t('bookmark_add')}"
              aria-pressed="${this.bookmarked ? 'true' : 'false'}">
        <span class="action-btn__icon" aria-hidden="true">${BOOKMARK_ICON}</span>${t('bookmarks')}
      </button>
    `;

    // LLM panels host (summary / translation render here)
    this.llmHost = document.createElement('div');
    this.llmHost.className = 'article-view-llm';

    // Read-aloud player host (player controls render here when active)
    this.readAloudHost = document.createElement('div');
    this.readAloudHost.className = 'article-view-readaloud';

    // Article body (HTML content rendered directly; fall back to the feed
    // summary when full content storage is unavailable)
    const body = document.createElement('div');
    body.className = 'article-view-body';
    body.innerHTML = this.article.htmlContent || this.article.summary || '';
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
    view.appendChild(this.readAloudHost);
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
          direction === 'start' ? t('no_previous_article') : t('no_more_articles')
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
   */
  private bindActionButtons(actions: HTMLElement): void {
    const summarizeBtn = actions.querySelector('.action-summarize');
    const translateBtn = actions.querySelector('.action-translate');
    const readAloudBtn = actions.querySelector('.action-read-aloud');

    summarizeBtn?.addEventListener('click', () => this.toggleSummary());
    translateBtn?.addEventListener('click', () => this.toggleTranslation());
    readAloudBtn?.addEventListener('click', () => this.toggleReadAloud());

    this.bookmarkBtn = actions.querySelector('.action-bookmark') as HTMLButtonElement | null;
    this.bookmarkBtn?.addEventListener('click', () => void this.toggleBookmark());
  }

  /**
   * Load the persisted bookmark state for an article and reflect it on the
   * toolbar button. Called once the article has rendered so the button exists.
   */
  private async syncBookmarkState(articleId: string): Promise<void> {
    const bookmarked = await getBookmarkState(articleId);
    // Ignore a response that arrived after navigating to another article
    if (this.articleId !== articleId) return;
    this.applyBookmarkState(bookmarked);
  }

  /**
   * Toggle the bookmark for the current article. The button updates instantly
   * and rolls back if the request fails, so a flaky network never leaves the
   * UI claiming a save that did not happen.
   */
  private async toggleBookmark(): Promise<void> {
    if (this.bookmarkBusy || !this.article) return;

    const next = !this.bookmarked;
    this.bookmarkBusy = true;
    this.applyBookmarkState(next);

    try {
      if (next) {
        await addBookmark(this.articleId);
      } else {
        await removeBookmark(this.articleId);
      }
    } catch {
      this.applyBookmarkState(!next);
      this.showBoundaryMessage(t('bookmark_save_failed'));
    } finally {
      this.bookmarkBusy = false;
    }
  }

  /** Reflect a bookmark state on the toolbar button. */
  private applyBookmarkState(bookmarked: boolean): void {
    this.bookmarked = bookmarked;
    if (!this.bookmarkBtn) return;

    this.bookmarkBtn.classList.toggle('active', bookmarked);
    this.bookmarkBtn.setAttribute('aria-pressed', bookmarked ? 'true' : 'false');

    const label = bookmarked ? t('bookmark_remove') : t('bookmark_add');
    this.bookmarkBtn.setAttribute('aria-label', label);
    this.bookmarkBtn.title = label;
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
      originalContent: this.article.htmlContent || this.article.summary || '',
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

  /**
   * Toggle read-aloud playback for this article. First click creates the
   * player controls and starts speaking; clicking again stops playback.
   */
  private toggleReadAloud(): void {
    if (!this.readAloudHost || !this.bodyEl || !this.article) return;

    if (this.readAloudPlayer) {
      this.teardownReadAloud();
      return;
    }

    this.readAloudPlayer = new ReadAloudPlayer({
      container: this.readAloudHost,
      articleBodyElement: this.bodyEl,
      articleId: this.articleId,
      htmlContent: this.article.htmlContent || this.article.summary || '',
      onEnded: () => this.clearReadAloudButton(),
    });
    this.readAloudPlayer.init();
    void this.readAloudPlayer.play();

    // Reflect the active state on the toolbar button
    this.container.querySelector('.action-read-aloud')?.classList.add('active');
  }

  /** Stop playback, remove the player controls and button highlight. */
  private teardownReadAloud(): void {
    this.readAloudPlayer?.destroy();
    this.readAloudPlayer = null;
    if (this.readAloudHost) {
      this.readAloudHost.innerHTML = '';
    }
    this.clearReadAloudButton();
  }

  /** Remove the active highlight from the toolbar read-aloud button. */
  private clearReadAloudButton(): void {
    this.container.querySelector('.action-read-aloud')?.classList.remove('active');
  }

  /** Tear down any open LLM panels (called when a new article renders). */
  private teardownLlmPanels(): void {
    this.summary?.destroy();
    this.summary = null;
    this.translation?.destroy();
    this.translation = null;
    this.llmHost = null;
    this.readAloudHost = null;
    this.bodyEl = null;
  }

  /**
   * Render a loading state.
   */
  private renderLoading(): void {
    this.container.innerHTML = `
      <div class="article-view-loading" aria-live="polite">
        <p>${this.escapeHtml(t('loading_article'))}</p>
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
          ${this.escapeHtml(t('retry'))}
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
    return String(str ?? '').replace(/[&<>"']/g, (c) => {
      switch (c) {
        case '&': return '&amp;';
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '"': return '&quot;';
        default: return '&#39;';
      }
    });
  }

  /**
   * Reduce a raw feed author value to a plain-text display name.
   *
   * Feeds are inconsistent: RSS gives an email-like string, while Atom gives a
   * structured `<author>` block. Legacy rows were stored before nested tags were
   * stripped, so markup such as `<name>Ibrahim Badr</name><title>Product
   * Manager</title>` can still arrive here.
   *
   * Preference order when the raw value is a person construct: the `<name>`
   * child, then `<email>`, then the leading text before the first sibling tag.
   * Returns '' when nothing displayable remains — the caller omits the node.
   */
  private normalizeAuthor(raw: string): string {
    if (!raw) return '';

    const value = String(raw).replace(/<!\[CDATA\[|\]\]>/g, '').trim();

    // Structured value: take the <name> field when the feed provided one.
    const nameField = /<name[^>]*>([\s\S]*?)<\/name>/i.exec(value);
    let text = nameField ? nameField[1] : value;

    // Otherwise keep only the text before the first *sibling* tag, so a
    // collapsed person construct does not become "Ibrahim Badr Product Manager".
    if (!nameField && /^\s*<[a-z]/i.test(value)) {
      text = value.split(/<[a-z/][^>]*>/i)[0];
    }

    text = text
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#0?39;|&apos;/gi, "'")
      .replace(/&amp;/gi, '&')
      .replace(/\s+/g, ' ')
      .trim();

    // Unwrap "author@example.com (Jane Doe)" → "Jane Doe".
    const wrapped = /^\S+@\S+\.\S+\s*\(([^)]+)\)\s*$/.exec(text);
    if (wrapped) text = wrapped[1].trim();

    return text;
  }
}
