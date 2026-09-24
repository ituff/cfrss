import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import {
  getDailyDigest,
  selectDigestArticles,
  generateDigest,
} from '../../src/services/daily-digest';
import { setupTestDatabase } from '../setup';

describe('Daily Digest Service', () => {
  let db: D1Database;

  beforeEach(async () => {
    db = env.DB;
    await setupTestDatabase(db);

    // Clean tables for isolation
    await db.prepare('DELETE FROM daily_digests').run();
    await db.prepare('DELETE FROM articles').run();
    await db.prepare('DELETE FROM subscriptions').run();

    // Insert a subscription for test articles
    await db
      .prepare("INSERT INTO subscriptions (id, url, title, category_id) VALUES ('sub1', 'https://example.com/feed', 'Test Feed', 'default')")
      .run();
  });

  // Helper to insert an article
  async function insertArticle(opts: {
    id: string;
    title?: string;
    publishedAt: string;
    isRead?: number;
    summary?: string;
  }) {
    await db
      .prepare(
        `INSERT INTO articles (id, subscription_id, title, author, published_at, summary, content_path, source_url, is_read, fetched_at)
         VALUES (?, 'sub1', ?, 'Author', ?, ?, '/path', 'https://example.com', ?, datetime('now'))`
      )
      .bind(
        opts.id,
        opts.title ?? `Article ${opts.id}`,
        opts.publishedAt,
        opts.summary ?? 'Summary text',
        opts.isRead ?? 0
      )
      .run();
  }

  describe('getDailyDigest', () => {
    it('should return null when no digest exists for the date', async () => {
      const result = await getDailyDigest(db, '2024-01-15');
      expect(result).toBeNull();
    });

    it('should return cached digest when one exists', async () => {
      await db
        .prepare("INSERT INTO daily_digests (date, content, article_count, generated_at) VALUES ('2024-01-15', 'Test digest content', 5, '2024-01-15T10:00:00Z')")
        .run();

      const result = await getDailyDigest(db, '2024-01-15');
      expect(result).not.toBeNull();
      expect(result!.date).toBe('2024-01-15');
      expect(result!.content).toBe('Test digest content');
      expect(result!.articleCount).toBe(5);
      expect(result!.generatedAt).toBe('2024-01-15T10:00:00Z');
    });

    it('should not return digest for a different date', async () => {
      await db
        .prepare("INSERT INTO daily_digests (date, content, article_count, generated_at) VALUES ('2024-01-14', 'Old digest', 3, '2024-01-14T10:00:00Z')")
        .run();

      const result = await getDailyDigest(db, '2024-01-15');
      expect(result).toBeNull();
    });
  });

  describe('selectDigestArticles', () => {
    it('should return empty array when no articles exist', async () => {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const result = await selectDigestArticles(db, since);
      expect(result).toEqual([]);
    });

    it('should return only unread articles', async () => {
      const now = new Date().toISOString();
      await insertArticle({ id: 'a1', publishedAt: now, isRead: 0 });
      await insertArticle({ id: 'a2', publishedAt: now, isRead: 1 });

      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const result = await selectDigestArticles(db, since);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('a1');
      expect(result[0].isRead).toBe(false);
    });

    it('should return only articles published after the since timestamp', async () => {
      const now = new Date();
      const recentTime = new Date(now.getTime() - 1 * 60 * 60 * 1000).toISOString(); // 1 hour ago
      const oldTime = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString(); // 48 hours ago

      await insertArticle({ id: 'recent', publishedAt: recentTime });
      await insertArticle({ id: 'old', publishedAt: oldTime });

      const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
      const result = await selectDigestArticles(db, since);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('recent');
    });

    it('should return at most 20 articles', async () => {
      const now = new Date();
      // Insert 25 articles
      for (let i = 0; i < 25; i++) {
        const publishedAt = new Date(now.getTime() - i * 60 * 1000).toISOString(); // each 1 min apart
        await insertArticle({ id: `art-${i}`, publishedAt });
      }

      const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
      const result = await selectDigestArticles(db, since);

      expect(result).toHaveLength(20);
    });

    it('should order articles by published_at DESC (newest first)', async () => {
      const now = new Date();
      const t1 = new Date(now.getTime() - 1 * 60 * 60 * 1000).toISOString();
      const t2 = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
      const t3 = new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString();

      await insertArticle({ id: 'oldest', publishedAt: t3 });
      await insertArticle({ id: 'newest', publishedAt: t1 });
      await insertArticle({ id: 'middle', publishedAt: t2 });

      const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
      const result = await selectDigestArticles(db, since);

      expect(result).toHaveLength(3);
      expect(result[0].id).toBe('newest');
      expect(result[1].id).toBe('middle');
      expect(result[2].id).toBe('oldest');
    });

    it('should correctly map article fields', async () => {
      const now = new Date().toISOString();
      await insertArticle({ id: 'mapped', title: 'My Title', publishedAt: now, summary: 'My Summary' });

      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const result = await selectDigestArticles(db, since);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('mapped');
      expect(result[0].title).toBe('My Title');
      expect(result[0].subscriptionId).toBe('sub1');
      expect(result[0].author).toBe('Author');
      expect(result[0].summary).toBe('My Summary');
      expect(result[0].contentUrl).toBe('/path');
      expect(result[0].isRead).toBe(false);
    });

    it('should exclude read articles even if within time range', async () => {
      const now = new Date().toISOString();
      await insertArticle({ id: 'read1', publishedAt: now, isRead: 1 });
      await insertArticle({ id: 'read2', publishedAt: now, isRead: 1 });
      await insertArticle({ id: 'unread1', publishedAt: now, isRead: 0 });

      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const result = await selectDigestArticles(db, since);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('unread1');
    });
  });

  describe('generateDigest', () => {
    it('should return cached digest if exists (cache check)', async () => {
      await db
        .prepare("INSERT INTO daily_digests (date, content, article_count, generated_at) VALUES ('2024-01-15', 'Cached content', 3, '2024-01-15T08:00:00Z')")
        .run();

      const result = await generateDigest(db, 'test-key', [], '2024-01-15');

      expect(result.date).toBe('2024-01-15');
      expect(result.content).toBe('Cached content');
      expect(result.articleCount).toBe(3);
      expect(result.generatedAt).toBe('2024-01-15T08:00:00Z');
    });

    it('should return empty digest when no articles provided', async () => {
      const result = await generateDigest(db, 'test-key', [], '2024-01-15');

      expect(result.date).toBe('2024-01-15');
      expect(result.content).toBe('No new unread articles in the last 24 hours.');
      expect(result.articleCount).toBe(0);
      expect(result.generatedAt).toBeTruthy();
    });

    it('should store empty digest in cache', async () => {
      await generateDigest(db, 'test-key', [], '2024-01-15');

      // Verify it was stored
      const cached = await getDailyDigest(db, '2024-01-15');
      expect(cached).not.toBeNull();
      expect(cached!.content).toBe('No new unread articles in the last 24 hours.');
      expect(cached!.articleCount).toBe(0);
    });
  });
});
