/**
 * Pure helpers for the listen session — queue shaping, speed cycling,
 * progress maths and the persisted session state.
 *
 * Everything here is deterministic and DOM-free so it can be unit-tested in
 * the Workers pool, which has neither `localStorage` nor `document`.
 * `listen-mode.ts` owns the side effects; this module owns the decisions.
 */

import { RATES, snapRate } from './tts.js';

/** Filter implied by the current route, used to scope the playback queue. */
export interface QueueFilter {
  subscriptionId?: string;
  categoryId?: string;
}

/**
 * Read the queue filter out of a route query.
 *
 * Mirrors `filterFromRoute()` in main-view.ts: `subscription` wins over
 * `category`, and an absent/blank value means "no filter".
 */
export function queueFilterFromQuery(query: Record<string, string>): QueueFilter {
  const subscriptionId = (query.subscription ?? '').trim();
  if (subscriptionId) return { subscriptionId };

  const categoryId = (query.category ?? '').trim();
  if (categoryId) return { categoryId };

  return {};
}

/**
 * Put the seed article at the head of the queue when the fetched page does
 * not contain it (e.g. it is older than the page, or the list request
 * failed). Existing order is preserved — the API already returns
 * newest-first, and re-sorting on equal timestamps would shuffle articles.
 */
export function mergeSeedIntoQueue<T extends { id: string }>(items: T[], seed: T): T[] {
  if (items.some((item) => item.id === seed.id)) return items;
  return [seed, ...items];
}

/** Coerce anything into a supported speed, falling back to 1x. */
export function normalizeRate(value: unknown): number {
  return typeof value === 'number' ? snapRate(value) : 1;
}

/** Next/previous speed in the preset list, wrapping at both ends. */
export function cycleRate(current: number, direction: 1 | -1): number {
  const snapped = snapRate(current);
  const index = RATES.indexOf(snapped as (typeof RATES)[number]);
  const start = index < 0 ? RATES.indexOf(1) : index;
  const next = (start + direction + RATES.length) % RATES.length;
  return RATES[next];
}

/**
 * Fraction of the article already spoken, 0–1.
 * `ratio` is the position inside the current segment.
 */
export function articleProgress(
  segmentIndex: number,
  segmentCount: number,
  ratio: number
): number {
  if (segmentCount <= 0) return 0;

  const index = Number.isFinite(segmentIndex)
    ? Math.min(Math.max(0, Math.trunc(segmentIndex)), segmentCount - 1)
    : 0;
  const within = Number.isFinite(ratio) ? Math.min(Math.max(0, ratio), 1) : 0;

  return Math.min(1, (index + within) / segmentCount);
}

/** Segment index for a 0–1 scrub position. Always a valid index. */
export function segmentForRatio(ratio: number, segmentCount: number): number {
  if (segmentCount <= 0) return 0;

  const clamped = Number.isFinite(ratio) ? Math.min(Math.max(0, ratio), 1) : 0;
  return Math.min(segmentCount - 1, Math.floor(clamped * segmentCount));
}

/** `mm:ss` for an elapsed position. */
export function formatClock(seconds: number): string {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes < 10 ? '0' : ''}${minutes}:${rest < 10 ? '0' : ''}${rest}`;
}

// === Persisted session state ===

export const LISTEN_STORAGE_KEY = 'cfrss.listen.state';

/** Where the user stopped inside one article. */
export interface ListenPosition {
  /** Index into the article's speech segments. */
  segment: number;
  /** Index into the article's paragraphs (what the reader view shows). */
  block: number;
  /** Epoch ms — used to evict the oldest entries first. */
  at: number;
}

export interface ListenStore {
  version: 1;
  rate: number;
  positions: Record<string, ListenPosition>;
  listened: string[];
}

/** How many entries survive a prune. */
export const LISTEN_STORE_LIMITS = { positions: 100, listened: 200 } as const;

export function emptyListenStore(): ListenStore {
  return { version: 1, rate: 1, positions: {}, listened: [] };
}

/**
 * Parse persisted state, discarding anything malformed. A corrupt or
 * future-version payload starts a fresh session rather than throwing.
 */
export function parseListenStore(raw: string | null): ListenStore {
  const store = emptyListenStore();
  if (!raw) return store;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return store;
  }

  if (!parsed || typeof parsed !== 'object') return store;
  const candidate = parsed as Partial<ListenStore>;
  if (candidate.version !== 1) return store;

  store.rate = normalizeRate(candidate.rate);

  if (Array.isArray(candidate.listened)) {
    store.listened = candidate.listened.filter(
      (id): id is string => typeof id === 'string' && id.length > 0
    );
  }

  if (candidate.positions && typeof candidate.positions === 'object') {
    for (const [id, value] of Object.entries(candidate.positions)) {
      if (!value || typeof value !== 'object') continue;
      const entry = value as Partial<ListenPosition>;
      if (
        typeof entry.segment !== 'number' ||
        typeof entry.block !== 'number' ||
        !Number.isFinite(entry.segment) ||
        !Number.isFinite(entry.block)
      ) {
        continue;
      }
      store.positions[id] = {
        segment: Math.max(0, Math.trunc(entry.segment)),
        block: Math.max(0, Math.trunc(entry.block)),
        at: typeof entry.at === 'number' && Number.isFinite(entry.at) ? entry.at : 0,
      };
    }
  }

  return pruneListenStore(store);
}

/** Drop the least recently touched positions and the oldest listened ids. */
export function pruneListenStore(store: ListenStore): ListenStore {
  const entries = Object.entries(store.positions);
  const kept =
    entries.length > LISTEN_STORE_LIMITS.positions
      ? entries
          .sort((a, b) => b[1].at - a[1].at)
          .slice(0, LISTEN_STORE_LIMITS.positions)
          .sort((a, b) => a[1].at - b[1].at)
      : entries;

  return {
    version: 1,
    rate: store.rate,
    positions: Object.fromEntries(kept),
    listened: store.listened.slice(-LISTEN_STORE_LIMITS.listened),
  };
}

/** Record where playback stopped inside one article. */
export function recordPosition(
  store: ListenStore,
  id: string,
  segment: number,
  block: number,
  now: number
): ListenStore {
  return pruneListenStore({
    ...store,
    positions: {
      ...store.positions,
      [id]: {
        segment: Math.max(0, Math.trunc(segment)),
        block: Math.max(0, Math.trunc(block)),
        at: now,
      },
    },
  });
}

/** Mark an article finished and forget its resume position. */
export function markListened(store: ListenStore, id: string): ListenStore {
  const positions = { ...store.positions };
  delete positions[id];

  const listened = store.listened.includes(id) ? store.listened : [...store.listened, id];

  return pruneListenStore({ ...store, positions, listened });
}
