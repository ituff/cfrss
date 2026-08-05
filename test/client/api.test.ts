/**
 * Unit tests for the frontend API client service.
 * Tests error handling, retry logic, and typed API wrappers.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  setAuthToken,
  getAuthToken,
  getSubscriptions,
  addSubscription,
  deleteSubscription,
  moveSubscription,
  getCategories,
  createCategory,
  renameCategory,
  deleteCategory,
  getArticles,
  getArticle,
  refreshFeeds,
  importOPML,
  exportOPML,
  getTheme,
  setTheme,
  getLanguage,
  setLanguage,
  getLLMConfigs,
  createLLMConfig,
  deleteLLMConfig,
  testLLMConfig,
  getLLMAssignments,
  setLLMAssignments,
  getGitHubConfig,
  setGitHubConfig,
  testGitHubConfig,
  getDailyDigest,
  generateDailyDigest,
  ApiError,
} from '../../src/client/services/api.js';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function errorResponse(status: number, error: { code: string; message: string; retryable: boolean }): Response {
  return new Response(JSON.stringify(error), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('API Client', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    setAuthToken('test-token-123');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('setAuthToken / getAuthToken', () => {
    it('stores and retrieves the auth token', () => {
      setAuthToken('my-secret');
      expect(getAuthToken()).toBe('my-secret');
    });
  });

  describe('request headers', () => {
    it('sends Authorization header with Bearer token', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ subscriptions: [] }));

      await getSubscriptions();

      expect(mockFetch).toHaveBeenCalledOnce();
      const [, options] = mockFetch.mock.calls[0];
      expect(options.headers['Authorization']).toBe('Bearer test-token-123');
    });

    it('sends Content-Type for JSON body requests', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ category: { id: '1', name: 'Tech', order: 1 } }));

      await createCategory('Tech');

      const [, options] = mockFetch.mock.calls[0];
      expect(options.headers['Content-Type']).toBe('application/json');
    });
  });

  describe('retry logic', () => {
    it('retries once on 5xx error', async () => {
      mockFetch
        .mockResolvedValueOnce(new Response('', { status: 500 }))
        .mockResolvedValueOnce(jsonResponse({ subscriptions: [] }));

      const result = await getSubscriptions();

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result).toEqual([]);
    });

    it('retries once on network failure', async () => {
      mockFetch
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockResolvedValueOnce(jsonResponse({ categories: [] }));

      const result = await getCategories();

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result).toEqual([]);
    });

    it('does not retry on 4xx errors', async () => {
      mockFetch.mockResolvedValueOnce(
        errorResponse(400, { code: 'VALIDATION_ERROR', message: 'Bad input', retryable: false })
      );

      await expect(createCategory('')).rejects.toThrow(ApiError);
      expect(mockFetch).toHaveBeenCalledOnce();
    });

    it('throws ApiError with NETWORK_ERROR after all retries fail', async () => {
      mockFetch
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockRejectedValueOnce(new TypeError('Failed to fetch'));

      try {
        await getSubscriptions();
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        expect((err as ApiError).code).toBe('NETWORK_ERROR');
        expect((err as ApiError).retryable).toBe(true);
      }
    });
  });

  describe('Subscription API', () => {
    it('getSubscriptions returns subscription array', async () => {
      const subs = [{ id: '1', url: 'https://example.com/feed.xml', title: 'Example', categoryId: 'default', createdAt: '2024-01-01', lastFetchedAt: null }];
      mockFetch.mockResolvedValueOnce(jsonResponse({ subscriptions: subs }));

      const result = await getSubscriptions();
      expect(result).toEqual(subs);
    });

    it('addSubscription sends correct body', async () => {
      const sub = { id: '2', url: 'https://test.com/rss', title: 'Test', categoryId: 'cat1', createdAt: '2024-01-01', lastFetchedAt: null };
      mockFetch.mockResolvedValueOnce(jsonResponse({ subscription: sub }));

      const result = await addSubscription('https://test.com/rss', 'cat1');

      expect(result).toEqual(sub);
      const [, options] = mockFetch.mock.calls[0];
      expect(JSON.parse(options.body)).toEqual({ url: 'https://test.com/rss', categoryId: 'cat1' });
    });

    it('deleteSubscription calls DELETE method', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ success: true }));

      await deleteSubscription('abc');

      const [path, options] = mockFetch.mock.calls[0];
      expect(path).toBe('/api/subscriptions/abc');
      expect(options.method).toBe('DELETE');
    });

    it('moveSubscription calls PUT with categoryId', async () => {
      const sub = { id: '1', url: 'https://test.com/rss', title: 'Test', categoryId: 'cat2', createdAt: '2024-01-01', lastFetchedAt: null };
      mockFetch.mockResolvedValueOnce(jsonResponse({ subscription: sub }));

      await moveSubscription('1', 'cat2');

      const [path, options] = mockFetch.mock.calls[0];
      expect(path).toBe('/api/subscriptions/1/category');
      expect(options.method).toBe('PUT');
      expect(JSON.parse(options.body)).toEqual({ categoryId: 'cat2' });
    });
  });

  describe('Category API', () => {
    it('getCategories returns category array', async () => {
      const cats = [{ id: 'default', name: 'Uncategorized', order: 0 }];
      mockFetch.mockResolvedValueOnce(jsonResponse({ categories: cats }));

      const result = await getCategories();
      expect(result).toEqual(cats);
    });

    it('renameCategory sends PUT with new name', async () => {
      const cat = { id: 'c1', name: 'NewName', order: 1 };
      mockFetch.mockResolvedValueOnce(jsonResponse({ category: cat }));

      const result = await renameCategory('c1', 'NewName');

      expect(result).toEqual(cat);
      const [path, options] = mockFetch.mock.calls[0];
      expect(path).toBe('/api/categories/c1');
      expect(options.method).toBe('PUT');
    });

    it('deleteCategory calls DELETE', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ success: true }));

      await deleteCategory('c1');

      const [path, options] = mockFetch.mock.calls[0];
      expect(path).toBe('/api/categories/c1');
      expect(options.method).toBe('DELETE');
    });
  });

  describe('Article API', () => {
    it('getArticles with no options', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ articles: [], truncated: false, limit: 50, offset: 0 }));

      const result = await getArticles();

      expect(result.articles).toEqual([]);
      const [path] = mockFetch.mock.calls[0];
      expect(path).toBe('/api/articles');
    });

    it('getArticles with filter options', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ articles: [], truncated: false, limit: 10, offset: 20 }));

      await getArticles({ unread: true, subscriptionId: 's1', limit: 10, offset: 20 });

      const [path] = mockFetch.mock.calls[0];
      expect(path).toContain('unread=true');
      expect(path).toContain('subscriptionId=s1');
      expect(path).toContain('limit=10');
      expect(path).toContain('offset=20');
    });

    it('getArticle returns single article', async () => {
      const article = { id: 'a1', subscriptionId: 's1', title: 'Hello', author: '', publishedAt: '2024-01-01', summary: '', contentPath: '', sourceUrl: '', isRead: false, fetchedAt: '2024-01-01' };
      mockFetch.mockResolvedValueOnce(jsonResponse({ article }));

      const result = await getArticle('a1');
      expect(result).toEqual(article);
    });

    it('refreshFeeds returns refresh result', async () => {
      const refreshResult = { refreshed: 2, newArticles: 5, failures: [] };
      mockFetch.mockResolvedValueOnce(jsonResponse(refreshResult));

      const result = await refreshFeeds();
      expect(result).toEqual(refreshResult);
    });
  });

  describe('OPML API', () => {
    it('importOPML sends FormData with file', async () => {
      const importResult = { imported: 3, skipped: 1, failed: 0, details: [] };
      mockFetch.mockResolvedValueOnce(jsonResponse(importResult));

      const file = new File(['<opml></opml>'], 'test.opml', { type: 'text/xml' });
      const result = await importOPML(file);

      expect(result).toEqual(importResult);
      const [, options] = mockFetch.mock.calls[0];
      expect(options.method).toBe('POST');
      expect(options.body).toBeInstanceOf(FormData);
    });

    it('exportOPML returns a Blob', async () => {
      const xml = '<?xml version="1.0"?><opml></opml>';
      const response = new Response(xml, {
        status: 200,
        headers: { 'Content-Type': 'application/xml' },
      });
      mockFetch.mockResolvedValueOnce(response);

      const result = await exportOPML();
      expect(result).toBeInstanceOf(Blob);
    });
  });

  describe('Config API', () => {
    it('getTheme returns theme string', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ theme: 'dark' }));
      const result = await getTheme();
      expect(result).toBe('dark');
    });

    it('setTheme sends PUT with theme', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ success: true }));
      await setTheme('light');

      const [, options] = mockFetch.mock.calls[0];
      expect(options.method).toBe('PUT');
      expect(JSON.parse(options.body)).toEqual({ theme: 'light' });
    });

    it('getLanguage returns language string', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ language: 'zh' }));
      const result = await getLanguage();
      expect(result).toBe('zh');
    });

    it('setLanguage sends PUT', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ success: true }));
      await setLanguage('en');

      const [, options] = mockFetch.mock.calls[0];
      expect(JSON.parse(options.body)).toEqual({ language: 'en' });
    });

    it('getGitHubConfig returns config object', async () => {
      const config = { repoOwner: 'user', repoName: 'repo', token: '****abcd', branch: 'main', contentPath: 'articles' };
      mockFetch.mockResolvedValueOnce(jsonResponse(config));
      const result = await getGitHubConfig();
      expect(result).toEqual(config);
    });

    it('setGitHubConfig sends PUT with config', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ success: true }));
      await setGitHubConfig({ repoOwner: 'user', repoName: 'repo', token: 'ghp_abc' });

      const [, options] = mockFetch.mock.calls[0];
      expect(options.method).toBe('PUT');
    });

    it('testGitHubConfig returns test result', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ success: true, message: 'OK' }));
      const result = await testGitHubConfig();
      expect(result).toEqual({ success: true, message: 'OK' });
    });
  });

  describe('LLM Config API', () => {
    it('getLLMConfigs returns config array', async () => {
      const configs = [{ id: '1', name: 'GPT-4', baseUrl: 'https://api.openai.com', apiKey: '****', modelName: 'gpt-4' }];
      mockFetch.mockResolvedValueOnce(jsonResponse({ configs }));
      const result = await getLLMConfigs();
      expect(result).toEqual(configs);
    });

    it('createLLMConfig sends POST', async () => {
      const config = { id: '2', name: 'Claude', baseUrl: 'https://api.anthropic.com', apiKey: '****', modelName: 'claude-3' };
      mockFetch.mockResolvedValueOnce(jsonResponse({ config }));

      const result = await createLLMConfig({ name: 'Claude', baseUrl: 'https://api.anthropic.com', apiKey: 'sk-xxx', modelName: 'claude-3' });
      expect(result).toEqual(config);
    });

    it('deleteLLMConfig calls DELETE', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ success: true }));
      await deleteLLMConfig('cfg1');

      const [path, options] = mockFetch.mock.calls[0];
      expect(path).toBe('/api/config/llm/cfg1');
      expect(options.method).toBe('DELETE');
    });

    it('testLLMConfig calls POST', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ success: true, message: 'Connected' }));
      const result = await testLLMConfig('cfg1');
      expect(result).toEqual({ success: true, message: 'Connected' });
    });

    it('getLLMAssignments returns assignment object', async () => {
      const assignments = { summarize: 'cfg1', translate: 'cfg2' };
      mockFetch.mockResolvedValueOnce(jsonResponse({ assignments }));
      const result = await getLLMAssignments();
      expect(result).toEqual(assignments);
    });

    it('setLLMAssignments sends PUT', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ success: true, assignments: { summarize: 'cfg1', translate: null } }));
      await setLLMAssignments({ summarize: 'cfg1', translate: null });

      const [, options] = mockFetch.mock.calls[0];
      expect(options.method).toBe('PUT');
    });
  });

  describe('Daily Digest API', () => {
    it('getDailyDigest returns digest or null', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ digest: null }));
      const result = await getDailyDigest();
      expect(result).toBeNull();
    });

    it('getDailyDigest with date parameter', async () => {
      const digest = { date: '2024-01-15', content: 'Summary', generatedAt: '2024-01-15T10:00:00Z', articleCount: 5 };
      mockFetch.mockResolvedValueOnce(jsonResponse({ digest }));

      const result = await getDailyDigest('2024-01-15');
      expect(result).toEqual(digest);

      const [path] = mockFetch.mock.calls[0];
      expect(path).toContain('date=2024-01-15');
    });

    it('generateDailyDigest returns generated digest', async () => {
      const digest = { date: '2024-01-15', content: 'New summary', generatedAt: '2024-01-15T10:00:00Z', articleCount: 3 };
      mockFetch.mockResolvedValueOnce(jsonResponse({ digest }));

      const result = await generateDailyDigest();
      expect(result).toEqual(digest);
    });
  });

  describe('Error handling', () => {
    it('throws ApiError with correct properties on 404', async () => {
      mockFetch.mockResolvedValueOnce(
        errorResponse(404, { code: 'NOT_FOUND', message: 'Article not found', retryable: false })
      );

      try {
        await getArticle('nonexistent');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        const apiErr = err as ApiError;
        expect(apiErr.code).toBe('NOT_FOUND');
        expect(apiErr.status).toBe(404);
        expect(apiErr.retryable).toBe(false);
        expect(apiErr.message).toBe('Article not found');
      }
    });

    it('handles non-JSON error responses gracefully', async () => {
      mockFetch.mockResolvedValueOnce(new Response('Internal Server Error', { status: 502 }));
      // First call returns 502 (retried), second also returns 502
      mockFetch.mockResolvedValueOnce(new Response('Bad Gateway', { status: 502 }));

      try {
        await getSubscriptions();
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        const apiErr = err as ApiError;
        expect(apiErr.status).toBe(502);
        expect(apiErr.code).toBe('UNKNOWN_ERROR');
      }
    });
  });
});
