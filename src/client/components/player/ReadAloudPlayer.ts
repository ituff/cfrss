/**
 * ReadAloudPlayer — audio playback controls for article read-aloud.
 *
 * Provides Play, Pause, Stop buttons with paragraph highlighting.
 * Integrates with the global TTSService singleton to ensure cross-article
 * playback stop and page navigation cleanup.
 *
 * Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7
 */

import { getTTSService, type TTSState, type TTSService } from '../../services/tts.js';
import { onRouteChange } from '../../router.js';
import { t } from '../../services/i18n.js';

/** Minimum touch target size in pixels (requirement 1.6) */
const MIN_TOUCH_TARGET = 44;

/** CSS class applied to the currently-read paragraph (requirement 10.4) */
const HIGHLIGHT_CLASS = 'read-aloud-active-paragraph';

export interface ReadAloudPlayerOptions {
  /** Container element to render the player controls into */
  container: HTMLElement;
  /** The article content container (for paragraph highlighting) */
  articleBodyElement: HTMLElement;
  /** Article ID being read */
  articleId: string;
  /** Article HTML content (used to extract paragraphs for TTS) */
  htmlContent: string;
  /** Optional custom TTS endpoint URL */
  ttsEndpointUrl?: string;
}

export class ReadAloudPlayer {
  private container: HTMLElement;
  private articleBodyElement: HTMLElement;
  private articleId: string;
  private htmlContent: string;
  private ttsService: TTSService;
  private playerElement: HTMLElement | null = null;
  private unsubscribeRoute: (() => void) | null = null;
  private destroyed = false;

  constructor(options: ReadAloudPlayerOptions) {
    this.container = options.container;
    this.articleBodyElement = options.articleBodyElement;
    this.articleId = options.articleId;
    this.htmlContent = options.htmlContent;

    this.ttsService = getTTSService({
      endpointUrl: options.ttsEndpointUrl,
      onParagraphStart: (index) => this.highlightParagraph(index),
      onComplete: () => this.onPlaybackComplete(),
      onStateChange: (state) => this.updateUI(state),
      onError: (error) => this.showError(error),
    });
  }

  /**
   * Initialize the player — render controls and set up navigation cleanup.
   */
  init(): void {
    this.render();
    this.setupNavigationCleanup();
  }

  /**
   * Start playback. Called when the user clicks "Read Aloud" on an article.
   */
  async play(): Promise<void> {
    if (this.destroyed) return;
    await this.ttsService.start(this.articleId, this.htmlContent);
  }

  /**
   * Clean up the player — stop playback, remove highlights, remove event listeners.
   * Called when leaving the article view (requirement 10.7).
   */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;

    // Stop playback if this article is currently playing
    if (this.ttsService.getCurrentArticleId() === this.articleId) {
      this.ttsService.stop();
    }

    // Remove highlighting
    this.clearHighlights();

    // Remove route change listener
    if (this.unsubscribeRoute) {
      this.unsubscribeRoute();
      this.unsubscribeRoute = null;
    }

    // Remove player UI
    if (this.playerElement) {
      this.playerElement.remove();
      this.playerElement = null;
    }
  }

  /**
   * Render the player controls into the container.
   */
  private render(): void {
    this.playerElement = document.createElement('div');
    this.playerElement.className = 'read-aloud-player';
    this.playerElement.setAttribute('role', 'region');
    this.playerElement.setAttribute('aria-label', 'Read aloud player');

    this.playerElement.innerHTML = this.getPlayerHTML('idle');
    this.container.appendChild(this.playerElement);

    this.bindEvents();
  }

  /**
   * Get the HTML for the player controls based on state.
   */
  private getPlayerHTML(state: TTSState): string {
    const playLabel = t('read_aloud');
    const retryLabel = t('retry');

    const playBtn = `
      <button class="player-btn player-play" type="button" 
              aria-label="${playLabel}"
              style="min-width:${MIN_TOUCH_TARGET}px;min-height:${MIN_TOUCH_TARGET}px;"
              ${state === 'loading' ? 'disabled' : ''}>
        <span class="player-icon">&#9654;</span>
      </button>
    `;

    const pauseBtn = `
      <button class="player-btn player-pause" type="button" 
              aria-label="Pause"
              style="min-width:${MIN_TOUCH_TARGET}px;min-height:${MIN_TOUCH_TARGET}px;">
        <span class="player-icon">&#9646;&#9646;</span>
      </button>
    `;

    const resumeBtn = `
      <button class="player-btn player-resume" type="button" 
              aria-label="Resume"
              style="min-width:${MIN_TOUCH_TARGET}px;min-height:${MIN_TOUCH_TARGET}px;">
        <span class="player-icon">&#9654;</span>
      </button>
    `;

    const stopBtn = `
      <button class="player-btn player-stop" type="button" 
              aria-label="Stop"
              style="min-width:${MIN_TOUCH_TARGET}px;min-height:${MIN_TOUCH_TARGET}px;">
        <span class="player-icon">&#9632;</span>
      </button>
    `;

    const loadingIndicator = `
      <span class="player-loading" aria-live="polite">Loading…</span>
    `;

    const errorContainer = `
      <div class="player-error" role="alert" aria-live="assertive">
        <span class="player-error-msg"></span>
        <button class="player-btn player-retry" type="button"
                aria-label="${retryLabel}"
                style="min-width:${MIN_TOUCH_TARGET}px;min-height:${MIN_TOUCH_TARGET}px;">
          ${retryLabel}
        </button>
      </div>
    `;

    switch (state) {
      case 'idle':
        return `<div class="player-controls">${playBtn}</div>`;
      case 'loading':
        return `<div class="player-controls">${playBtn}${loadingIndicator}</div>`;
      case 'playing':
        return `<div class="player-controls">${pauseBtn}${stopBtn}</div>`;
      case 'paused':
        return `<div class="player-controls">${resumeBtn}${stopBtn}</div>`;
      case 'error':
        return `<div class="player-controls">${errorContainer}</div>`;
      default:
        return `<div class="player-controls">${playBtn}</div>`;
    }
  }

  /**
   * Update the player UI when state changes.
   */
  private updateUI(state: TTSState): void {
    if (this.destroyed || !this.playerElement) return;

    this.playerElement.innerHTML = this.getPlayerHTML(state);
    this.bindEvents();

    if (state === 'idle') {
      this.clearHighlights();
    }
  }

  /**
   * Bind event listeners to the current set of buttons.
   */
  private bindEvents(): void {
    if (!this.playerElement) return;

    const playBtn = this.playerElement.querySelector('.player-play');
    const pauseBtn = this.playerElement.querySelector('.player-pause');
    const resumeBtn = this.playerElement.querySelector('.player-resume');
    const stopBtn = this.playerElement.querySelector('.player-stop');
    const retryBtn = this.playerElement.querySelector('.player-retry');

    playBtn?.addEventListener('click', () => this.play());
    pauseBtn?.addEventListener('click', () => this.ttsService.pause());
    resumeBtn?.addEventListener('click', () => this.ttsService.resume());
    stopBtn?.addEventListener('click', () => {
      this.ttsService.stop();
      this.clearHighlights();
    });
    retryBtn?.addEventListener('click', () => this.play());
  }

  /**
   * Show an error message with retry option.
   * Requirement 10.5: show error with retry if TTS fails.
   */
  private showError(message: string): void {
    if (this.destroyed || !this.playerElement) return;

    // updateUI already renders error state; fill in the message
    const msgEl = this.playerElement.querySelector('.player-error-msg');
    if (msgEl) {
      msgEl.textContent = message;
    }
  }

  /**
   * Highlight the paragraph at the given index in the article body.
   * Requirement 10.4: visually distinguish the currently-read paragraph.
   */
  private highlightParagraph(index: number): void {
    if (this.destroyed) return;

    // Remove previous highlight
    this.clearHighlights();

    // Get block-level elements from the article body
    const blockElements = this.getBlockElements();
    if (index >= 0 && index < blockElements.length) {
      const el = blockElements[index];
      el.classList.add(HIGHLIGHT_CLASS);

      // Scroll the highlighted paragraph into view smoothly
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  /**
   * Remove highlighting from all paragraphs.
   */
  private clearHighlights(): void {
    const highlighted = this.articleBodyElement.querySelectorAll(`.${HIGHLIGHT_CLASS}`);
    highlighted.forEach((el) => el.classList.remove(HIGHLIGHT_CLASS));
  }

  /**
   * Get block-level elements from the article body that correspond to paragraphs.
   * Mirrors the paragraph extraction logic in TTSService.
   */
  private getBlockElements(): HTMLElement[] {
    const blockTags = new Set([
      'P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
      'LI', 'BLOCKQUOTE', 'PRE', 'SECTION', 'ARTICLE',
      'HEADER', 'FOOTER', 'FIGCAPTION', 'TD', 'TH',
    ]);

    const elements: HTMLElement[] = [];

    function walk(node: Node): void {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as HTMLElement;
        if (blockTags.has(el.tagName)) {
          const text = el.textContent?.trim();
          if (text) {
            elements.push(el);
          }
          return;
        }
      }
      for (const child of Array.from(node.childNodes)) {
        walk(child);
      }
    }

    walk(this.articleBodyElement);
    return elements;
  }

  /**
   * Handle playback completion.
   */
  private onPlaybackComplete(): void {
    this.clearHighlights();
  }

  /**
   * Set up route-change listener to stop playback on navigation.
   * Requirement 10.7: stop playback when leaving article page.
   */
  private setupNavigationCleanup(): void {
    this.unsubscribeRoute = onRouteChange(() => {
      // If we navigate away while this article is playing, stop it
      if (this.ttsService.getCurrentArticleId() === this.articleId) {
        this.ttsService.stop();
      }
      this.clearHighlights();
    });
  }
}
