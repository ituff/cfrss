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
  if (body) {
    init.body = JSON.stringify(body);
  }
  return new Request(`http://localhost${path}`, init);
}

/** Insert a subscription + article directly so bookmarks have a target. */
async function seedArticle(id: string, title = `Article ${id}`): Promise<void> {
  await env.DB
    .prepare(
      `INSERT OR IGNORE INTO subscriptions (id, url, title, category_id)
       VALUES ('sub-1', 'https://example.com/feed.xml', 'Example Feed', 'default')`
    )
    .run();
  await env.DB
    .prepare(
      `INSERT OR REPLACE INTO articles
         (id, subscription_id, title, author, published_at, summary, content_path, source_url, is_read)
       VALUES (?, 'sub-1', ?, 'Jane Doe', '2026-09-01T10:00:00.000Z', 'summary', 'p/1.md', 'https://example.com/a', 0)`
    )
    .bind(id, title)
    .run();
}

describe('Bookmarks API', () => {
  beforeEach(async () => {
    TEST_ENV.DB = env.DB;
    await setupTestDatabase(env.DB);
    await env.DB.prepare('DELETE FROM bookmarks').run();
    await env.DB.prepare('DELETE FROM articles').run();
    await env.DB.prepare('DELETE FROM subscriptions').run();
  });

  describe('GET /api/bookmarks', () => {
    it('returns an empty list when nothing is bookmarked', async () => {
      const res = await app.fetch(makeRequest('GET', '/api/bookmarks'), TEST_ENV);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { bookmarks: unknown[] };
      expect(body.bookmarks).toEqual([]);
    });

    it('returns bookmarked articles with their metadata', async () => {
      await seedArticle('a1', 'Saved article');
      await app.fetch(makeRequest('PUT', '/api/articles/a1/bookmark'), TEST_ENV);

      const res = await app.fetch(makeRequest('GET', '/api/bookmarks'), TEST_ENV);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        bookmarks: Array<{ bookmark: { articleId: string }; article: { title: string; author: string } }>;
      };

      expect(body.bookmarks).toHaveLength(1);
      expect(body.bookmarks[0].bookmark.articleId).toBe('a1');
      expect(body.bookmarks[0].article.title).toBe('Saved article');
      expect(body.bookmarks[0].article.author).toBe('Jane Doe');
    });

    it('lists the most recently bookmarked article first', async () => {
      await seedArticle('a1');
      await seedArticle('a2');
      await app.fetch(makeRequest('PUT', '/api/articles/a1/bookmark'), TEST_ENV);
      await app.fetch(makeRequest('PUT', '/api/articles/a2/bookmark'), TEST_ENV);
      // Force distinct timestamps (the column defaults to second precision)
      await env.DB.prepare("UPDATE bookmarks SET created_at = '2026-09-01 10:00:00' WHERE article_id = 'a1'").run();
      await env.DB.prepare("UPDATE bookmarks SET created_at = '2026-09-02 10:00:00' WHERE article_id = 'a2'").run();

      const res = await app.fetch(makeRequest('GET', '/api/bookmarks'), TEST_ENV);
      const body = (await res.json()) as { bookmarks: Array<{ bookmark: { articleId: string } }> };
      expect(body.bookmarks.map((b) => b.bookmark.articleId)).toEqual(['a2', 'a1']);
    });
  });

  describe('GET /api/articles/:id/bookmark', () => {
    it('reports false for an unbookmarked article', async () => {
      await seedArticle('a1');
      const res = await app.fetch(makeRequest('GET', '/api/articles/a1/bookmark'), TEST_ENV);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ bookmarked: false });
    });

    it('reports true once the article is bookmarked', async () => {
      await seedArticle('a1');
      await app.fetch(makeRequest('PUT', '/api/articles/a1/bookmark'), TEST_ENV);
      const res = await app.fetch(makeRequest('GET', '/api/articles/a1/bookmark'), TEST_ENV);
      expect(await res.json()).toEqual({ bookmarked: true });
    });
  });

  describe('PUT /api/articles/:id/bookmark', () => {
    it('bookmarks an article', async () => {
      await seedArticle('a1');
      const res = await app.fetch(makeRequest('PUT', '/api/articles/a1/bookmark'), TEST_ENV);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true, bookmarked: true });
    });

    it('is idempotent — bookmarking twice keeps a single row', async () => {
      await seedArticle('a1');
      await app.fetch(makeRequest('PUT', '/api/articles/a1/bookmark'), TEST_ENV);
      await app.fetch(makeRequest('PUT', '/api/articles/a1/bookmark'), TEST_ENV);

      const row = await env.DB
        .prepare('SELECT COUNT(*) AS n FROM bookmarks WHERE article_id = ?')
        .bind('a1')
        .first<{ n: number }>();
      expect(row?.n).toBe(1);
    });

    it('returns 404 for an unknown article', async () => {
      const res = await app.fetch(makeRequest('PUT', '/api/articles/nope/bookmark'), TEST_ENV);
      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/articles/:id/bookmark', () => {
    it('removes an existing bookmark', async () => {
      await seedArticle('a1');
      await app.fetch(makeRequest('PUT', '/api/articles/a1/bookmark'), TEST_ENV);

      const res = await app.fetch(makeRequest('DELETE', '/api/articles/a1/bookmark'), TEST_ENV);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true, bookmarked: false });

      const list = await app.fetch(makeRequest('GET', '/api/bookmarks'), TEST_ENV);
      const body = (await list.json()) as { bookmarks: unknown[] };
      expect(body.bookmarks).toEqual([]);
    });

    it('returns 404 when the article was not bookmarked', async () => {
      await seedArticle('a1');
      const res = await app.fetch(makeRequest('DELETE', '/api/articles/a1/bookmark'), TEST_ENV);
      expect(res.status).toBe(404);
    });
  });

  describe('auth', () => {
    it('rejects requests without a bearer token', async () => {
      const res = await app.fetch(
        new Request('http://localhost/api/bookmarks', { method: 'GET' }),
        TEST_ENV
      );
      expect(res.status).toBe(401);
    });
  });
});
