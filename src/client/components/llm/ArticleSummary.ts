/**
 * ArticleSummary — displays an LLM-generated article summary.
 * Calls POST /api/llm/summarize with the articleId.
 * Supports cached responses (instant render) and streaming SSE (typewriter effect).
 * Shows loading state ("Generating…") and error with retry on failure.
 * Renders the summary above the article content.
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5
 */

import { t } from '../../services/i18n.js';

export interface ArticleSummaryOptions {
  /** Container element to render into (inserted above article body) */
  container: HTMLElement;
  /** The article ID to summarize */
  articleId: string;
}

type SummaryState = 'idle' | 'loading' | 'streaming' | 'done' | 'error';

export class ArticleSummary {
  private container: HTMLElement;
  private articleId: string;
  private state: SummaryState = 'idle';
  private content = '';
  private abortController: AbortController | null = null;
  private retryCount = 0;
  private readonly MAX_RETRIES = 3;

  constructor(options: ArticleSummaryOptions) {
    this.container = options.container;
    this.articleId = options.articleId;
  }

  /**
   * Start the summarization process — fetch from API and render progressively.
   */
  async start(): Promise<void> {
    this.state = 'loading';
    this.content = '';
    this.render();

    this.abortController = new AbortController();
    const { signal } = this.abortController;

    try {
      const response = await fetch('/api/llm/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ articleId: this.articleId }),
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
        // Cache-hit responses are { cached: true, content } — older docs said { result }
        const data = await response.json() as { content?: string; result?: string };
        this.content = data.content ?? data.result ?? '';
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
   * Read an SSE stream and progressively display content.
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
                this.content += parsed.content;
                this.renderContent();
              }
            } catch {
              // Non-JSON data line — treat as raw text chunk
              this.content += data;
              this.renderContent();
            }
          }
        }
      }

      // Stream ended without [DONE] marker — still complete
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
    this.container.className = 'article-summary';
    this.container.setAttribute('role', 'region');
    this.container.setAttribute('aria-label', 'Article summary');

    switch (this.state) {
      case 'idle':
        break;

      case 'loading':
        this.renderLoading();
        break;

      case 'streaming':
      case 'done':
        this.renderContent();
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
      <div class="summary-loading" aria-live="polite">
        <span class="summary-spinner" aria-hidden="true"></span>
        <span>${this.escapeHtml(t('generating'))}</span>
      </div>
    `;
  }

  /**
   * Render the summary content (progressive or final).
   */
  private renderContent(): void {
    const existingContent = this.container.querySelector('.summary-content');
    if (existingContent) {
      // Update text without full re-render to preserve scroll position
      existingContent.textContent = this.content;
      return;
    }

    this.container.innerHTML = `
      <div class="summary-wrapper">
        <div class="summary-header">
          <strong>${this.escapeHtml(t('summarize'))}</strong>
          ${this.state === 'streaming' ? '<span class="summary-streaming-indicator" aria-hidden="true">●</span>' : ''}
        </div>
        <p class="summary-content" aria-live="polite">${this.escapeHtml(this.content)}</p>
      </div>
    `;
  }

  /**
   * Render the error state with retry button.
   */
  private renderError(): void {
    const canRetry = this.retryCount < this.MAX_RETRIES;
    this.container.innerHTML = `
      <div class="summary-error" role="alert">
        <span>${this.escapeHtml(t('network_error'))}</span>
        ${canRetry ? `
          <button class="summary-retry-btn" type="button" 
                  style="min-width:44px;min-height:44px;"
                  aria-label="${this.escapeHtml(t('retry'))}">
            ${this.escapeHtml(t('retry'))}
          </button>
        ` : ''}
      </div>
    `;

    if (canRetry) {
      const retryBtn = this.container.querySelector('.summary-retry-btn');
      retryBtn?.addEventListener('click', () => this.retry());
    }
  }

  /**
   * Retry the summarization.
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
