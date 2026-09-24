/**
 * TTS (Text-to-Speech) service client.
 *
 * Reads articles aloud through a self-hosted read-aloud Worker
 * (upstream: https://github.com/yy4382/read-aloud, deployed by the user at their
 * own URL).
 * The browser never talks to that Worker directly: requests go through
 * the authenticated proxy POST /api/tts/synthesis, which appends the
 * server-stored API key. The service URL and key are configured in
 * Settings (GET/PUT /api/config/tts).
 *
 * Paragraphs are synthesized one by one; the next paragraph is prefetched
 * while the current one plays to keep the gap between segments minimal.
 */

import { t } from './i18n.js';
import { resolveVoiceName } from './tts-utils.js';

export type TTSState = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

export interface TTSOptions {
  /** Called when a new paragraph starts playing */
  onParagraphStart?: (index: number) => void;
  /** Called when playback completes all paragraphs */
  onComplete?: () => void;
  /** Called on state changes */
  onStateChange?: (state: TTSState) => void;
  /** Called on error */
  onError?: (error: string) => void;
}

/**
 * TTSService manages synthesis and playback of article paragraphs
 * using the HTMLAudioElement.
 */
export class TTSService {
  private state: TTSState = 'idle';
  private audioElement: HTMLAudioElement | null = null;
  private abortController: AbortController | null = null;
  private currentArticleId: string | null = null;
  private paragraphs: string[] = [];
  private currentParagraphIndex = 0;
  private objectUrl: string | null = null;

  /** In-flight paragraph synthesis requests, keyed by paragraph index. */
  private pending = new Map<number, Promise<Blob | null>>();

  /**
   * User-selected voice, fetched once per playback session and reused
   * for every paragraph. Null means "not loaded yet"; 'auto' means
   * per-paragraph script detection.
   */
  private preferredVoice: string | null = null;

  private onParagraphStart?: (index: number) => void;
  private onComplete?: () => void;
  private onStateChange?: (state: TTSState) => void;
  private onError?: (error: string) => void;

  constructor(options?: TTSOptions) {
    this.onParagraphStart = options?.onParagraphStart;
    this.onComplete = options?.onComplete;
    this.onStateChange = options?.onStateChange;
    this.onError = options?.onError;
  }

  /**
   * Rebind the event callbacks. Only one article plays at a time, so the
   * most recent caller owns the callbacks (see getTTSService).
   */
  setOptions(options: TTSOptions): void {
    this.onParagraphStart = options.onParagraphStart;
    this.onComplete = options.onComplete;
    this.onStateChange = options.onStateChange;
    this.onError = options.onError;
  }

  /**
   * Get the current TTS state.
   */
  getState(): TTSState {
    return this.state;
  }

  /**
   * Get the ID of the article currently being read.
   */
  getCurrentArticleId(): string | null {
    return this.currentArticleId;
  }

  /**
   * Get the index of the paragraph currently being read aloud.
   */
  getCurrentParagraphIndex(): number {
    return this.currentParagraphIndex;
  }

  /**
   * Start reading an article aloud.
   * Splits content into paragraphs and plays each synthesized segment.
   */
  async start(articleId: string, htmlContent: string): Promise<void> {
    // Stop any current playback first (cross-article requirement 10.6)
    if (this.state !== 'idle') {
      this.stop();
    }

    this.currentArticleId = articleId;
    this.paragraphs = this.extractParagraphs(htmlContent);
    this.currentParagraphIndex = 0;
    this.pending.clear();

    if (this.paragraphs.length === 0) {
      this.setState('idle');
      return;
    }

    this.setState('loading');
    this.abortController = new AbortController();
    // Resolve the user's voice preference once per session, so every
    // paragraph uses the same voice and we don't refetch per segment.
    await this.loadPreferredVoice();
    await this.playFrom(0);
  }

  /**
   * Fetch the configured voice from the server and cache it for this
   * session. Failures fall back to 'auto' (script detection) rather
   * than blocking playback — the config request is a nicety, not a
   * prerequisite for speaking.
   */
  private async loadPreferredVoice(): Promise<void> {
    if (this.preferredVoice !== null) return;
    try {
      const res = await fetch('/api/config/tts', { signal: this.abortController?.signal });
      if (res.ok) {
        const data = (await res.json()) as { voice?: string };
        this.preferredVoice = (data.voice ?? '').trim() || 'auto';
        return;
      }
    } catch {
      // fall through to auto
    }
    this.preferredVoice = 'auto';
  }

  /**
   * Pause the current playback.
   */
  pause(): void {
    if (this.state !== 'playing') return;
    this.audioElement?.pause();
    this.setState('paused');
  }

  /**
   * Resume paused playback.
   */
  resume(): void {
    if (this.state !== 'paused') return;
    this.audioElement?.play().catch(() => {
      this.handleError(t('playback_failed'));
    });
    this.setState('playing');
  }

  /**
   * Stop playback completely and release resources.
   * Requirement 10.7: cleanup on navigation.
   */
  stop(): void {
    // Abort any in-flight fetch
    this.abortController?.abort();
    this.abortController = null;
    this.pending.clear();

    this.releaseAudio();

    this.paragraphs = [];
    this.currentParagraphIndex = 0;
    this.currentArticleId = null;
    // Drop the cached voice so a settings change is picked up next time.
    this.preferredVoice = null;

    this.setState('idle');
  }

  /**
   * Destroy this service instance and release all resources.
   */
  destroy(): void {
    this.stop();
    this.onParagraphStart = undefined;
    this.onComplete = undefined;
    this.onStateChange = undefined;
    this.onError = undefined;
  }

  /**
   * Play paragraphs starting at `index`, chaining to the next when each
   * segment ends. One shared abort signal covers the whole session.
   */
  private async playFrom(index: number): Promise<void> {
    const signal = this.abortController?.signal;
    if (!signal || signal.aborted) return;

    for (let i = index; i < this.paragraphs.length; i++) {
      if (signal.aborted || this.currentArticleId === null) return;

      this.currentParagraphIndex = i;
      this.notifyParagraphStart(i);

      // Start the next paragraph's synthesis before playing this one
      if (i + 1 < this.paragraphs.length) {
        this.prefetch(i + 1, signal);
      }

      const blob = await this.synthesize(i, signal);
      if (signal.aborted) return;

      if (!blob) {
        this.handleError(t('tts_request_failed'));
        return;
      }

      const ended = await this.playBlob(blob, signal);
      if (signal.aborted) return;
      if (!ended) {
        // Playback was paused — wait until resumed or stopped.
        const resumed = await this.waitForResume(signal);
        if (!resumed) return;
      }
    }

    // All paragraphs played
    this.onComplete?.();
    this.stop();
  }

  /**
   * Kick off synthesis for a paragraph without awaiting the result.
   */
  private prefetch(index: number, signal: AbortSignal): void {
    if (this.pending.has(index)) return;
    void this.synthesize(index, signal);
  }

  /**
   * Synthesize one paragraph (deduplicated via the pending map).
   * Resolves null on failure.
   */
  private async synthesize(index: number, signal: AbortSignal): Promise<Blob | null> {
    const existing = this.pending.get(index);
    if (existing) {
      return existing;
    }

    const task = (async (): Promise<Blob | null> => {
      try {
        const response = await fetch('/api/tts/synthesis', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: this.paragraphs[index],
            voiceName: resolveVoiceName(this.paragraphs[index], this.preferredVoice),
          }),
          signal,
        });

        if (!response.ok) {
          // Consume the body so the connection is released
          await response.arrayBuffer().catch(() => undefined);
          return null;
        }
        return await response.blob();
      } catch {
        return null;
      }
    })();

    this.pending.set(index, task);
    const result = await task;
    this.pending.delete(index);
    return result;
  }

  /**
   * Play an audio blob and resolve true when it finishes naturally,
   * false when paused or interrupted.
   */
  private playBlob(blob: Blob, signal: AbortSignal): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this.releaseAudio();

      const audio = new Audio();
      this.audioElement = audio;
      this.objectUrl = URL.createObjectURL(blob);
      audio.src = this.objectUrl;

      const cleanup = () => {
        audio.onended = null;
        audio.onerror = null;
        audio.onpause = null;
        signal.removeEventListener('abort', onAbort);
      };

      const onAbort = () => {
        cleanup();
        resolve(false);
      };

      audio.onended = () => {
        cleanup();
        resolve(true);
      };
      audio.onerror = () => {
        cleanup();
        this.handleError(t('playback_failed'));
        resolve(false);
      };
      // Pause triggered outside pause() (e.g. OS media controls) also suspends the loop
      audio.onpause = () => {
        if (this.state === 'playing') {
          this.setState('paused');
          cleanup();
          resolve(false);
        }
      };

      audio.play().catch(() => {
        cleanup();
        this.handleError(t('playback_failed'));
        resolve(false);
      });

      // Stopping while waiting for playback start must not hang the loop
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  /**
   * Suspend the playback loop while paused; resolves false if the session
   * was stopped instead of resumed.
   */
  private waitForResume(signal: AbortSignal): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const onAbort = () => resolve(false);
      signal.addEventListener('abort', onAbort, { once: true });

      const check = setInterval(() => {
        if (signal.aborted) {
          clearInterval(check);
          resolve(false);
        } else if (this.state === 'playing') {
          clearInterval(check);
          resolve(true);
        }
      }, 150);
    });
  }

  /**
   * Stop and release the current audio element and object URL.
   */
  private releaseAudio(): void {
    if (this.audioElement) {
      this.audioElement.onended = null;
      this.audioElement.onerror = null;
      this.audioElement.onpause = null;
      this.audioElement.pause();
      this.audioElement.src = '';
      this.audioElement.load();
      this.audioElement = null;
    }
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
  }

  /**
   * Extract plain-text paragraphs from HTML content.
   * Block-level elements act as paragraph boundaries (requirement 10.4).
   * A block element counts as a paragraph only when it contains no nested
   * block elements; containers are recursed into so each leaf block maps
   * to exactly one paragraph. The indices match the highlight mapping in
   * ReadAloudPlayer.getBlockElements().
   */
  private extractParagraphs(html: string): string[] {
    const div = document.createElement('div');
    div.innerHTML = html;

    const blockTags = new Set([
      'P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
      'LI', 'BLOCKQUOTE', 'PRE', 'SECTION', 'ARTICLE',
      'HEADER', 'FOOTER', 'FIGCAPTION', 'TD', 'TH',
    ]);
    const blockSelector = Array.from(blockTags).join(',');

    const paragraphs: string[] = [];

    function walk(node: Node): void {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as HTMLElement;
        if (blockTags.has(el.tagName)) {
          if (el.querySelector(blockSelector)) {
            // Container block — recurse into its children
            for (const child of Array.from(el.children)) {
              walk(child);
            }
          } else {
            const text = el.textContent?.trim();
            if (text) {
              paragraphs.push(text);
            }
          }
          return;
        }
      }
      // Recurse into children for inline elements
      for (const child of Array.from(node.childNodes)) {
        walk(child);
      }
    }

    walk(div);

    // If no block elements found, treat the whole content as one paragraph
    if (paragraphs.length === 0) {
      const fullText = div.textContent?.trim();
      if (fullText) {
        paragraphs.push(fullText);
      }
    }

    return paragraphs;
  }

  /**
   * Update internal state and notify listener.
   */
  private setState(newState: TTSState): void {
    this.state = newState;
    this.onStateChange?.(newState);
  }

  /**
   * Notify that a new paragraph has started playing.
   */
  private notifyParagraphStart(index: number): void {
    this.currentParagraphIndex = index;
    this.onParagraphStart?.(index);
  }

  /**
   * Handle an error — set state and notify.
   */
  private handleError(message: string): void {
    this.setState('error');
    this.onError?.(message);
  }
}

/**
 * Singleton TTS service instance for global access.
 * Ensures cross-article playback stop works (requirement 10.6).
 */
let globalTTSService: TTSService | null = null;

/**
 * Get (or create) the global TTS service instance.
 * The singleton is rebound to the latest caller's callbacks — only one
 * article plays at a time (start() stops any previous playback), so the
 * most recent player always owns the event stream.
 */
export function getTTSService(options?: TTSOptions): TTSService {
  if (!globalTTSService) {
    globalTTSService = new TTSService(options);
  } else if (options) {
    globalTTSService.setOptions(options);
  }
  return globalTTSService;
}

/**
 * Destroy the global TTS service instance (e.g., on app teardown).
 */
export function destroyTTSService(): void {
  if (globalTTSService) {
    globalTTSService.destroy();
    globalTTSService = null;
  }
}
