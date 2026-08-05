/**
 * DailyDigestCard — displays the daily LLM-generated digest on the home page.
 *
 * Behavior:
 * 1. On first visit of the day (local date 00:00-23:59), fetches or generates digest.
 * 2. If cached digest exists for today → display immediately.
 * 3. If not cached → call POST /api/llm/digest/generate with loading animation.
 * 4. Shows "Skip" button during loading, 30s timeout, max 3 retries.
 * 5. If no articles → show "No new content today" message.
 *
 * Requirements: 7.1, 7.2, 7.4, 7.5, 7.6
 */

import { t } from '../../services/i18n.js';

export interface DailyDigest {
  date: string;
  content: string;
  articleCount: number;
  generatedAt: string;
}

type DigestState = 'idle' | 'loading' | 'success' | 'error' | 'timeout' | 'empty' | 'skipped';

const TIMEOUT_MS = 30000;
const MAX_RETRIES = 3;
const LAST_VISIT_KEY = 'cfrss_digest_last_visit_date';

export class DailyDigestCard {
  private container: HTMLElement;
  private state: DigestState = 'idle';
  private digest: DailyDigest | null = null;
  private retryCount = 0;
  private abortController: AbortController | null = null;
  private timeoutId: ReturnType<typeof setTimeout> | null = null;
  private errorMessage = '';

  constructor(container: HTMLElement) {
    this.container = container;
  }

  /**
   * Initialize the digest card — check if we should load digest today.
   */
  async init(): Promise<void> {
    const today = this.getTodayDateString();

    // First-visit-of-day detection (local date 00:00-23:59)
    const lastVisit = localStorage.getItem(LAST_VISIT_KEY);

    if (lastVisit === today) {
      // Already visited today — attempt to show cached digest
      await this.fetchCachedDigest(today);
    } else {
      // First visit today — mark as visited and load/generate digest
      localStorage.setItem(LAST_VISIT_KEY, today);
      await this.fetchCachedDigest(today);
    }
  }

  /**
   * Clean up resources (abort pending requests, clear timers).
   */
  destroy(): void {
    this.abort();
  }

  /**
   * Get today's date as YYYY-MM-DD in local timezone.
   */
  private getTodayDateString(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * Fetch the cached digest for a given date.
   * If not cached, triggers generation.
   */
  private async fetchCachedDigest(date: string): Promise<void> {
    this.setState('loading');

    try {
      const response = await fetch(`/api/llm/digest?date=${date}`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = (await response.json()) as { digest: DailyDigest | null };

      if (data.digest) {
        // Cached digest exists
        if (data.digest.articleCount === 0) {
          this.setState('empty');
        } else {
          this.digest = data.digest;
          this.setState('success');
        }
      } else {
        // No cached digest — trigger generation
        await this.generateDigest();
      }
    } catch {
      // Failed to check cache — try generating
      await this.generateDigest();
    }
  }

  /**
   * Generate digest via POST /api/llm/digest/generate with timeout.
   */
  private async generateDigest(): Promise<void> {
    if (this.retryCount >= MAX_RETRIES) {
      this.errorMessage = t('timeout');
      this.setState('error');
      return;
    }

    this.setState('loading');
    this.abortController = new AbortController();

    // Set 30s timeout
    this.timeoutId = setTimeout(() => {
      this.abortController?.abort();
      this.errorMessage = t('timeout');
      this.setState('timeout');
    }, TIMEOUT_MS);

    try {
      const response = await fetch('/api/llm/digest/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: this.abortController.signal,
      });

      this.clearTimeout();

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = (await response.json()) as { digest: DailyDigest };

      if (data.digest.articleCount === 0) {
        this.setState('empty');
      } else {
        this.digest = data.digest;
        this.setState('success');
      }
    } catch (err) {
      this.clearTimeout();

      if (err instanceof Error && err.name === 'AbortError') {
        // Timeout already handled by the setTimeout callback
        if (this.state !== 'timeout') {
          this.errorMessage = t('timeout');
          this.setState('timeout');
        }
      } else {
        this.retryCount++;
        this.errorMessage = t('network_error');
        this.setState('error');
      }
    }
  }

  /**
   * Retry digest generation (user clicks retry button).
   */
  private handleRetry = (): void => {
    this.retryCount++;
    if (this.retryCount >= MAX_RETRIES) {
      this.errorMessage = t('network_error');
      this.setState('error');
      return;
    }
    this.generateDigest();
  };

  /**
   * User clicked "Skip" during loading — hide the loading state.
   */
  private handleSkip = (): void => {
    this.abort();
    this.setState('skipped');
  };

  /**
   * Abort pending request and clear timeout.
   */
  private abort(): void {
    this.abortController?.abort();
    this.abortController = null;
    this.clearTimeout();
  }

  /**
   * Clear the timeout timer.
   */
  private clearTimeout(): void {
    if (this.timeoutId !== null) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
  }

  /**
   * Update component state and re-render.
   */
  private setState(newState: DigestState): void {
    this.state = newState;
    this.render();
  }

  /**
   * Render the component based on current state.
   */
  private render(): void {
    this.container.innerHTML = '';

    const card = document.createElement('div');
    card.className = 'daily-digest-card';
    card.setAttribute('role', 'region');
    card.setAttribute('aria-label', t('daily_digest'));

    switch (this.state) {
      case 'loading':
        card.appendChild(this.renderLoading());
        break;
      case 'success':
        card.appendChild(this.renderContent());
        break;
      case 'empty':
        card.appendChild(this.renderEmpty());
        break;
      case 'error':
        card.appendChild(this.renderError());
        break;
      case 'timeout':
        card.appendChild(this.renderTimeout());
        break;
      case 'skipped':
        // Show nothing (or minimal collapsed card)
        return;
      case 'idle':
      default:
        return;
    }

    this.container.appendChild(card);
  }

  /**
   * Render loading state with animation and skip button.
   */
  private renderLoading(): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'digest-loading';

    const header = document.createElement('h2');
    header.className = 'digest-title';
    header.textContent = t('daily_digest');

    const animation = document.createElement('div');
    animation.className = 'digest-loading-animation';
    animation.setAttribute('aria-live', 'polite');

    const dots = document.createElement('span');
    dots.className = 'digest-loading-dots';
    dots.textContent = t('loading_digest');

    animation.appendChild(dots);

    const skipBtn = document.createElement('button');
    skipBtn.className = 'digest-btn digest-btn-skip';
    skipBtn.textContent = t('skip');
    skipBtn.style.minWidth = '44px';
    skipBtn.style.minHeight = '44px';
    skipBtn.addEventListener('click', this.handleSkip);

    wrapper.appendChild(header);
    wrapper.appendChild(animation);
    wrapper.appendChild(skipBtn);

    return wrapper;
  }

  /**
   * Render digest content with markdown rendering.
   */
  private renderContent(): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'digest-content';

    const header = document.createElement('h2');
    header.className = 'digest-title';
    header.textContent = t('daily_digest');

    const body = document.createElement('div');
    body.className = 'digest-body';
    body.innerHTML = this.renderMarkdown(this.digest?.content ?? '');

    wrapper.appendChild(header);
    wrapper.appendChild(body);

    return wrapper;
  }

  /**
   * Render empty state — no new content today.
   */
  private renderEmpty(): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'digest-empty';

    const header = document.createElement('h2');
    header.className = 'digest-title';
    header.textContent = t('daily_digest');

    const msg = document.createElement('p');
    msg.className = 'digest-empty-message';
    msg.textContent = t('no_new_content');

    wrapper.appendChild(header);
    wrapper.appendChild(msg);

    return wrapper;
  }

  /**
   * Render error state with retry button.
   */
  private renderError(): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'digest-error';

    const header = document.createElement('h2');
    header.className = 'digest-title';
    header.textContent = t('daily_digest');

    const msg = document.createElement('p');
    msg.className = 'digest-error-message';
    msg.setAttribute('role', 'alert');
    msg.textContent = this.errorMessage;

    wrapper.appendChild(header);
    wrapper.appendChild(msg);

    // Show retry button if retries remaining
    if (this.retryCount < MAX_RETRIES) {
      const retryBtn = document.createElement('button');
      retryBtn.className = 'digest-btn digest-btn-retry';
      retryBtn.textContent = `${t('retry')} (${MAX_RETRIES - this.retryCount})`;
      retryBtn.style.minWidth = '44px';
      retryBtn.style.minHeight = '44px';
      retryBtn.addEventListener('click', this.handleRetry);
      wrapper.appendChild(retryBtn);
    }

    return wrapper;
  }

  /**
   * Render timeout state with retry option.
   */
  private renderTimeout(): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'digest-timeout';

    const header = document.createElement('h2');
    header.className = 'digest-title';
    header.textContent = t('daily_digest');

    const msg = document.createElement('p');
    msg.className = 'digest-timeout-message';
    msg.setAttribute('role', 'alert');
    msg.textContent = t('timeout');

    wrapper.appendChild(header);
    wrapper.appendChild(msg);

    // Show retry button if retries remaining
    if (this.retryCount < MAX_RETRIES) {
      const retryBtn = document.createElement('button');
      retryBtn.className = 'digest-btn digest-btn-retry';
      retryBtn.textContent = `${t('retry')} (${MAX_RETRIES - this.retryCount})`;
      retryBtn.style.minWidth = '44px';
      retryBtn.style.minHeight = '44px';
      retryBtn.addEventListener('click', this.handleRetry);
      wrapper.appendChild(retryBtn);
    }

    return wrapper;
  }

  /**
   * Simple markdown to HTML converter for digest content.
   * Supports: headers (#, ##, ###), bold (**text**), unordered lists (- item),
   * ordered lists (1. item), and paragraphs.
   */
  private renderMarkdown(md: string): string {
    if (!md) return '';

    const lines = md.split('\n');
    const htmlLines: string[] = [];
    let inList = false;
    let listType: 'ul' | 'ol' | null = null;

    for (const line of lines) {
      const trimmed = line.trim();

      // Close list if current line isn't a list item
      if (inList && !trimmed.startsWith('- ') && !trimmed.match(/^\d+\.\s/)) {
        htmlLines.push(listType === 'ul' ? '</ul>' : '</ol>');
        inList = false;
        listType = null;
      }

      // Headers
      if (trimmed.startsWith('### ')) {
        htmlLines.push(`<h4>${this.escapeHtml(trimmed.slice(4))}</h4>`);
      } else if (trimmed.startsWith('## ')) {
        htmlLines.push(`<h3>${this.escapeHtml(trimmed.slice(3))}</h3>`);
      } else if (trimmed.startsWith('# ')) {
        htmlLines.push(`<h3>${this.escapeHtml(trimmed.slice(2))}</h3>`);
      }
      // Unordered list
      else if (trimmed.startsWith('- ')) {
        if (!inList || listType !== 'ul') {
          if (inList) htmlLines.push(listType === 'ul' ? '</ul>' : '</ol>');
          htmlLines.push('<ul>');
          inList = true;
          listType = 'ul';
        }
        htmlLines.push(`<li>${this.inlineMarkdown(trimmed.slice(2))}</li>`);
      }
      // Ordered list
      else if (trimmed.match(/^\d+\.\s/)) {
        if (!inList || listType !== 'ol') {
          if (inList) htmlLines.push(listType === 'ul' ? '</ul>' : '</ol>');
          htmlLines.push('<ol>');
          inList = true;
          listType = 'ol';
        }
        const content = trimmed.replace(/^\d+\.\s/, '');
        htmlLines.push(`<li>${this.inlineMarkdown(content)}</li>`);
      }
      // Empty line
      else if (trimmed === '') {
        // Skip empty lines (paragraph separation handled implicitly)
      }
      // Paragraph
      else {
        htmlLines.push(`<p>${this.inlineMarkdown(trimmed)}</p>`);
      }
    }

    // Close any open list
    if (inList) {
      htmlLines.push(listType === 'ul' ? '</ul>' : '</ol>');
    }

    return htmlLines.join('');
  }

  /**
   * Process inline markdown (bold).
   */
  private inlineMarkdown(text: string): string {
    // Escape HTML first, then apply inline formatting
    let escaped = this.escapeHtml(text);
    // Bold: **text**
    escaped = escaped.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    return escaped;
  }

  /**
   * Escape HTML to prevent XSS.
   */
  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}
