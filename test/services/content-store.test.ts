import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  storeArticle,
  getArticleContent,
  checkArticleExists,
  generateArticlePath,
  fetchWithRetry,
  ArticleStorageData,
} from '../../src/services/content-store';
import { GitHubConfig } from '../../src/types';

const mockConfig: GitHubConfig = {
  repoOwner: 'test-owner',
  repoName: 'test-repo',
  token: 'ghp_testtoken123',
  branch: 'main',
  contentPath: 'articles',
};

const mockArticle: ArticleStorageData = {
  id: 'a1b2c3d4',
  title: 'Test Article',
  author: 'John Doe',
  publishedAt: '2024-01-15T08:30:00Z',
  sourceUrl: 'https://example.com/article',
  feedUrl: 'https://example.com/feed.xml',
  htmlContent: '<p>Test content</p>',
  fetchedAt: '2024-01-15T09:00:00Z',
};

describe('Content Store - generateArticlePath', () => {
  it('should generate correct path from publishedAt date', () => {
    const path = generateArticlePath('articles', 'abc123', '2024-01-15T08:30:00Z');
    expect(path).toBe('articles/2024/01/abc123.json');
  });

  it('should handle different months correctly', () => {
    const path = generateArticlePath('content', 'xyz789', '2024-12-01T00:00:00Z');
    expect(path).toBe('content/2024/12/xyz789.json');
  });

  it('should pad single-digit months with zero', () => {
    const path = generateArticlePath('data', 'id1', '2024-03-05T10:00:00Z');
    expect(path).toBe('data/2024/03/id1.json');
  });

  it('should strip leading and trailing slashes from contentPath', () => {
    const path = generateArticlePath('/articles/', 'abc', '2024-06-15T00:00:00Z');
    expect(path).toBe('articles/2024/06/abc.json');
  });

  it('should handle nested content paths', () => {
    const path = generateArticlePath('rss/articles', 'id2', '2024-07-20T12:00:00Z');
    expect(path).toBe('rss/articles/2024/07/id2.json');
  });
});

describe('Content Store - checkArticleExists', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should return true when file exists (200)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ name: 'file.json' }), { status: 200 })
    );

    const result = await checkArticleExists(mockConfig, 'articles/2024/01/a1b2c3d4.json');
    expect(result).toBe(true);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/test-owner/test-repo/contents/articles/2024/01/a1b2c3d4.json?ref=main',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'token ghp_testtoken123',
          Accept: 'application/vnd.github.v3+json',
        }),
      })
    );
  });

  it('should return false when file does not exist (404)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 })
    );

    const result = await checkArticleExists(mockConfig, 'articles/2024/01/nonexistent.json');
    expect(result).toBe(false);
  });
});

describe('Content Store - storeArticle', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should store an article and return the path', async () => {
    // First call: checkArticleExists returns 404 (doesn't exist)
    // Second call: PUT returns 201 (created)
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ content: { path: 'articles/2024/01/a1b2c3d4.json' } }), { status: 201 })
      );

    const path = await storeArticle(mockConfig, mockArticle);
    expect(path).toBe('articles/2024/01/a1b2c3d4.json');

    // Verify the PUT call
    const putCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[1];
    expect(putCall[0]).toBe('https://api.github.com/repos/test-owner/test-repo/contents/articles/2024/01/a1b2c3d4.json');
    expect(putCall[1].method).toBe('PUT');

    const body = JSON.parse(putCall[1].body as string);
    expect(body.message).toBe('Add article: Test Article');
    expect(body.branch).toBe('main');
    // Verify content is base64 encoded
    expect(body.content).toBeTruthy();
    const decoded = decodeURIComponent(escape(atob(body.content)));
    const parsed = JSON.parse(decoded);
    expect(parsed.id).toBe('a1b2c3d4');
    expect(parsed.title).toBe('Test Article');
  });

  it('should skip storing if article already exists (dedup)', async () => {
    // checkArticleExists returns 200 (exists)
    globalThis.fetch = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ name: 'a1b2c3d4.json' }), { status: 200 })
    );

    const path = await storeArticle(mockConfig, mockArticle);
    expect(path).toBe('articles/2024/01/a1b2c3d4.json');

    // Should only have called fetch once (the exists check), no PUT
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('should throw an error when PUT fails with non-retryable status', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'Validation Failed' }), { status: 422 })
      );

    await expect(storeArticle(mockConfig, mockArticle)).rejects.toThrow(
      'Failed to store article to GitHub'
    );
  });
});

describe('Content Store - getArticleContent', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should retrieve and decode article content', async () => {
    const articleJson = JSON.stringify(mockArticle);
    const base64Content = btoa(unescape(encodeURIComponent(articleJson)));

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ content: base64Content, encoding: 'base64' }), { status: 200 })
    );

    const result = await getArticleContent(mockConfig, 'articles/2024/01/a1b2c3d4.json');

    expect(result).not.toBeNull();
    expect(result!.id).toBe('a1b2c3d4');
    expect(result!.title).toBe('Test Article');
    expect(result!.author).toBe('John Doe');
    expect(result!.publishedAt).toBe('2024-01-15T08:30:00Z');
    expect(result!.htmlContent).toBe('<p>Test content</p>');
    expect(result!.sourceUrl).toBe('https://example.com/article');
  });

  it('should return null when file does not exist (404)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 })
    );

    const result = await getArticleContent(mockConfig, 'articles/2024/01/nonexistent.json');
    expect(result).toBeNull();
  });

  it('should return null when content field is missing', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ encoding: 'base64' }), { status: 200 })
    );

    const result = await getArticleContent(mockConfig, 'articles/2024/01/empty.json');
    expect(result).toBeNull();
  });

  it('should handle base64 content with newlines (GitHub format)', async () => {
    const articleJson = JSON.stringify(mockArticle);
    const base64Content = btoa(unescape(encodeURIComponent(articleJson)));
    // GitHub API returns base64 with newlines every 60 chars
    const base64WithNewlines = base64Content.replace(/(.{60})/g, '$1\n');

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ content: base64WithNewlines, encoding: 'base64' }), { status: 200 })
    );

    const result = await getArticleContent(mockConfig, 'articles/2024/01/a1b2c3d4.json');
    expect(result).not.toBeNull();
    expect(result!.id).toBe('a1b2c3d4');
  });

  it('should throw on non-404 error responses', async () => {
    // Use a 403 (non-retryable) so it doesn't trigger retries
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: 'Forbidden' }), { status: 403 })
    );

    await expect(
      getArticleContent(mockConfig, 'articles/2024/01/a1b2c3d4.json')
    ).rejects.toThrow('Failed to retrieve article from GitHub');
  });
});

describe('Content Store - retry logic', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should retry on 500 errors up to 3 times then return the failed response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: 'Server Error' }), { status: 500 })
    );

    const response = await fetchWithRetry(
      'https://api.github.com/repos/owner/repo/contents/test.json',
      { method: 'GET', headers: {} },
      { maxRetries: 3, baseDelayMs: 1 }
    );

    expect(response.status).toBe(500);
    // Should have made 4 total calls (1 initial + 3 retries)
    expect(globalThis.fetch).toHaveBeenCalledTimes(4);
  });

  it('should retry on network errors and throw after exhausting retries', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network failure'));

    await expect(
      fetchWithRetry(
        'https://api.github.com/repos/owner/repo/contents/test.json',
        { method: 'GET', headers: {} },
        { maxRetries: 3, baseDelayMs: 1 }
      )
    ).rejects.toThrow('GitHub API request failed after 4 attempts');

    expect(globalThis.fetch).toHaveBeenCalledTimes(4);
  });

  it('should succeed on retry after initial failure', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ name: 'file.json' }), { status: 200 }));

    const response = await fetchWithRetry(
      'https://api.github.com/repos/owner/repo/contents/test.json',
      { method: 'GET', headers: {} },
      { maxRetries: 3, baseDelayMs: 1 }
    );

    expect(response.status).toBe(200);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('should not retry on 4xx errors (except 429)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: 'Bad Request' }), { status: 400 })
    );

    const response = await fetchWithRetry(
      'https://api.github.com/repos/owner/repo/contents/test.json',
      { method: 'GET', headers: {} },
      { maxRetries: 3, baseDelayMs: 1 }
    );

    expect(response.status).toBe(400);
    // Should only call once, no retries for 400
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('should retry on 429 rate limit', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ name: 'file.json' }), { status: 200 }));

    const response = await fetchWithRetry(
      'https://api.github.com/repos/owner/repo/contents/test.json',
      { method: 'GET', headers: {} },
      { maxRetries: 3, baseDelayMs: 1 }
    );

    expect(response.status).toBe(200);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });
});
