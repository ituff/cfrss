/**
 * Articles API — list filtering, pagination and read-state updates.
 *
 * `test/handlers/` covered auth, bookmarks, config, device settings, github,
 * llm and tts, but not the articles endpoints — which are the ones the client
 * leans on hardest. That gap matters more now that the client requests
 * `?unread=true` by default, so these tests pin the contract it depends on.
 *
 * Runs against the real D1 binding via `cloudflare:test`.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import app from '../../src/index';
import { setupTestDatabase } from '../setup';
import type { Env } from '../../src/types';

const TEST_ENV: Env = {
  DB: null as unknown as D1Database,
  ENCRYPTION_KEY: 'test-encryption-key-32bytes-long!',
  AUTH_TOKEN: 'test-auth-token',
};

function makeRequest(method: string, path: string, body?: unknown) {
  const init: RequestInit = {
    method,
    headers: {
      Authorization: 'Bearer test-auth-token',
      'Content-Type': 'application/json',
    },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new Request(`http://localhost${path}`, init);
}

async function seedSubscription(id: string, categoryId = 'default'): Promise<void> {
  await env.DB
    .prepare(
      `INSERT OR REPLACE INTO subscriptions (id, url, title, category_id)
       VALUES (?, ?, ?, ?)`
    )
    .bind(id, `https://example.com/${id}.xml`, `Feed ${id}`, categoryId)
    .run();
}

async function seedArticle(
  id: string,
  opts: { sub?: string; publishedAt?: string; isRead?: number } = {}
): Promise<void> {
  await env.DB
    .prepare(
      `INSERT OR REPLACE INTO articles
         (id, subscription_id, title, author, published_at, summary, content_path, source_url, is_read)
       VALUES (?, ?, ?, 'Jane Doe', ?, 'summary', 'p/1.md', ?, ?)`
    )
    .bind(
      id,
      opts.sub ?? 'sub-1',
      `Article ${id}`,
      opts.publishedAt ?? '2026-09-01T10:00:00.000Z',
      `https://example.com/${id}`,
      opts.isRead ?? 0
    )
    .run();
}

interface ListBody {
  articles: Array<{ id: string; isRead: boolean }>;
  truncated: boolean;
  limit: number;
  offset: number;
}

async function listArticles(path: string): Promise<ListBody> {
  const res = await app.fetch(makeRequest('GET', path), TEST_ENV);
  expect(res.status).toBe(200);
  return (await res.json()) as ListBody;
}

describe('Articles API', () => {
  beforeEach(async () => {
    TEST_ENV.DB = env.DB;
    await setupTestDatabase(env.DB);
    // Children first: articles → subscriptions → categories.
    await env.DB.prepare('DELETE FROM bookmarks').run();
    await env.DB.prepare('DELETE FROM articles').run();
    await env.DB.prepare('DELETE FROM subscriptions').run();
    await env.DB.prepare("DELETE FROM categories WHERE id != 'default'").run();
  });

  describe('GET /api/articles', () => {
    it('returns articles newest first', async () => {
      await seedSubscription('sub-1');
      await seedArticle('older', { publishedAt: '2026-09-01T00:00:00.000Z' });
      await seedArticle('newer', { publishedAt: '2026-09-10T00:00:00.000Z' });

      const body = await listArticles('/api/articles');

      expect(body.articles.map((a) => a.id)).toEqual(['newer', 'older']);
    });

    it('returns everything by default, and only unread with ?unread=true', async () => {
      await seedSubscription('sub-1');
      await seedArticle('unread-1', { isRead: 0, publishedAt: '2026-09-02T00:00:00.000Z' });
      await seedArticle('read-1', { isRead: 1, publishedAt: '2026-09-01T00:00:00.000Z' });

      const all = await listArticles('/api/articles');
      expect(all.articles.map((a) => a.id).sort()).toEqual(['read-1', 'unread-1']);

      // This is the query the client now issues by default.
      const unread = await listArticles('/api/articles?unread=true');
      expect(unread.articles.map((a) => a.id)).toEqual(['unread-1']);
      expect(unread.articles.every((a) => a.isRead === false)).toBe(true);
    });

    it('ignores unread values other than the literal "true"', async () => {
      await seedSubscription('sub-1');
      await seedArticle('read-1', { isRead: 1 });

      // Documents current behaviour: the filter is opt-in and strict.
      const body = await listArticles('/api/articles?unread=1');
      expect(body.articles.map((a) => a.id)).toEqual(['read-1']);
    });

    it('filters by subscriptionId', async () => {
      await seedSubscription('sub-1');
      await seedSubscription('sub-2');
      await seedArticle('a1', { sub: 'sub-1' });
      await seedArticle('a2', { sub: 'sub-2' });

      const body = await listArticles('/api/articles?subscriptionId=sub-2');

      expect(body.articles.map((a) => a.id)).toEqual(['a2']);
    });

    it('filters by categoryId through the subscription join', async () => {
      await env.DB
        .prepare("INSERT OR REPLACE INTO categories (id, name, sort_order) VALUES ('cat-tech', 'Tech', 1)")
        .run();
      await seedSubscription('sub-1', 'default');
      await seedSubscription('sub-tech', 'cat-tech');
      await seedArticle('a-default', { sub: 'sub-1' });
      await seedArticle('a-tech', { sub: 'sub-tech' });

      const body = await listArticles('/api/articles?categoryId=cat-tech');

      expect(body.articles.map((a) => a.id)).toEqual(['a-tech']);
    });

    it('applies limit and offset', async () => {
      await seedSubscription('sub-1');
      for (let i = 0; i < 5; i++) {
        await seedArticle(`a${i}`, { publishedAt: `2026-09-0${i + 1}T00:00:00.000Z` });
      }

      const page = await listArticles('/api/articles?limit=2&offset=1');

      // Newest first: a4, a3, a2, a1, a0 — offset 1 skips a4.
      expect(page.articles.map((a) => a.id)).toEqual(['a3', 'a2']);
      expect(page.limit).toBe(2);
      expect(page.offset).toBe(1);
    });

    it('falls back to defaults for garbage limit/offset', async () => {
      await seedSubscription('sub-1');
      await seedArticle('a1');

      const body = await listArticles('/api/articles?limit=abc&offset=-5');

      expect(body.articles.map((a) => a.id)).toEqual(['a1']);
      expect(body.offset).toBe(0);
    });
  });

  describe('PUT /api/articles/:id/read', () => {
    it('marks an article read and back to unread', async () => {
      await seedSubscription('sub-1');
      await seedArticle('a1', { isRead: 0 });

      const read = await app.fetch(
        makeRequest('PUT', '/api/articles/a1/read', { isRead: true }),
        TEST_ENV
      );
      expect(read.status).toBe(200);
      const afterRead = await env.DB
        .prepare('SELECT is_read FROM articles WHERE id = ?')
        .bind('a1')
        .first<{ is_read: number }>();
      expect(afterRead?.is_read).toBe(1);

      const unread = await app.fetch(
        makeRequest('PUT', '/api/articles/a1/read', { isRead: false }),
        TEST_ENV
      );
      expect(unread.status).toBe(200);
      const afterUnread = await env.DB
        .prepare('SELECT is_read FROM articles WHERE id = ?')
        .bind('a1')
        .first<{ is_read: number }>();
      expect(afterUnread?.is_read).toBe(0);
    });

    it('is idempotent — re-marking an already-read article is 200, not 404', async () => {
      await seedSubscription('sub-1');
      await seedArticle('a1', { isRead: 1 });

      // The reader marks read on every open, including re-opens, so this path
      // runs constantly. It only works because SQLite counts *matched* rows:
      // a no-op UPDATE still reports changes === 1.
      const res = await app.fetch(
        makeRequest('PUT', '/api/articles/a1/read', { isRead: true }),
        TEST_ENV
      );

      expect(res.status).toBe(200);
    });

    it('404s for an unknown article', async () => {
      const res = await app.fetch(
        makeRequest('PUT', '/api/articles/nope/read', { isRead: true }),
        TEST_ENV
      );

      expect(res.status).toBe(404);
    });

    it('400s when isRead is missing or not a boolean', async () => {
      await seedSubscription('sub-1');
      await seedArticle('a1');

      const missing = await app.fetch(makeRequest('PUT', '/api/articles/a1/read', {}), TEST_ENV);
      expect(missing.status).toBe(400);

      const wrongType = await app.fetch(
        makeRequest('PUT', '/api/articles/a1/read', { isRead: 'yes' }),
        TEST_ENV
      );
      expect(wrongType.status).toBe(400);
    });
  });
});
