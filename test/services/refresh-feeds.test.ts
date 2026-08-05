import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { refreshAllFeeds, fetchSingleFeed } from '../../src/services/content-fetcher';
import { Subscription } from '../../src/types';

// Helper to create a mock subscription
function makeSubscription(id: string, url: string, title: string = `Feed ${id}`): Subscription {
  return {
    id,
    url,
    title,
    categoryId: 'default',
    createdAt: '2024-01-01T00:00:00Z',
    lastFetchedAt: null,
  };
}

// Helper to create valid RSS XML response
function makeRSSXml(title: string, items: Array<{ title: string; link: string }>): string {
  const itemsXml = items
    .map(
      (item) => `
    <item>
      <title>${item.title}</title>
      <link>${item.link}</link>
      <pubDate>Mon, 15 Jan 2024 08:30:00 GMT</pubDate>
      <description>Summary of ${item.title}</description>
    </item>`
    )
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${title}</title>${itemsXml}
  </channel>
</rss>`;
}

describe('refreshAllFeeds - Parallel feed refresh with fault tolerance', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return empty results for empty subscription list', async () => {
    const result = await refreshAllFeeds([]);
    expect(result.successes).toHaveLength(0);
    expect(result.failures).toHaveLength(0);
  });

  it('should successfully fetch a single feed', async () => {
    const xml = makeRSSXml('Test Feed', [
      { title: 'Article 1', link: 'https://example.com/1' },
    ]);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(xml, { status: 200 }))
    );

    const subs = [makeSubscription('sub-1', 'https://example.com/feed.xml', 'Test Feed')];
    const result = await refreshAllFeeds(subs);

    expect(result.successes).toHaveLength(1);
    expect(result.failures).toHaveLength(0);
    expect(result.successes[0].subscriptionId).toBe('sub-1');
    expect(result.successes[0].articles).toHaveLength(1);
    expect(result.successes[0].articles[0].title).toBe('Article 1');
  });

  it('should fetch multiple feeds concurrently and return all results', async () => {
    const xml1 = makeRSSXml('Feed One', [{ title: 'Article A', link: 'https://a.com/1' }]);
    const xml2 = makeRSSXml('Feed Two', [
      { title: 'Article B', link: 'https://b.com/1' },
      { title: 'Article C', link: 'https://b.com/2' },
    ]);
    const xml3 = makeRSSXml('Feed Three', [{ title: 'Article D', link: 'https://c.com/1' }]);

    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('a.com')) return Promise.resolve(new Response(xml1, { status: 200 }));
      if (url.includes('b.com')) return Promise.resolve(new Response(xml2, { status: 200 }));
      if (url.includes('c.com')) return Promise.resolve(new Response(xml3, { status: 200 }));
      return Promise.reject(new Error('Unknown URL'));
    });
    vi.stubGlobal('fetch', mockFetch);

    const subs = [
      makeSubscription('s1', 'https://a.com/feed.xml', 'Feed One'),
      makeSubscription('s2', 'https://b.com/feed.xml', 'Feed Two'),
      makeSubscription('s3', 'https://c.com/feed.xml', 'Feed Three'),
    ];

    const result = await refreshAllFeeds(subs);

    expect(result.successes).toHaveLength(3);
    expect(result.failures).toHaveLength(0);
    expect(result.successes[0].articles).toHaveLength(1);
    expect(result.successes[1].articles).toHaveLength(2);
    expect(result.successes[2].articles).toHaveLength(1);
  });

  it('should handle individual feed failure without blocking others', async () => {
    const xml1 = makeRSSXml('Working Feed', [{ title: 'Good Article', link: 'https://good.com/1' }]);

    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('good.com')) return Promise.resolve(new Response(xml1, { status: 200 }));
      if (url.includes('bad.com')) return Promise.reject(new Error('Network error'));
      return Promise.reject(new Error('Unknown'));
    });
    vi.stubGlobal('fetch', mockFetch);

    const subs = [
      makeSubscription('s1', 'https://good.com/feed.xml', 'Good Feed'),
      makeSubscription('s2', 'https://bad.com/feed.xml', 'Bad Feed'),
    ];

    const result = await refreshAllFeeds(subs);

    expect(result.successes).toHaveLength(1);
    expect(result.successes[0].subscriptionId).toBe('s1');
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].subscriptionId).toBe('s2');
    expect(result.failures[0].subscriptionTitle).toBe('Bad Feed');
    expect(result.failures[0].error).toBe('Network error');
  });

  it('should report HTTP error status as failure', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response('Not Found', { status: 404, statusText: 'Not Found' })
    );
    vi.stubGlobal('fetch', mockFetch);

    const subs = [makeSubscription('s1', 'https://example.com/feed.xml', 'Missing Feed')];
    const result = await refreshAllFeeds(subs);

    expect(result.successes).toHaveLength(0);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].error).toContain('404');
  });

  it('should handle timeout via AbortController', async () => {
    // Use a fetch that delays longer than our timeout
    const mockFetch = vi.fn().mockImplementation((_url: string, options?: RequestInit) => {
      return new Promise<Response>((resolve, reject) => {
        const timer = setTimeout(() => resolve(new Response('late', { status: 200 })), 5000);
        if (options?.signal) {
          options.signal.addEventListener('abort', () => {
            clearTimeout(timer);
            const abortError = new Error('The operation was aborted');
            abortError.name = 'AbortError';
            reject(abortError);
          });
        }
      });
    });
    vi.stubGlobal('fetch', mockFetch);

    const subs = [makeSubscription('s1', 'https://slow.com/feed.xml', 'Slow Feed')];
    const result = await refreshAllFeeds(subs, 100);

    expect(result.successes).toHaveLength(0);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].subscriptionId).toBe('s1');
    expect(result.failures[0].subscriptionTitle).toBe('Slow Feed');
    expect(result.failures[0].error).toContain('Timeout');
  });

  it('should return partial results when some feeds fail and some succeed', async () => {
    const xmlGood = makeRSSXml('Working', [{ title: 'A1', link: 'https://a.com/1' }]);

    const mockFetch = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
      if (url.includes('good1.com')) return Promise.resolve(new Response(xmlGood, { status: 200 }));
      if (url.includes('good2.com')) return Promise.resolve(new Response(xmlGood, { status: 200 }));
      if (url.includes('error.com')) return Promise.reject(new Error('Connection refused'));
      if (url.includes('slow.com')) {
        return new Promise<Response>((resolve, reject) => {
          const timer = setTimeout(() => resolve(new Response('late', { status: 200 })), 5000);
          if (options?.signal) {
            options.signal.addEventListener('abort', () => {
              clearTimeout(timer);
              const abortError = new Error('The operation was aborted');
              abortError.name = 'AbortError';
              reject(abortError);
            });
          }
        });
      }
      return Promise.reject(new Error('Unknown'));
    });
    vi.stubGlobal('fetch', mockFetch);

    const subs = [
      makeSubscription('s1', 'https://good1.com/feed.xml', 'Good Feed 1'),
      makeSubscription('s2', 'https://error.com/feed.xml', 'Error Feed'),
      makeSubscription('s3', 'https://good2.com/feed.xml', 'Good Feed 2'),
      makeSubscription('s4', 'https://slow.com/feed.xml', 'Slow Feed'),
    ];

    const result = await refreshAllFeeds(subs, 100);

    expect(result.successes).toHaveLength(2);
    expect(result.failures).toHaveLength(2);

    const successIds = result.successes.map((s) => s.subscriptionId);
    expect(successIds).toContain('s1');
    expect(successIds).toContain('s3');

    const failureIds = result.failures.map((f) => f.subscriptionId);
    expect(failureIds).toContain('s2');
    expect(failureIds).toContain('s4');

    // Verify failure details
    const errorFailure = result.failures.find((f) => f.subscriptionId === 's2')!;
    expect(errorFailure.subscriptionTitle).toBe('Error Feed');
    expect(errorFailure.error).toBe('Connection refused');

    const timeoutFailure = result.failures.find((f) => f.subscriptionId === 's4')!;
    expect(timeoutFailure.subscriptionTitle).toBe('Slow Feed');
    expect(timeoutFailure.error).toContain('Timeout');
  });

  it('should handle all feeds failing gracefully', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Network down'));
    vi.stubGlobal('fetch', mockFetch);

    const subs = [
      makeSubscription('s1', 'https://a.com/feed.xml', 'Feed A'),
      makeSubscription('s2', 'https://b.com/feed.xml', 'Feed B'),
      makeSubscription('s3', 'https://c.com/feed.xml', 'Feed C'),
    ];

    const result = await refreshAllFeeds(subs);

    expect(result.successes).toHaveLength(0);
    expect(result.failures).toHaveLength(3);
    result.failures.forEach((f) => {
      expect(f.error).toBe('Network down');
    });
  });
});

describe('fetchSingleFeed', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return parsed articles from a valid feed', async () => {
    const xml = makeRSSXml('My Feed', [
      { title: 'Post 1', link: 'https://example.com/1' },
      { title: 'Post 2', link: 'https://example.com/2' },
    ]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(xml, { status: 200 })));

    const articles = await fetchSingleFeed('https://example.com/feed.xml');

    expect(articles).toHaveLength(2);
    expect(articles[0].title).toBe('Post 1');
    expect(articles[1].title).toBe('Post 2');
  });

  it('should throw on HTTP error response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('Server Error', { status: 500, statusText: 'Internal Server Error' }))
    );

    await expect(fetchSingleFeed('https://example.com/feed.xml')).rejects.toThrow('HTTP 500');
  });

  it('should throw timeout error when fetch exceeds timeout', async () => {
    // Use a fetch that delays longer than our timeout
    const mockFetch = vi.fn().mockImplementation((_url: string, options?: RequestInit) => {
      return new Promise<Response>((resolve, reject) => {
        const timer = setTimeout(() => resolve(new Response('late', { status: 200 })), 5000);
        if (options?.signal) {
          options.signal.addEventListener('abort', () => {
            clearTimeout(timer);
            const abortError = new Error('The operation was aborted');
            abortError.name = 'AbortError';
            reject(abortError);
          });
        }
      });
    });
    vi.stubGlobal('fetch', mockFetch);

    await expect(fetchSingleFeed('https://slow.com/feed.xml', 100)).rejects.toThrow('Timeout after 100ms');
  });

  it('should propagate network errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('DNS resolution failed')));

    await expect(fetchSingleFeed('https://example.com/feed.xml')).rejects.toThrow(
      'DNS resolution failed'
    );
  });
});
