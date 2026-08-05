/**
 * TTS (Text-to-Speech) service client.
 * Communicates with a Cloudflare Worker-based read-aloud endpoint.
 * The endpoint URL is configurable since it hasn't been specified yet.
 *
 * Requirements: 10.1, 10.2
 */

export type TTSState = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

export interface TTSChunk {
  /** Index of the paragraph this audio chunk corresponds to */
  paragraphIndex: number;
  /** Audio data as an ArrayBuffer */
  audioData: ArrayBuffer;
}

export interface TTSOptions {
  /** Base URL of the Read-Aloud Worker endpoint */
  endpointUrl: string;
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
 * Default endpoint URL — configurable via settings or environment.
 * This is a stub placeholder until the real endpoint is deployed.
 */
const DEFAULT_TTS_ENDPOINT = '/api/tts/read-aloud';

/**
 * TTSService manages communication with the Read-Aloud Worker
 * and audio playback using the Web Audio API / HTMLAudioElement.
 */
export class TTSService {
  private endpointUrl: string;
  private state: TTSState = 'idle';
  private audioElement: HTMLAudioElement | null = null;
  private abortController: AbortController | null = null;
  private currentArticleId: string | null = null;
  private paragraphs: string[] = [];
  private currentParagraphIndex = 0;
  private audioQueue: Blob[] = [];
  private isProcessingQueue = false;

  private onParagraphStart?: (index: number) => void;
  private onComplete?: () => void;
  private onStateChange?: (state: TTSState) => void;
  private onError?: (error: string) => void;

  constructor(options?: Partial<TTSOptions>) {
    this.endpointUrl = options?.endpointUrl ?? DEFAULT_TTS_ENDPOINT;
    this.onParagraphStart = options?.onParagraphStart;
    this.onComplete = options?.onComplete;
    this.onStateChange = options?.onStateChange;
    this.onError = options?.onError;
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
   * Splits content into paragraphs and streams audio from the TTS endpoint.
   */
  async start(articleId: string, htmlContent: string): Promise<void> {
    // Stop any current playback first (cross-article requirement 10.6)
    if (this.state !== 'idle') {
      this.stop();
    }

    this.currentArticleId = articleId;
    this.paragraphs = this.extractParagraphs(htmlContent);
    this.currentParagraphIndex = 0;
    this.audioQueue = [];
    this.isProcessingQueue = false;

    if (this.paragraphs.length === 0) {
      this.setState('idle');
      return;
    }

    this.setState('loading');
    await this.fetchAndPlay();
  }

  /**
   * Pause the current playback.
   */
  pause(): void {
    if (this.state !== 'playing') return;
    if (this.audioElement) {
      this.audioElement.pause();
    }
    this.setState('paused');
  }

  /**
   * Resume paused playback.
   */
  resume(): void {
    if (this.state !== 'paused') return;
    if (this.audioElement) {
      this.audioElement.play().catch(() => {
        this.handleError('Failed to resume playback');
      });
    }
    this.setState('playing');
  }

  /**
   * Stop playback completely and release resources.
   * Requirement 10.7: cleanup on navigation.
   */
  stop(): void {
    // Abort any in-flight fetch
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    // Stop and release audio element
    if (this.audioElement) {
      this.audioElement.pause();
      this.audioElement.src = '';
      this.audioElement.load();
      this.audioElement = null;
    }

    // Release object URLs
    this.audioQueue = [];
    this.paragraphs = [];
    this.currentParagraphIndex = 0;
    this.currentArticleId = null;
    this.isProcessingQueue = false;

    this.setState('idle');
  }

  /**
   * Update configuration (e.g., endpoint URL changes).
   */
  setEndpointUrl(url: string): void {
    this.endpointUrl = url;
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
   * Fetch audio from the TTS endpoint and play paragraph by paragraph.
   */
  private async fetchAndPlay(): Promise<void> {
    this.abortController = new AbortController();

    try {
      const response = await fetch(this.endpointUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paragraphs: this.paragraphs,
          articleId: this.currentArticleId,
        }),
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`TTS service returned ${response.status}`);
      }

      // Handle streaming response — read chunks as audio segments
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body from TTS service');
      }

      this.setState('playing');
      this.notifyParagraphStart(0);

      await this.processStream(reader);
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        // Stopped intentionally, no error
        return;
      }
      this.handleError(
        err instanceof Error ? err.message : 'Failed to connect to read-aloud service'
      );
    }
  }

  /**
   * Process the streaming response from the TTS endpoint.
   * Each chunk boundary corresponds to a paragraph boundary.
   */
  private async processStream(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
    const chunks: Uint8Array[] = [];
    let paragraphBoundaryMarker = new TextEncoder().encode('\n---PARAGRAPH---\n');

    // Accumulate data and split on paragraph markers
    let buffer = new Uint8Array(0);

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      if (this.state === 'idle') {
        // Stopped while streaming
        reader.cancel();
        return;
      }

      // Append new data to buffer
      const newBuffer = new Uint8Array(buffer.length + value.length);
      newBuffer.set(buffer);
      newBuffer.set(value, buffer.length);
      buffer = newBuffer;

      // Check for paragraph boundary markers in the buffer
      let markerIdx = this.findMarker(buffer, paragraphBoundaryMarker);
      while (markerIdx !== -1) {
        const audioSegment = buffer.slice(0, markerIdx);
        buffer = buffer.slice(markerIdx + paragraphBoundaryMarker.length);

        if (audioSegment.length > 0) {
          this.audioQueue.push(new Blob([audioSegment], { type: 'audio/mpeg' }));
          this.processAudioQueue();
        }

        markerIdx = this.findMarker(buffer, paragraphBoundaryMarker);
      }
    }

    // Any remaining buffer is the last paragraph's audio
    if (buffer.length > 0) {
      this.audioQueue.push(new Blob([buffer], { type: 'audio/mpeg' }));
      this.processAudioQueue();
    }
  }

  /**
   * Find a byte marker in a buffer. Returns index or -1.
   */
  private findMarker(buffer: Uint8Array, marker: Uint8Array): number {
    if (buffer.length < marker.length) return -1;
    outer: for (let i = 0; i <= buffer.length - marker.length; i++) {
      for (let j = 0; j < marker.length; j++) {
        if (buffer[i + j] !== marker[j]) continue outer;
      }
      return i;
    }
    return -1;
  }

  /**
   * Process queued audio blobs, playing them in order.
   */
  private processAudioQueue(): void {
    if (this.isProcessingQueue) return;
    this.isProcessingQueue = true;
    this.playNextInQueue();
  }

  /**
   * Play the next audio blob in the queue.
   */
  private playNextInQueue(): void {
    if (this.state === 'idle' || this.audioQueue.length === 0) {
      this.isProcessingQueue = false;
      if (this.state === 'playing' && this.audioQueue.length === 0) {
        // All paragraphs done
        this.onComplete?.();
        this.stop();
      }
      return;
    }

    const blob = this.audioQueue.shift()!;
    const url = URL.createObjectURL(blob);

    if (!this.audioElement) {
      this.audioElement = new Audio();
    }

    this.audioElement.src = url;
    this.audioElement.onended = () => {
      URL.revokeObjectURL(url);
      this.currentParagraphIndex++;
      if (this.currentParagraphIndex < this.paragraphs.length) {
        this.notifyParagraphStart(this.currentParagraphIndex);
      }
      this.playNextInQueue();
    };

    this.audioElement.onerror = () => {
      URL.revokeObjectURL(url);
      this.handleError('Audio playback error');
    };

    if (this.state === 'playing') {
      this.audioElement.play().catch(() => {
        this.handleError('Failed to play audio');
      });
    }
  }

  /**
   * Extract plain-text paragraphs from HTML content.
   * Uses block-level elements as paragraph boundaries (requirement 10.4).
   */
  private extractParagraphs(html: string): string[] {
    const div = document.createElement('div');
    div.innerHTML = html;

    const blockTags = new Set([
      'P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
      'LI', 'BLOCKQUOTE', 'PRE', 'SECTION', 'ARTICLE',
      'HEADER', 'FOOTER', 'FIGCAPTION', 'TD', 'TH',
    ]);

    const paragraphs: string[] = [];

    function walk(node: Node): void {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as HTMLElement;
        if (blockTags.has(el.tagName)) {
          const text = el.textContent?.trim();
          if (text) {
            paragraphs.push(text);
          }
          return; // Don't recurse into children of block elements
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
 */
export function getTTSService(options?: Partial<TTSOptions>): TTSService {
  if (!globalTTSService) {
    globalTTSService = new TTSService(options);
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
