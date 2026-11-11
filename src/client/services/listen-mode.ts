/**
 * ListenMode — the read-aloud session that outlives a single article view.
 *
 * Owns:
 *   - the playback queue: a snapshot of the current feed filter, newest first
 *   - automatic advance to the next (older) article when one finishes
 *   - per-article resume positions and a "listened" set, persisted locally
 *   - the playback speed shared by the floating bar and the full-screen view
 *
 * Audio itself comes from TTSService (one segment at a time); this module
 * only decides *what* plays *when*. It never touches the DOM and never
 * navigates — the route is the user's, not the player's.
 */

import { getArticles, getArticleDetail } from './api.js';
import { extractBlocksFromHtml, buildSegments, type SpeechSegment } from './tts-utils.js';
import { getTTSService } from './tts.js';
import { getCurrentRoute } from '../router.js';
import {
  queueFilterFromQuery,
  mergeSeedIntoQueue,
  cycleRate as cycleRateValue,
  normalizeRate,
  articleProgress,
  segmentForRatio,
  LISTEN_STORAGE_KEY,
  emptyListenStore,
  parseListenStore,
  recordPosition,
  markListened,
  type ListenStore,
} from './listen-utils.js';
import type { Article } from '../../types/index.js';

/** One entry in the playback queue. */
export interface ListenItem {
  id: string;
  title: string;
  author: string;
  publishedAt: string;
  subscriptionId?: string;
  /** Feed summary — used as the body when full content is unavailable. */
  summary?: string;
}

export type ListenStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

/** Immutable view of the session, consumed by the player. */
export interface ListenSnapshot {
  status: ListenStatus;
  /** The article being listened to (kept after it finishes, for the "finished" label). */
  item: ListenItem | null;
  queue: readonly ListenItem[];
  /** Index of `item` inside `queue`, -1 when idle. */
  index: number;
  /** Paragraph texts of the current article. */
  blocks: readonly string[];
  /** Paragraph being spoken. */
  blockIndex: number;
  segmentIndex: number;
  segmentCount: number;
  /** 0–1 across the whole article. */
  progress: number;
  rate: number;
  errorKey: string | null;
  listened: readonly string[];
  /** Playback reached the end of the last article. */
  atQueueEnd: boolean;
  /** The current article was played to the end. */
  finished: boolean;
  /** The full-screen view is open. */
  expanded: boolean;
}

type Listener = (snapshot: ListenSnapshot) => void;

/** How many articles the queue pulls. */
const QUEUE_LIMIT = 60;

/** Silence between two articles, so the switch does not feel abrupt. */
const AUTO_NEXT_DELAY_MS = 300;

/** How many consecutive content-less articles to skip before giving up. */
const MAX_EMPTY_SKIPS = 3;

/** Progress refresh cadence while playing. */
const TICK_MS = 250;

function toItem(article: Article): ListenItem {
  return {
    id: article.id,
    title: article.title,
    author: article.author,
    publishedAt: article.publishedAt,
    subscriptionId: article.subscriptionId,
    summary: article.summary,
  };
}

class ListenModeController {
  private readonly tts = getTTSService();

  private queue: ListenItem[] = [];
  private index = -1;
  private item: ListenItem | null = null;

  private blocks: string[] = [];
  private segments: SpeechSegment[] = [];
  private segmentIndex = 0;
  private blockIndex = 0;

  private status: ListenStatus = 'idle';
  private errorKey: string | null = null;
  private atQueueEnd = false;
  private finished = false;
  private expanded = false;

  private rate = 1;
  private store: ListenStore = emptyListenStore();
  private storeLoaded = false;

  private listeners = new Set<Listener>();
  private ticker: number | null = null;
  private nextTimer: number | null = null;

  /** Guards against a slow article fetch overwriting a newer request. */
  private requestId = 0;
  private emptySkips = 0;

  constructor() {
    this.tts.on((event) => {
      switch (event.type) {
        case 'state':
          this.status = event.state;
          this.syncTicker();
          this.publish();
          break;
        case 'segment':
          this.segmentIndex = event.index;
          this.blockIndex = event.blockIndex;
          this.savePosition();
          this.publish();
          break;
        case 'complete':
          this.handleComplete();
          break;
        case 'error':
          this.status = 'error';
          this.errorKey = event.key;
          this.syncTicker();
          this.publish();
          break;
        case 'blocked':
          // The browser wants a gesture. Stay paused with an explanation so
          // the play button resumes the same spot instead of looking broken.
          this.status = 'paused';
          this.errorKey = 'listen_need_tap';
          this.syncTicker();
          this.publish();
          break;
      }
    });

    this.loadStore();
    this.tts.setRate(this.rate);
  }

  // ------------------------------------------------------------- session API

  /**
   * Start listening to `seed`. Builds the queue around it when needed, then
   * plays from the saved position (or the beginning).
   *
   * Playback starts on the floating bar, not in the full-screen view: the
   * user is mid-article when they press Read Aloud, and covering the text
   * they were reading would be hostile. The view opens on demand.
   */
  async start(seed: ListenItem): Promise<void> {
    this.finished = false;
    this.atQueueEnd = false;
    this.errorKey = null;
    this.publish();

    await this.ensureQueue(seed);
    await this.playAt(this.index);
  }

  /**
   * Build the queue around `seed` unless it is already part of one.
   *
   * The queue is a snapshot taken at session start, scoped to the feed or
   * category the user is currently looking at, and is not reordered while the
   * session runs — hearing the order change mid-session is disorienting.
   */
  private async ensureQueue(seed: ListenItem): Promise<void> {
    const existing = this.queue.findIndex((entry) => entry.id === seed.id);
    if (existing >= 0) {
      this.index = existing;
      this.item = this.queue[existing];
      return;
    }

    const filter = queueFilterFromQuery(getCurrentRoute().query);
    let items: ListenItem[] = [];

    try {
      const response = await getArticles({ ...filter, limit: QUEUE_LIMIT });
      items = response.articles.map(toItem);
    } catch {
      // Offline / API failure: still let the user listen to this one article.
      items = [];
    }

    this.queue = mergeSeedIntoQueue(items, seed);
    this.index = this.queue.findIndex((entry) => entry.id === seed.id);
    if (this.index < 0) this.index = 0;
    this.item = this.queue[this.index] ?? seed;
    this.publish();
  }

  /** Load and play the article at `index` in the queue. */
  private async playAt(index: number): Promise<void> {
    const item = this.queue[index];
    if (!item) {
      this.finishQueue();
      return;
    }

    const request = ++this.requestId;
    this.cancelNextTimer();

    this.index = index;
    this.item = item;
    this.blocks = [];
    this.segments = [];
    this.segmentIndex = 0;
    this.blockIndex = 0;
    this.status = 'loading';
    this.errorKey = null;
    this.finished = false;
    this.atQueueEnd = false;
    this.publish();

    let html = '';
    try {
      const detail = await getArticleDetail(item.id);
      html = detail.htmlContent || detail.summary || item.summary || '';
    } catch {
      if (request !== this.requestId) return;
      this.fail('load_article_failed');
      return;
    }
    if (request !== this.requestId) return;

    const blocks = extractBlocksFromHtml(html);
    if (blocks.length === 0) {
      this.emptySkips += 1;
      if (this.emptySkips <= MAX_EMPTY_SKIPS && index + 1 < this.queue.length) {
        await this.playAt(index + 1);
        return;
      }
      this.fail('listen_no_content');
      return;
    }
    this.emptySkips = 0;

    this.blocks = blocks;
    this.segments = buildSegments(blocks);

    const saved = this.store.positions[item.id];
    const startSegment = saved
      ? Math.min(Math.max(0, saved.segment), this.segments.length - 1)
      : 0;

    this.tts.setRate(this.rate);
    this.publish();
    // Resolves when the whole article has been read; not awaited on purpose.
    void this.tts.start(item.id, this.segments, startSegment);
  }

  /** Play / pause, or recover from an error or a finished article. */
  toggle(): void {
    if (this.status === 'playing') {
      this.tts.pause();
      return;
    }

    if (this.status === 'paused') {
      this.errorKey = null;
      this.tts.resume();
      return;
    }

    if (!this.item) return;

    this.errorKey = null;

    // The article is still loaded — restart the audio engine where it stopped
    // instead of re-fetching the article. This is the "tap play to continue"
    // path after a failure, and it must not cost a network round trip.
    if (this.segments.length > 0 && this.tts.getCurrentArticleId() === this.item.id) {
      this.tts.start(this.item.id, this.segments, this.segmentIndex);
      return;
    }

    void this.playAt(this.index >= 0 ? this.index : 0);
  }

  /** Move to the next (older) article. */
  next(): void {
    this.cancelNextTimer();
    if (this.index + 1 >= this.queue.length) {
      this.finishQueue();
      return;
    }
    void this.playAt(this.index + 1);
  }

  /** Move to the previous (newer) article, or back to the start of this one. */
  prev(): void {
    this.cancelNextTimer();
    if (this.segmentIndex > 1 || this.index <= 0) {
      this.tts.seekToSegment(0);
      this.segmentIndex = 0;
      this.blockIndex = 0;
      this.publish();
      return;
    }
    void this.playAt(this.index - 1);
  }

  /** Jump to a queue position. */
  jumpTo(index: number): void {
    if (index < 0 || index >= this.queue.length) return;
    void this.playAt(index);
  }

  /** Jump to a segment of the current article. */
  seekToSegment(index: number): void {
    if (this.segments.length === 0) return;
    this.tts.seekToSegment(index);
  }

  /** Seek by clicking or dragging the progress bar. */
  seekToRatio(ratio: number): void {
    const count = this.segments.length;
    if (count === 0) return;
    this.seekToSegment(segmentForRatio(ratio, count));
  }

  /** Set an explicit speed. */
  setRate(rate: number): void {
    this.rate = normalizeRate(rate);
    this.tts.setRate(this.rate);
    this.saveStore({ ...this.store, rate: this.rate });
    this.publish();
  }

  /** Advance to the next preset speed (wrapping). */
  cycleRate(): void {
    this.setRate(cycleRateValue(this.rate, 1));
  }

  /** Open or close the full-screen view. Closing does not stop playback. */
  setExpanded(expanded: boolean): void {
    this.expanded = expanded;
    this.publish();
  }

  /** End the session: stop audio, clear the article and hide the player. */
  stop(): void {
    this.cancelNextTimer();
    this.requestId += 1;
    this.tts.stop();
    this.item = null;
    this.index = -1;
    this.blocks = [];
    this.segments = [];
    this.segmentIndex = 0;
    this.blockIndex = 0;
    this.status = 'idle';
    this.errorKey = null;
    this.atQueueEnd = false;
    this.finished = false;
    this.expanded = false;
    this.emptySkips = 0;
    this.publish();
  }

  /** Whether `articleId` is the article currently being listened to. */
  isListeningTo(articleId: string): boolean {
    // Deliberately ignores `status`: after an article ends the session keeps
    // it on screen, so the toolbar button should stay highlighted.
    return this.item?.id === articleId;
  }

  getSnapshot(): ListenSnapshot {
    return {
      status: this.status,
      item: this.item,
      queue: this.queue,
      index: this.index,
      blocks: this.blocks,
      blockIndex: this.blockIndex,
      segmentIndex: this.segmentIndex,
      segmentCount: this.segments.length,
      progress: this.computeProgress(),
      rate: this.rate,
      errorKey: this.errorKey,
      listened: this.store.listened,
      atQueueEnd: this.atQueueEnd,
      finished: this.finished,
      expanded: this.expanded,
    };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  // --------------------------------------------------------------- internals

  private handleComplete(): void {
    if (!this.item) return;

    this.store = markListened(this.store, this.item.id);
    this.saveStore(this.store);

    this.finished = true;
    this.publish();

    this.cancelNextTimer();
    this.nextTimer = window.setTimeout(() => {
      this.nextTimer = null;
      this.next();
    }, AUTO_NEXT_DELAY_MS);
  }

  /** No more articles: keep the last one on screen with an explicit label. */
  private finishQueue(): void {
    this.cancelNextTimer();
    this.atQueueEnd = true;
    this.tts.stop();
    this.publish();
  }

  private fail(key: string): void {
    this.status = 'error';
    this.errorKey = key;
    this.syncTicker();
    this.publish();
  }

  private computeProgress(): number {
    const count = this.segments.length;
    if (count === 0) return 0;
    const position = this.tts.getPosition();
    const within = position && position.duration > 0 ? position.currentTime / position.duration : 0;
    return articleProgress(this.segmentIndex, count, within);
  }

  /** Run the ticker only while playing — a paused player must not burn battery. */
  private syncTicker(): void {
    const shouldTick = this.status === 'playing';
    if (shouldTick && this.ticker === null) {
      this.ticker = window.setInterval(() => this.publish(), TICK_MS);
    } else if (!shouldTick && this.ticker !== null) {
      window.clearInterval(this.ticker);
      this.ticker = null;
    }
  }

  private cancelNextTimer(): void {
    if (this.nextTimer !== null) {
      window.clearTimeout(this.nextTimer);
      this.nextTimer = null;
    }
  }

  private publish(): void {
    const snapshot = this.getSnapshot();
    for (const listener of Array.from(this.listeners)) {
      listener(snapshot);
    }
  }

  // ------------------------------------------------------------- persistence

  private loadStore(): void {
    if (this.storeLoaded) return;
    this.storeLoaded = true;

    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(LISTEN_STORAGE_KEY);
    } catch {
      // Storage disabled (private mode) — run with defaults.
    }
    this.store = parseListenStore(raw);
    this.rate = this.store.rate;
  }

  private saveStore(next: ListenStore): void {
    this.store = next;
    try {
      window.localStorage.setItem(LISTEN_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Storage full or disabled — a resume point is a nicety, not a promise.
    }
  }

  /** Persist the current segment once per segment change. */
  private savePosition(): void {
    if (!this.item) return;
    this.store = recordPosition(this.store, this.item.id, this.segmentIndex, this.blockIndex, Date.now());
    this.saveStore(this.store);
  }
}

let controller: ListenModeController | null = null;

function getController(): ListenModeController {
  if (!controller) controller = new ListenModeController();
  return controller;
}

// === Module-level API ===
//
// The UI talks to the session through these, so no component holds a
// reference to the controller and nothing can be re-created by a re-render.

export function getListenSnapshot(): ListenSnapshot {
  return getController().getSnapshot();
}

export function subscribeListen(listener: Listener): () => void {
  return getController().subscribe(listener);
}

export function startListening(seed: ListenItem): Promise<void> {
  return getController().start(seed);
}

export function toggleListenPlayback(): void {
  getController().toggle();
}

export function nextListenArticle(): void {
  getController().next();
}

export function prevListenArticle(): void {
  getController().prev();
}

export function jumpToListenIndex(index: number): void {
  getController().jumpTo(index);
}

export function seekListenToSegment(index: number): void {
  getController().seekToSegment(index);
}

export function seekListenToRatio(ratio: number): void {
  getController().seekToRatio(ratio);
}

export function setListenRate(rate: number): void {
  getController().setRate(rate);
}

export function cycleListenRate(): void {
  getController().cycleRate();
}

export function setListenExpanded(expanded: boolean): void {
  getController().setExpanded(expanded);
}

export function stopListening(): void {
  getController().stop();
}

export function isListeningTo(articleId: string): boolean {
  return getController().isListeningTo(articleId);
}
