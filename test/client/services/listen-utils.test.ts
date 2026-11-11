/**
 * Pure listen-session logic tests.
 *
 * Not covered here (needs a browser): audio playback, pointer dragging on the
 * scrubber, focus handling, and anything that touches `localStorage` — the
 * storage functions are pure so they can be tested without a real store.
 */
import { describe, it, expect } from 'vitest';
import {
  queueFilterFromQuery,
  mergeSeedIntoQueue,
  normalizeRate,
  cycleRate,
  articleProgress,
  segmentForRatio,
  formatClock,
  emptyListenStore,
  parseListenStore,
  pruneListenStore,
  recordPosition,
  markListened,
  LISTEN_STORE_LIMITS,
  type ListenStore,
} from '../../../src/client/services/listen-utils';

describe('queueFilterFromQuery', () => {
  it('uses the subscription filter when present', () => {
    expect(queueFilterFromQuery({ subscription: 'sub-1' })).toEqual({ subscriptionId: 'sub-1' });
  });

  it('falls back to the category filter', () => {
    expect(queueFilterFromQuery({ category: 'cat-1' })).toEqual({ categoryId: 'cat-1' });
  });

  it('prefers the subscription when both are present', () => {
    expect(queueFilterFromQuery({ subscription: 'sub-1', category: 'cat-1' })).toEqual({
      subscriptionId: 'sub-1',
    });
  });

  it('returns no filter for an empty or blank query', () => {
    expect(queueFilterFromQuery({})).toEqual({});
    expect(queueFilterFromQuery({ subscription: '  ', category: '' })).toEqual({});
  });
});

describe('mergeSeedIntoQueue', () => {
  const a = { id: 'a' };
  const b = { id: 'b' };

  it('prepends the seed when the page does not contain it', () => {
    expect(mergeSeedIntoQueue([b], a)).toEqual([a, b]);
  });

  it('does not duplicate a seed that is already in the queue', () => {
    const queue = [a, b];
    expect(mergeSeedIntoQueue(queue, a)).toBe(queue);
  });

  it('never reorders the existing queue', () => {
    // Equal timestamps must not trigger a re-sort: the API order is the order.
    const first = { id: 'x', publishedAt: '2026-01-01T00:00:00Z' };
    const second = { id: 'y', publishedAt: '2026-01-01T00:00:00Z' };
    expect(mergeSeedIntoQueue([first, second], { id: 'z', publishedAt: '2026-01-01T00:00:00Z' }))
      .toEqual([{ id: 'z', publishedAt: '2026-01-01T00:00:00Z' }, first, second]);
  });
});

describe('normalizeRate', () => {
  it('snaps numbers to the nearest supported speed', () => {
    expect(normalizeRate(1.3)).toBe(1.25);
    expect(normalizeRate(1.6)).toBe(1.5);
    expect(normalizeRate(5)).toBe(2);
    expect(normalizeRate(0.1)).toBe(0.75);
  });

  it('falls back to 1x for junk', () => {
    expect(normalizeRate('1.5')).toBe(1);
    expect(normalizeRate(undefined)).toBe(1);
    expect(normalizeRate(null)).toBe(1);
    expect(normalizeRate(Number.NaN)).toBe(1);
  });
});

describe('cycleRate', () => {
  it('steps forward through the presets', () => {
    expect(cycleRate(1, 1)).toBe(1.25);
    expect(cycleRate(1.5, 1)).toBe(1.75);
  });

  it('steps backward through the presets', () => {
    expect(cycleRate(1, -1)).toBe(0.75);
    expect(cycleRate(1.25, -1)).toBe(1);
  });

  it('wraps at both ends', () => {
    expect(cycleRate(2, 1)).toBe(0.75);
    expect(cycleRate(0.75, -1)).toBe(2);
  });

  it('snaps an off-preset value before stepping', () => {
    // 1.1 snaps down to 1x, so the next preset is 1.25.
    expect(cycleRate(1.1, 1)).toBe(1.25);
  });
});

describe('articleProgress', () => {
  it('is 0 at the very start and 1 at the very end', () => {
    expect(articleProgress(0, 10, 0)).toBe(0);
    expect(articleProgress(9, 10, 1)).toBe(1);
  });

  it('accounts for the position inside the current segment', () => {
    expect(articleProgress(4, 10, 0.5)).toBeCloseTo(0.45);
  });

  it('is 0 when nothing is loaded', () => {
    expect(articleProgress(3, 0, 0.5)).toBe(0);
  });

  it('clamps out-of-range input', () => {
    expect(articleProgress(-5, 10, -1)).toBe(0);
    expect(articleProgress(50, 10, 2)).toBe(1);
    expect(articleProgress(Number.NaN, 10, Number.NaN)).toBe(0);
  });
});

describe('segmentForRatio', () => {
  it('maps the start and end of the track to valid segments', () => {
    expect(segmentForRatio(0, 10)).toBe(0);
    expect(segmentForRatio(1, 10)).toBe(9);
  });

  it('maps the middle of the track to the middle segment', () => {
    expect(segmentForRatio(0.5, 10)).toBe(5);
  });

  it('never returns an out-of-range index', () => {
    expect(segmentForRatio(-1, 10)).toBe(0);
    expect(segmentForRatio(2, 10)).toBe(9);
    expect(segmentForRatio(Number.NaN, 10)).toBe(0);
    expect(segmentForRatio(0.5, 0)).toBe(0);
  });
});

describe('formatClock', () => {
  it('formats mm:ss', () => {
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(65)).toBe('01:05');
    expect(formatClock(3599)).toBe('59:59');
  });

  it('keeps counting past an hour', () => {
    expect(formatClock(3600)).toBe('60:00');
  });

  it('guards against junk', () => {
    expect(formatClock(-5)).toBe('00:00');
    expect(formatClock(Number.NaN)).toBe('00:00');
  });
});

describe('parseListenStore', () => {
  it('returns defaults for missing or corrupt data', () => {
    expect(parseListenStore(null)).toEqual(emptyListenStore());
    expect(parseListenStore('not json')).toEqual(emptyListenStore());
    expect(parseListenStore('null')).toEqual(emptyListenStore());
    expect(parseListenStore('{"version":99}')).toEqual(emptyListenStore());
  });

  it('restores rate, positions and listened ids', () => {
    const raw = JSON.stringify({
      version: 1,
      rate: 1.5,
      positions: { a: { segment: 4, block: 2, at: 1000 } },
      listened: ['b'],
    });
    expect(parseListenStore(raw)).toEqual({
      version: 1,
      rate: 1.5,
      positions: { a: { segment: 4, block: 2, at: 1000 } },
      listened: ['b'],
    });
  });

  it('drops malformed entries instead of failing', () => {
    const raw = JSON.stringify({
      version: 1,
      rate: 'fast',
      positions: {
        good: { segment: 1, block: 0, at: 5 },
        badType: { segment: 'x', block: 0, at: 5 },
        notObject: 42,
      },
      listened: ['ok', 7, '', null],
    });
    const store = parseListenStore(raw);
    expect(store.rate).toBe(1);
    expect(Object.keys(store.positions)).toEqual(['good']);
    expect(store.listened).toEqual(['ok']);
  });
});

describe('pruneListenStore', () => {
  const withPositions = (count: number): ListenStore => {
    const positions: ListenStore['positions'] = {};
    for (let i = 0; i < count; i++) {
      positions[`p${i}`] = { segment: 0, block: 0, at: i };
    }
    return { version: 1, rate: 1, positions, listened: [] };
  };

  it('keeps the most recently touched positions', () => {
    const pruned = pruneListenStore(withPositions(LISTEN_STORE_LIMITS.positions + 5));
    const keys = Object.keys(pruned.positions);
    expect(keys).toHaveLength(LISTEN_STORE_LIMITS.positions);
    expect(keys[0]).toBe('p5');
    expect(keys[keys.length - 1]).toBe(`p${LISTEN_STORE_LIMITS.positions + 4}`);
  });

  it('caps the listened list at the newest entries', () => {
    const listened = Array.from({ length: LISTEN_STORE_LIMITS.listened + 10 }, (_, i) => `a${i}`);
    const pruned = pruneListenStore({ ...emptyListenStore(), listened });
    expect(pruned.listened).toHaveLength(LISTEN_STORE_LIMITS.listened);
    expect(pruned.listened[0]).toBe('a10');
  });

  it('leaves a small store untouched', () => {
    const store = withPositions(2);
    expect(pruneListenStore(store)).toEqual(store);
  });
});

describe('recordPosition', () => {
  it('stores the resume point', () => {
    const store = recordPosition(emptyListenStore(), 'a', 3, 2, 1000);
    expect(store.positions.a).toEqual({ segment: 3, block: 2, at: 1000 });
  });

  it('overwrites an existing position for the same article', () => {
    const first = recordPosition(emptyListenStore(), 'a', 3, 2, 1000);
    const second = recordPosition(first, 'a', 7, 5, 2000);
    expect(second.positions.a).toEqual({ segment: 7, block: 5, at: 2000 });
  });

  it('does not mutate the input store', () => {
    const store = emptyListenStore();
    recordPosition(store, 'a', 1, 1, 1);
    expect(store.positions).toEqual({});
  });
});

describe('markListened', () => {
  it('adds the article and forgets its resume point', () => {
    const store = recordPosition(emptyListenStore(), 'a', 3, 2, 1000);
    const next = markListened(store, 'a');
    expect(next.listened).toEqual(['a']);
    expect(next.positions.a).toBeUndefined();
  });

  it('does not add the same article twice', () => {
    const once = markListened(emptyListenStore(), 'a');
    const twice = markListened(once, 'a');
    expect(twice.listened).toEqual(['a']);
  });
});
