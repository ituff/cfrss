/**
 * TTS (Text-to-Speech) service — audio playback only.
 *
 * Reads articles aloud through a self-hosted read-aloud Worker
 * (upstream: https://github.com/yy4382/read-aloud, deployed by the user at
 * their own URL). The browser never talks to that Worker directly: requests
 * go through the authenticated proxy POST /api/tts/synthesis, which appends
 * the server-stored API key. The service URL and key are configured in
 * Settings (GET/PUT /api/config/tts).
 *
 * This module deliberately knows nothing about articles or the DOM. The
 * caller hands it speech segments (see tts-utils.buildSegments) and it plays
 * them back to back, prefetching the next one while the current one plays.
 *
 * Two invariants matter for a player that can be paused, seeked and switched
 * mid-sentence:
 *   - Pausing never resolves the in-flight segment. The audio element keeps
 *     its position, so resuming continues the sentence instead of skipping
 *     the rest of it.
 *   - Every playback loop carries a generation token. Once a newer session
 *     starts (start / seek / stop), the old loop can no longer speak, emit a
 *     segment, or fire a late `complete`.
 */

import { resolveVoiceName, type SpeechSegment } from './tts-utils.js';

export type TTSState = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

/** Selectable playback speeds. Also the source of truth for snapping. */
export const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2] as const;

/** Events published by the service. Errors carry an i18n key, not a message. */
export type TTSEvent =
  | { type: 'state'; state: TTSState }
  | { type: 'segment'; index: number; blockIndex: number }
  | { type: 'complete'; articleId: string }
  | { type: 'error'; key: string }
  /** The browser blocked playback until the user interacts (autoplay policy). */
  | { type: 'blocked' };

type Listener = (event: TTSEvent) => void;

/** Result of synthesizing one segment. */
type SynthesisResult =
  | { ok: true; blob: Blob }
  /** `skip`: a 400 from the proxy (bad/oversized text) — move on, don't abort. */
  | { ok: false; skip: boolean };

/** How one segment's playback ended. */
type PlayResult = 'ended' | 'aborted' | 'failed';

/**
 * Synthesis retry schedule, in ms. A read-aloud session fires a request per
 * paragraph and prefetches the next one, so short paragraphs can burst well
 * past a provider's rate limit — a single 429 used to kill the whole article.
 * Three attempts covers the realistic transient window without stalling the
 * listener for long when the service is genuinely down.
 */
const SYNTHESIS_RETRY_DELAYS = [400, 1200] as const;

/** HTTP statuses worth retrying; everything else is a real answer. */
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

/** How long the element may report `playing` without advancing before we retry. */
const STALL_TIMEOUT_MS = 15000;
const STALL_POLL_MS = 2000;

/** `preservesPitch` is standard but still prefixed in some engines. */
interface PitchPreservingAudio extends HTMLAudioElement {
  preservesPitch: boolean;
  webkitPreservesPitch?: boolean;
  mozPreservesPitch?: boolean;
}

export class TTSService {
  private state: TTSState = 'idle';
  private audioElement: PitchPreservingAudio | null = null;
  private abortController: AbortController | null = null;
  private objectUrl: string | null = null;

  private articleId: string | null = null;
  private segments: SpeechSegment[] = [];
  private currentIndex = 0;

  /**
   * Bumped by every start / seek / stop. A loop captured with an older token
   * returns as soon as it notices, so a superseded session can never keep
   * speaking or complete the wrong article.
   */
  private generation = 0;

  /** In-flight synthesis requests, keyed by segment index. */
  private pending = new Map<number, Promise<SynthesisResult>>();

  /**
   * User-selected voice, fetched once per session and reused for every
   * segment. Null means "not loaded yet"; 'auto' means script detection.
   */
  private preferredVoice: string | null = null;

  private rate = 1;

  private listeners = new Set<Listener>();

  // ------------------------------------------------------------ public API

  /** Subscribe to playback events. Returns an unsubscribe function. */
  on(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getState(): TTSState {
    return this.state;
  }

  getCurrentArticleId(): string | null {
    return this.articleId;
  }

  /** Index of the segment being spoken. */
  getSegmentIndex(): number {
    return this.currentIndex;
  }

  /** Paragraph index of the segment being spoken (for highlighting). */
  getBlockIndex(): number {
    return this.segments[this.currentIndex]?.blockIndex ?? 0;
  }

  getSegments(): readonly SpeechSegment[] {
    return this.segments;
  }

  getRate(): number {
    return this.rate;
  }

  /**
   * Position inside the current segment. `currentTime` is media time, so at
   * 2x it advances twice as fast as the wall clock.
   */
  getPosition(): { currentTime: number; duration: number } | null {
    const audio = this.audioElement;
    // `src` is cleared on teardown, so a finished session reports nothing
    // rather than the stale position of the last segment.
    if (!audio || !audio.src) return null;
    const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
    return { currentTime: audio.currentTime || 0, duration };
  }

  /**
   * Set the playback speed. Applies to the segment playing right now and to
   * every segment created afterwards. Pitch is preserved.
   */
  setRate(rate: number): void {
    this.rate = snapRate(rate);
    if (this.audioElement) {
      this.audioElement.playbackRate = this.rate;
    }
  }

  /**
   * Start a session. `startIndex` resumes at a saved position.
   * Resolves when playback ends, is stopped, or fails.
   */
  async start(
    articleId: string,
    segments: readonly SpeechSegment[],
    startIndex = 0
  ): Promise<void> {
    this.teardown();

    this.articleId = articleId;
    this.segments = [...segments];
    this.currentIndex = clampIndex(startIndex, this.segments.length);

    if (this.segments.length === 0) {
      this.setState('idle');
      return;
    }

    this.setState('loading');

    const gen = this.generation;
    const controller = new AbortController();
    this.abortController = controller;

    await this.loadPreferredVoice(controller.signal);
    if (!this.isCurrent(gen, controller.signal)) return;

    await this.run(gen, controller.signal, this.currentIndex);
  }

  /** Pause the current segment without losing its position. */
  pause(): void {
    if (this.state !== 'playing') return;
    this.audioElement?.pause();
    this.setState('paused');
  }

  /** Resume the paused segment from exactly where it stopped. */
  resume(): void {
    if (this.state !== 'paused') return;
    const audio = this.audioElement;
    if (!audio) {
      this.setState('paused');
      return;
    }
    void audio.play().catch((error: unknown) => {
      // A pause racing a pending play() rejects with AbortError — expected.
      if ((error as { name?: string } | null)?.name === 'AbortError') return;
      this.handleError('playback_failed');
    });
    this.setState('playing');
  }

  /** Jump to a segment and keep playing from its start. */
  seekToSegment(index: number): void {
    if (this.segments.length === 0) return;

    const target = clampIndex(index, this.segments.length);
    this.teardown();
    this.currentIndex = target;

    const gen = this.generation;
    const controller = new AbortController();
    this.abortController = controller;

    // No `loading` flash: the target is usually already prefetched, and a
    // spinner on every scrub tick is worse than a short silence.
    this.setState('playing');
    void this.run(gen, controller.signal, target);
  }

  /** Stop playback, release resources and reset the session. */
  stop(): void {
    this.teardown();
    this.articleId = null;
    this.segments = [];
    this.currentIndex = 0;
    // Drop the cached voice so a settings change is picked up next time.
    this.preferredVoice = null;
    this.setState('idle');
  }

  /** Stop and drop every listener. */
  destroy(): void {
    this.stop();
    this.listeners.clear();
  }

  // -------------------------------------------------------------- internals

  /**
   * Play segments from `from`, chaining to the next when each one ends.
   * One abort signal and one generation token cover the whole session.
   */
  private async run(gen: number, signal: AbortSignal, from: number): Promise<void> {
    for (let i = from; i < this.segments.length; i++) {
      if (!this.isCurrent(gen, signal)) return;

      this.currentIndex = i;
      this.emit({ type: 'segment', index: i, blockIndex: this.segments[i].blockIndex });

      if (i + 1 < this.segments.length) {
        this.prefetch(i + 1, gen, signal);
      }

      const result = await this.synthesize(i, gen, signal);
      if (!this.isCurrent(gen, signal)) return;

      if (!result.ok) {
        if (result.skip) continue;
        this.handleError('tts_request_failed');
        return;
      }

      let played = await this.playBlob(result.blob, signal);
      if (!this.isCurrent(gen, signal)) return;

      if (played === 'failed') {
        // A truncated or undecodable response is indistinguishable from a
        // transient failure at this level, so re-synthesize once and retry
        // the segment instead of dropping the listener out of playback.
        console.warn('[cfrss/tts] segment playback failed, retrying', { index: i });
        this.pending.delete(i);
        const retry = await this.synthesize(i, gen, signal);
        if (!this.isCurrent(gen, signal)) return;
        if (!retry.ok) {
          if (retry.skip) continue;
          this.handleError('tts_request_failed');
          return;
        }
        played = await this.playBlob(retry.blob, signal);
        if (!this.isCurrent(gen, signal)) return;
      }

      if (played === 'failed') {
        this.handleError('playback_failed');
        return;
      }
      // 'aborted' means stop / seek superseded this loop — the generation
      // check above has already returned in that case. A pause never resolves.
      if (played === 'aborted') return;
    }

    if (!this.isCurrent(gen, signal)) return;

    const articleId = this.articleId ?? '';
    const token = this.generation;
    this.emit({ type: 'complete', articleId });
    // A listener may have started the next article synchronously; if so this
    // session is already stale and must not reset the new one.
    if (token !== this.generation) return;

    this.teardown();
    this.articleId = null;
    this.segments = [];
    this.currentIndex = 0;
    this.setState('idle');
  }

  private isCurrent(gen: number, signal: AbortSignal): boolean {
    return gen === this.generation && !signal.aborted;
  }

  /** Kick off synthesis for a segment without awaiting it. */
  private prefetch(index: number, gen: number, signal: AbortSignal): void {
    if (this.pending.has(index)) return;
    void this.synthesize(index, gen, signal);
  }

  /** Synthesize one segment, deduplicated through the pending map. */
  private synthesize(index: number, _gen: number, signal: AbortSignal): Promise<SynthesisResult> {
    const existing = this.pending.get(index);
    if (existing) return existing;

    const task = this.requestSynthesis(index, signal);

    this.pending.set(index, task);
    void task.then(() => {
      if (this.pending.get(index) === task) {
        this.pending.delete(index);
      }
    });

    return task;
  }

  /**
   * One segment's audio, retried on transient failures.
   *
   * The previous implementation treated every non-400 response as fatal, which
   * meant a single 429 from the provider (or one dropped connection) stopped
   * the article dead. Those are exactly the failures worth retrying: the text
   * has not changed and the next attempt usually succeeds.
   */
  private async requestSynthesis(index: number, signal: AbortSignal): Promise<SynthesisResult> {
    const segment = this.segments[index];
    if (!segment) return { ok: false, skip: false };

    const body = JSON.stringify({
      text: segment.text,
      voiceName: resolveVoiceName(segment.text, this.preferredVoice),
    });

    for (let attempt = 0; attempt <= SYNTHESIS_RETRY_DELAYS.length; attempt++) {
      if (signal.aborted) return { ok: false, skip: false };

      try {
        const response = await fetch('/api/tts/synthesis', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          signal,
        });

        if (response.ok) {
          return { ok: true, blob: await response.blob() };
        }

        // Drain the body so the connection is released.
        await response.arrayBuffer().catch(() => undefined);

        // 400 = the text was rejected. Skip it rather than killing the
        // article; buildSegments() keeps requests well under the cap, so this
        // is a safety net.
        if (response.status === 400) return { ok: false, skip: true };
        if (!RETRYABLE_STATUS.has(response.status)) return { ok: false, skip: false };
      } catch {
        // Network error / aborted request. Aborts are not retried.
        if (signal.aborted) return { ok: false, skip: false };
      }

      const wait = SYNTHESIS_RETRY_DELAYS[attempt];
      if (wait === undefined) break;

      console.warn('[cfrss/tts] synthesis failed, retrying in %dms', wait, { index });
      await delay(wait, signal);
    }

    return { ok: false, skip: false };
  }

  /**
   * Play one blob. Resolves `'ended'` when it finishes, `'aborted'` when the
   * session was superseded, `'failed'` when the audio could not be played.
   *
   * Pausing does NOT resolve — the element keeps its position, so resuming
   * continues the sentence instead of skipping the rest of it. A browser
   * blocked `play()` is treated the same way: the element stays parked and the
   * listener's next tap resumes the exact same spot.
   */
  private playBlob(blob: Blob, signal: AbortSignal): Promise<PlayResult> {
    return new Promise<PlayResult>((resolve) => {
      const audio = this.ensureAudio();
      this.detachAudioHandlers(audio);
      this.releaseObjectUrl();

      this.objectUrl = URL.createObjectURL(blob);
      audio.src = this.objectUrl;

      // Keep the voice natural at non-1x speeds.
      audio.preservesPitch = true;
      audio.webkitPreservesPitch = true;
      audio.mozPreservesPitch = true;
      audio.playbackRate = this.rate;

      let settled = false;
      let watchdog: ReturnType<typeof setInterval> | null = null;
      let lastProgressAt = Date.now();
      let lastTime = -1;

      const cleanup = (): void => {
        this.detachAudioHandlers(audio);
        if (watchdog !== null) {
          globalThis.clearInterval(watchdog);
          watchdog = null;
        }
        signal.removeEventListener('abort', onAbort);
      };

      const settle = (result: PlayResult): void => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(result);
      };

      const onAbort = (): void => settle('aborted');

      // A stalled element keeps reporting "playing" but never advances. That
      // is a silent hang rather than an error, and retrying is the only way
      // out — without this the bar would sit there pretending to play.
      watchdog = globalThis.setInterval(() => {
        if (settled) return;

        if (audio.paused) {
          lastProgressAt = Date.now();
          return;
        }
        if (audio.currentTime !== lastTime) {
          lastTime = audio.currentTime;
          lastProgressAt = Date.now();
          return;
        }
        if (Date.now() - lastProgressAt >= STALL_TIMEOUT_MS) {
          console.warn('[cfrss/tts] playback stalled, retrying segment');
          settle('failed');
        }
      }, STALL_POLL_MS);

      audio.onended = () => settle('ended');
      audio.onerror = () => {
        console.warn('[cfrss/tts] audio element error', audio.error?.code);
        settle('failed');
      };
      // Pause triggered outside pause() (OS media keys, audio focus loss, the
      // tab being backgrounded) suspends the state but leaves the promise
      // pending, exactly like a user-initiated pause.
      audio.onpause = () => {
        if (!audio.ended && this.state === 'playing') {
          this.setState('paused');
        }
      };

      // The state must flip to `playing` here, not in start(): every consumer
      // (pause, the progress ticker, the external-pause handler) keys off it.
      // Leaving it at `loading` used to make pause a no-op and turned every
      // browser-initiated pause into a dead end.
      this.setState('playing');

      void audio.play().catch((error: unknown) => {
        const name = (error as { name?: string } | null)?.name;

        if (name === 'AbortError') {
          settle('aborted');
          return;
        }

        if (name === 'NotAllowedError') {
          // Autoplay policy. Park in `paused` and keep the promise pending so
          // the next tap resumes this element instead of restarting the
          // article; the UI explains why nothing is audible.
          console.warn('[cfrss/tts] playback blocked by autoplay policy');
          this.setState('paused');
          this.emit({ type: 'blocked' });
          return;
        }

        console.warn('[cfrss/tts] play() rejected', name);
        settle('failed');
      });

      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  /**
   * Fetch the configured voice once per session. Failures fall back to
   * 'auto' (script detection) rather than blocking playback.
   */
  private async loadPreferredVoice(signal: AbortSignal): Promise<void> {
    if (this.preferredVoice !== null) return;
    try {
      const res = await fetch('/api/config/tts', { signal });
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

  /** Invalidate the current session and release its resources. */
  private teardown(): void {
    this.generation++;
    this.abortController?.abort();
    this.abortController = null;
    this.pending.clear();
    this.resetAudio();
  }

  /**
   * The session's audio element, created once and reused for every segment.
   *
   * Reuse is not an optimisation: mobile browsers "unlock" a media element on
   * the first user gesture, and a brand-new element per segment loses that
   * unlock — which is one of the ways playback dies partway through a long
   * article on a phone.
   */
  private ensureAudio(): PitchPreservingAudio {
    if (!this.audioElement) {
      const audio = new Audio() as PitchPreservingAudio;
      audio.preload = 'auto';
      this.audioElement = audio;
    }
    return this.audioElement;
  }

  private detachAudioHandlers(audio: PitchPreservingAudio): void {
    audio.onended = null;
    audio.onerror = null;
    audio.onpause = null;
  }

  private releaseObjectUrl(): void {
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
  }

  /**
   * Stop the element without throwing it away — detaching the handlers first
   * keeps teardown from firing `onpause` and flipping the state.
   */
  private resetAudio(): void {
    const audio = this.audioElement;
    if (audio) {
      this.detachAudioHandlers(audio);
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
    this.releaseObjectUrl();
  }

  private setState(state: TTSState): void {
    if (this.state === state) return;
    this.state = state;
    this.emit({ type: 'state', state });
  }

  private handleError(key: string): void {
    this.state = 'error';
    this.emit({ type: 'state', state: 'error' });
    this.emit({ type: 'error', key });
  }

  private emit(event: TTSEvent): void {
    for (const listener of Array.from(this.listeners)) {
      listener(event);
    }
  }
}

/** Abortable sleep — resolves early when the session is torn down. */
function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }

    const finish = (): void => {
      globalThis.clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };

    const timer = globalThis.setTimeout(finish, ms);
    signal.addEventListener('abort', finish, { once: true });
  });
}

/** Snap an arbitrary value to the nearest supported speed. */
export function snapRate(value: number): number {
  if (!Number.isFinite(value)) return 1;
  let best: number = RATES[0];
  let bestDelta = Math.abs(value - best);
  for (const candidate of RATES) {
    const delta = Math.abs(value - candidate);
    if (delta < bestDelta) {
      best = candidate;
      bestDelta = delta;
    }
  }
  return best;
}

function clampIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  if (!Number.isFinite(index)) return 0;
  return Math.min(Math.max(0, Math.trunc(index)), length - 1);
}

/**
 * Singleton TTS service instance. Only one article plays at a time, so a
 * single shared audio engine is enough — and it is what lets the floating
 * player outlive any single article view.
 */
let globalTTSService: TTSService | null = null;

/** Get (or create) the global TTS service. */
export function getTTSService(): TTSService {
  if (!globalTTSService) {
    globalTTSService = new TTSService();
  }
  return globalTTSService;
}

/** Destroy the global TTS service instance (e.g. on app teardown). */
export function destroyTTSService(): void {
  if (globalTTSService) {
    globalTTSService.destroy();
    globalTTSService = null;
  }
}
