/**
 * ArticleTranslation — displays LLM-translated article content.
 * Calls POST /api/llm/translate with articleId and targetLanguage.
 *
 * Features:
 * - Target language selector (common languages; remembers the last choice)
 * - Three display modes: 'dual' (原文/译文 two stacked rows, default),
 *   'side-by-side' and 'replace'
 * - "Show Original" button to close the panel
 * - Streams translation progressively via SSE
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5
 */

import { t, getLanguage, type SupportedLanguage } from '../../services/i18n.js';
import {
  TARGET_LANGUAGES,
  TARGET_LANGUAGE_LABELS,
  isTargetLanguage,
  type TargetLanguage,
} from '../../../utils/translate-languages';

export type TranslationDisplayMode = 'dual' | 'side-by-side' | 'replace';

/** localStorage key holding the last selected target language. */
const TARGET_LANGUAGE_STORAGE_KEY = 'cfrss.translate_target';

/** localStorage key holding the last selected display mode. */
const DISPLAY_MODE_STORAGE_KEY = 'cfrss.translate_mode';

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

/**
 * Resolve the initial target language: last user choice → UI language → 'en'.
 */
function resolveInitialTargetLanguage(): TargetLanguage {
  try {
    const stored = localStorage.getItem(TARGET_LANGUAGE_STORAGE_KEY);
    if (isTargetLanguage(stored)) {
      return stored;
    }
  } catch {
    // localStorage unavailable — fall through
  }
  const uiLang: SupportedLanguage = getLanguage();
  return uiLang === 'zh' ? 'zh' : 'en';
}

function resolveInitialDisplayMode(): TranslationDisplayMode {
  try {
    const stored = localStorage.getItem(DISPLAY_MODE_STORAGE_KEY);
    if (stored === 'dual' || stored === 'side-by-side' || stored === 'replace') {
      return stored;
    }
  } catch {
    // localStorage unavailable — fall through
  }
  return 'dual';
}

export class ArticleTranslation {
  private container: HTMLElement;
  private articleId: string;
  private originalContent: string;
  private onShowOriginal: () => void;
  private state: TranslationState = 'idle';
  private translatedContent = '';
  private displayMode: TranslationDisplayMode = resolveInitialDisplayMode();
  private targetLanguage: TargetLanguage = resolveInitialTargetLanguage();
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

    this.abortController?.abort();
    this.abortController = new AbortController();
    const { signal } = this.abortController;

    try {
      const response = await fetch('/api/llm/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ articleId: this.articleId, targetLanguage: this.targetLanguage }),
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
        // Cache-hit responses are { cached: true, content }
        const data = await response.json() as { content?: string };
        this.translatedContent = data.content ?? '';
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
   * Switch display mode between 'dual', 'side-by-side' and 'replace'.
   */
  setDisplayMode(mode: TranslationDisplayMode): void {
    this.displayMode = mode;
    this.persistDisplayMode();
    // Re-render in every state so the toolbar reflects the new mode
    this.render();
  }

  /**
   * Get the current display mode.
   */
  getDisplayMode(): TranslationDisplayMode {
    return this.displayMode;
  }

  /**
   * Change the target language and restart the translation.
   */
  setTargetLanguage(lang: TargetLanguage): void {
    if (lang === this.targetLanguage) return;
    this.targetLanguage = lang;
    this.persistTargetLanguage();
    this.retryCount = 0;
    void this.start();
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
    // Keep the slot's own class (closeTranslation relies on it to remove the panel)
    this.container.classList.add('article-translation');
    this.container.setAttribute('role', 'region');
    this.container.setAttribute('aria-label', t('translation_label'));

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
   * Build the shared toolbar: target language selector, mode toggle,
   * show-original button and streaming indicator.
   */
  private buildToolbar(): HTMLElement {
    const toolbar = document.createElement('div');
    toolbar.className = 'translation-toolbar';

    // Target language selector
    const langSelect = document.createElement('select');
    langSelect.className = 'translation-target-select';
    langSelect.setAttribute('aria-label', t('target_language'));
    langSelect.title = t('target_language');
    for (const code of TARGET_LANGUAGES) {
      const option = document.createElement('option');
      option.value = code;
      option.textContent = TARGET_LANGUAGE_LABELS[code];
      option.selected = code === this.targetLanguage;
      langSelect.appendChild(option);
    }
    langSelect.addEventListener('change', () => {
      this.setTargetLanguage(langSelect.value as TargetLanguage);
    });
    toolbar.appendChild(langSelect);

    // Display mode toggle (cycles dual → side-by-side → replace)
    const modeToggle = document.createElement('button');
    modeToggle.className = 'translation-mode-btn';
    modeToggle.type = 'button';
    modeToggle.style.minWidth = '44px';
    modeToggle.style.minHeight = '44px';
    modeToggle.textContent = t(`mode_${this.displayMode.replace(/-/g, '_')}`);
    const nextModes: Record<TranslationDisplayMode, TranslationDisplayMode> = {
      'dual': 'side-by-side',
      'side-by-side': 'replace',
      'replace': 'dual',
    };
    modeToggle.title = t(`switch_to_${nextModes[this.displayMode].replace(/-/g, '_')}`);
    modeToggle.setAttribute('aria-label', modeToggle.title);
    modeToggle.addEventListener('click', () => {
      this.setDisplayMode(nextModes[this.displayMode]);
    });
    toolbar.appendChild(modeToggle);

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
    toolbar.appendChild(showOriginalBtn);

    // Streaming indicator
    if (this.state === 'streaming') {
      const indicator = document.createElement('span');
      indicator.className = 'translation-streaming-indicator';
      indicator.setAttribute('aria-hidden', 'true');
      indicator.textContent = '●';
      toolbar.appendChild(indicator);
    }

    return toolbar;
  }

  /**
   * Render the loading indicator.
   */
  private renderLoading(): void {
    this.container.appendChild(this.buildToolbar());
    const loading = document.createElement('div');
    loading.className = 'translation-loading';
    loading.setAttribute('aria-live', 'polite');
    loading.innerHTML = `
      <span class="translation-spinner" aria-hidden="true"></span>
      <span>${this.escapeHtml(t('translating'))}</span>
    `;
    this.container.appendChild(loading);
  }

  /**
   * Render the full translation view with controls.
   */
  private renderTranslation(): void {
    this.container.appendChild(this.buildToolbar());

    // Content area
    const contentArea = document.createElement('div');
    contentArea.className = `translation-content translation-${this.displayMode}`;

    const originalPanel = `
      <div class="translation-panel translation-original">
        <span class="translation-panel-label">${this.escapeHtml(t('original_content'))}</span>
        <div class="translation-panel-body" aria-label="${this.escapeHtml(t('original_content'))}">
          ${this.originalContent}
        </div>
      </div>
    `;
    const translatedPanel = `
      <div class="translation-panel translation-translated">
        <span class="translation-panel-label">${this.escapeHtml(t('translated_content'))}</span>
        <div class="translation-panel-body" aria-label="${this.escapeHtml(t('translated_content'))}" aria-live="polite">
          ${this.translatedContent}
        </div>
      </div>
    `;

    if (this.displayMode === 'dual') {
      // Two stacked rows: original on top, translation below
      contentArea.innerHTML = originalPanel + translatedPanel;
    } else if (this.displayMode === 'side-by-side') {
      // Side-by-side: original on left, translation on right
      contentArea.innerHTML = originalPanel + translatedPanel;
    } else {
      // Replace mode: only translation shown
      contentArea.innerHTML = translatedPanel;
    }

    this.container.appendChild(contentArea);
  }

  /**
   * Update just the translated text content without full re-render.
   */
  private renderTranslatedText(): void {
    const translated = this.container.querySelector('.translation-translated .translation-panel-body');
    if (translated) {
      translated.innerHTML = this.translatedContent;
    } else {
      // First chunk — do a full render to create the structure
      this.render();
    }
  }

  /**
   * Render the error state with retry button.
   */
  private renderError(): void {
    // Keep the toolbar so the target language can be changed before retrying
    this.container.innerHTML = '';
    this.container.appendChild(this.buildToolbar());

    const canRetry = this.retryCount < this.MAX_RETRIES;
    const errorBox = document.createElement('div');
    errorBox.className = 'translation-error';
    errorBox.setAttribute('role', 'alert');
    errorBox.innerHTML = `
        <span>${this.escapeHtml(t('network_error'))}</span>
        ${canRetry ? `
          <button class="translation-retry-btn" type="button"
                  style="min-width:44px;min-height:44px;"
                  aria-label="${this.escapeHtml(t('retry'))}">
            ${this.escapeHtml(t('retry'))}
          </button>
        ` : ''}
    `;
    this.container.appendChild(errorBox);

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
   * Persist the target language choice (default for next translations).
   */
  private persistTargetLanguage(): void {
    try {
      localStorage.setItem(TARGET_LANGUAGE_STORAGE_KEY, this.targetLanguage);
    } catch {
      // localStorage unavailable — non-critical
    }
  }

  /**
   * Persist the display mode choice.
   */
  private persistDisplayMode(): void {
    try {
      localStorage.setItem(DISPLAY_MODE_STORAGE_KEY, this.displayMode);
    } catch {
      // localStorage unavailable — non-critical
    }
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
