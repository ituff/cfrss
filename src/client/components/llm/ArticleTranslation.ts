/**
 * ArticleTranslation — displays LLM-translated article content.
 * Calls POST /api/llm/translate with articleId and targetLanguage.
 * Supports two display modes: 'replace' (default) and 'side-by-side'.
 * Provides a "Show Original" button to revert to original content.
 * Streams translation progressively via SSE.
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5
 */

import { t, getLanguage } from '../../services/i18n.js';

export type TranslationDisplayMode = 'replace' | 'side-by-side';

export interface ArticleTranslationOptions {
  /** Container element to render into */
  container: HTMLElement;
  /** The article ID to translate */
  articleId: string;
  /** The original article HTML content */
  originalContent: string;
  /** Callback to restore original content */
  onShowOriginal: () => void;
}

type TranslationState = 'idle' | 'loading' | 'streaming' | 'done' | 'error';

export class ArticleTranslation {
  private container: HTMLElement;
  private articleId: string;
  private originalContent: string;
  private onShowOriginal: () => void;
  private state: TranslationState = 'idle';
  private translatedContent = '';
  private displayMode: TranslationDisplayMode = 'replace';
  private abortController: AbortController | null = null;
  private retryCount = 0;
  private readonly MAX_RETRIES = 3;

  constructor(options: ArticleTranslationOptions) {
    this.container = options.container;
    this.articleId = options.articleId;
    this.originalContent = options.originalContent;
    this.onShowOriginal = options.onShowOriginal;
  }

  /**
   * Start the translation process — fetch from API and render progressively.
   */
  async start(): Promise<void> {
    this.state = 'loading';
    this.translatedContent = '';
    this.render();

    this.abortController = new AbortController();
    const { signal } = this.abortController;

    const targetLanguage = getLanguage();

    try {
      const response = await fetch('/api/llm/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ articleId: this.articleId, targetLanguage }),
        signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const contentType = response.headers.get('content-type') ?? '';

      if (contentType.includes('text/event-stream')) {
        // Streaming SSE response
        await this.readStream(response, signal);
      } else {
        // Cached JSON response
        const data = await response.json() as { result: string };
        this.translatedContent = data.result;
        this.state = 'done';
        this.render();
      }
    } catch (err: unknown) {
      if (signal.aborted) return;
      this.state = 'error';
      this.render();
    }
  }

  /**
   * Abort any in-progress request and clean up.
   */
  destroy(): void {
    this.abortController?.abort();
    this.abortController = null;
    this.container.innerHTML = '';
  }

  /**
   * Switch display mode between 'replace' and 'side-by-side'.
   */
  setDisplayMode(mode: TranslationDisplayMode): void {
    this.displayMode = mode;
    if (this.state === 'done' || this.state === 'streaming') {
      this.render();
    }
  }

  /**
   * Get the current display mode.
   */
  getDisplayMode(): TranslationDisplayMode {
    return this.displayMode;
  }

  /**
   * Read an SSE stream and progressively display translated content.
   */
  private async readStream(response: Response, signal: AbortSignal): Promise<void> {
    this.state = 'streaming';
    this.render();

    const reader = response.body?.getReader();
    if (!reader) {
      this.state = 'error';
      this.render();
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        if (signal.aborted) {
          reader.cancel();
          return;
        }

        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Parse SSE events from buffer
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') {
              this.state = 'done';
              this.render();
              return;
            }
            try {
              const parsed = JSON.parse(data) as { content?: string };
              if (parsed.content) {
                this.translatedContent += parsed.content;
                this.renderTranslatedText();
              }
            } catch {
              // Non-JSON data line — treat as raw text chunk
              this.translatedContent += data;
              this.renderTranslatedText();
            }
          }
        }
      }

      // Stream ended without [DONE] marker
      this.state = 'done';
      this.render();
    } catch (err: unknown) {
      if (signal.aborted) return;
      this.state = 'error';
      this.render();
    }
  }

  /**
   * Full render based on current state.
   */
  private render(): void {
    this.container.innerHTML = '';
    this.container.className = 'article-translation';
    this.container.setAttribute('role', 'region');
    this.container.setAttribute('aria-label', 'Article translation');

    switch (this.state) {
      case 'idle':
        break;

      case 'loading':
        this.renderLoading();
        break;

      case 'streaming':
      case 'done':
        this.renderTranslation();
        break;

      case 'error':
        this.renderError();
        break;
    }
  }

  /**
   * Render the loading indicator.
   */
  private renderLoading(): void {
    this.container.innerHTML = `
      <div class="translation-loading" aria-live="polite">
        <span class="translation-spinner" aria-hidden="true"></span>
        <span>${this.escapeHtml(t('translating'))}</span>
      </div>
    `;
  }

  /**
   * Render the full translation view with controls.
   */
  private renderTranslation(): void {
    // Toolbar with mode toggle and show-original button
    const toolbar = document.createElement('div');
    toolbar.className = 'translation-toolbar';

    // Display mode toggle
    const modeToggle = document.createElement('button');
    modeToggle.className = 'translation-mode-btn';
    modeToggle.type = 'button';
    modeToggle.style.minWidth = '44px';
    modeToggle.style.minHeight = '44px';
    modeToggle.textContent = this.displayMode === 'replace' ? '⇔' : '⇋';
    modeToggle.title = this.displayMode === 'replace' ? 'Side by side' : 'Replace mode';
    modeToggle.setAttribute('aria-label',
      this.displayMode === 'replace' ? 'Switch to side-by-side mode' : 'Switch to replace mode'
    );
    modeToggle.addEventListener('click', () => {
      this.displayMode = this.displayMode === 'replace' ? 'side-by-side' : 'replace';
      this.render();
    });

    // Show original button
    const showOriginalBtn = document.createElement('button');
    showOriginalBtn.className = 'translation-original-btn';
    showOriginalBtn.type = 'button';
    showOriginalBtn.style.minWidth = '44px';
    showOriginalBtn.style.minHeight = '44px';
    showOriginalBtn.textContent = t('show_original');
    showOriginalBtn.setAttribute('aria-label', t('show_original'));
    showOriginalBtn.addEventListener('click', () => {
      this.destroy();
      this.onShowOriginal();
    });

    toolbar.appendChild(modeToggle);
    toolbar.appendChild(showOriginalBtn);

    // Content area
    const contentArea = document.createElement('div');
    contentArea.className = `translation-content translation-${this.displayMode}`;

    if (this.displayMode === 'side-by-side') {
      // Side-by-side: original on left, translation on right
      contentArea.innerHTML = `
        <div class="translation-panel translation-original" aria-label="Original content">
          ${this.originalContent}
        </div>
        <div class="translation-panel translation-translated" aria-label="Translated content" aria-live="polite">
          ${this.escapeHtml(this.translatedContent)}
        </div>
      `;
    } else {
      // Replace mode: only translation shown
      contentArea.innerHTML = `
        <div class="translation-translated" aria-live="polite">
          ${this.escapeHtml(this.translatedContent)}
        </div>
      `;
    }

    // Streaming indicator
    if (this.state === 'streaming') {
      const indicator = document.createElement('span');
      indicator.className = 'translation-streaming-indicator';
      indicator.setAttribute('aria-hidden', 'true');
      indicator.textContent = '●';
      toolbar.appendChild(indicator);
    }

    this.container.appendChild(toolbar);
    this.container.appendChild(contentArea);
  }

  /**
   * Update just the translated text content without full re-render.
   */
  private renderTranslatedText(): void {
    const translated = this.container.querySelector('.translation-translated');
    if (translated) {
      translated.textContent = this.translatedContent;
    } else {
      // First chunk — do a full render to create the structure
      this.render();
    }
  }

  /**
   * Render the error state with retry button.
   */
  private renderError(): void {
    const canRetry = this.retryCount < this.MAX_RETRIES;
    this.container.innerHTML = `
      <div class="translation-error" role="alert">
        <span>${this.escapeHtml(t('network_error'))}</span>
        ${canRetry ? `
          <button class="translation-retry-btn" type="button"
                  style="min-width:44px;min-height:44px;"
                  aria-label="${this.escapeHtml(t('retry'))}">
            ${this.escapeHtml(t('retry'))}
          </button>
        ` : ''}
      </div>
    `;

    if (canRetry) {
      const retryBtn = this.container.querySelector('.translation-retry-btn');
      retryBtn?.addEventListener('click', () => this.retry());
    }
  }

  /**
   * Retry the translation.
   */
  private retry(): void {
    this.retryCount++;
    this.abortController?.abort();
    this.start();
  }

  /**
   * Escape HTML to prevent XSS.
   */
  private escapeHtml(str: string): string {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
}
