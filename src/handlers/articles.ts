import type { Context } from 'hono';
import type { Env } from '../types';
import { refreshAllFeeds, type FeedRefreshFailure } from '../services/content-fetcher';
import { notFoundError } from '../utils/errors';
import { parsePageLimit, isApproachingCpuLimit, markTruncated } from '../middleware/cpu-monitor';

/**
 * GET /api/articles
 *
 * Returns a paginated list of articles ordered by published_at DESC.
 * Supports optional query params:
 *   - ?unread=true  — filter to unread articles only
 *   - ?subscriptionId=xxx — filter by subscription
 *   - ?limit=N — max articles to return (default 50, max 100)
 *   - ?offset=N — pagination offset (default 0)
 */
export async function handleListArticles(c: Context<{ Bindings: Env }>) {
  const db = c.env.DB;

  const unread = c.req.query('unread');
  const subscriptionId = c.req.query('subscriptionId');
  const limit = parsePageLimit(c.req.query('limit'));
  const offset = Math.max(0, parseInt(c.req.query('offset') || '0', 10) || 0);

  let sql = 'SELECT * FROM articles';
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (unread === 'true') {
    conditions.push('is_read = 0');
  }

  if (subscriptionId) {
    conditions.push('subscription_id = ?');
    params.push(subscriptionId);
  }

  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }

  sql += ' ORDER BY published_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const result = await db.prepare(sql).bind(...params).all();

  const articles = (result.results ?? []).map(mapArticleRow);

  // Check if we're approaching CPU limits after DB query
  let truncated = false;
  if (isApproachingCpuLimit(c)) {
    truncated = true;
    markTruncated(c);
  }

  return c.json({ articles, truncated, limit, offset });
}

/**
 * GET /api/articles/:id
 *
 * Returns a single article by ID. Returns 404 if not found.
 */
export async function handleGetArticle(c: Context<{ Bindings: Env }>) {
  const db = c.env.DB;
  const id = c.req.param('id')!;

  const result = await db
    .prepare('SELECT * FROM articles WHERE id = ?')
    .bind(id)
    .first();

  if (!result) {
    throw notFoundError(`Article not found: ${id}`);
  }

  return c.json({ article: mapArticleRow(result) });
}

/**
 * POST /api/articles/refresh
 *
 * Triggers a refresh for all subscriptions. Fetches feeds in parallel,
 * inserts new articles into D1 (deduplicating by source_url), and returns
 * a summary of the refresh operation.
 */
export async function handleRefreshFeeds(c: Context<{ Bindings: Env }>) {
  const db = c.env.DB;

  // Get all subscriptions
  const subsResult = await db
    .prepare('SELECT * FROM subscriptions')
    .all();

  const subscriptions = (subsResult.results ?? []).map((row: Record<string, unknown>) => ({
    id: row.id as string,
    url: row.url as string,
    title: row.title as string,
    categoryId: row.category_id as string,
    createdAt: row.created_at as string,
    lastFetchedAt: (row.last_fetched_at as string) || null,
  }));

  // Refresh all feeds in parallel
  const refreshResult = await refreshAllFeeds(subscriptions);

  // Get existing source_urls to deduplicate
  const existingUrlsResult = await db
    .prepare('SELECT source_url FROM articles')
    .all();

  const existingUrls = new Set(
    (existingUrlsResult.results ?? []).map((r: Record<string, unknown>) => r.source_url as string)
  );

  // Insert new articles
  let newArticleCount = 0;

  for (const success of refreshResult.successes) {
    for (const article of success.articles) {
      // Skip articles whose source_url already exists (dedup)
      if (existingUrls.has(article.sourceUrl)) {
        continue;
      }

      const articleId = crypto.randomUUID();
      const contentPath = `articles/${articleId}`;

      await db
        .prepare(
          `INSERT INTO articles (id, subscription_id, title, author, published_at, summary, content_path, source_url, is_read, fetched_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, datetime('now'))`
        )
        .bind(
          articleId,
          success.subscriptionId,
          article.title,
          article.author,
          article.publishedAt || new Date().toISOString(),
          article.summary,
          contentPath,
          article.sourceUrl
        )
        .run();

      // Track the URL so later articles in the same batch also get deduped
      existingUrls.add(article.sourceUrl);
      newArticleCount++;
    }

    // Update last_fetched_at for the subscription
    await db
      .prepare("UPDATE subscriptions SET last_fetched_at = datetime('now') WHERE id = ?")
      .bind(success.subscriptionId)
      .run();
  }

  const failures: FeedRefreshFailure[] = refreshResult.failures;

  return c.json({
    refreshed: refreshResult.successes.length,
    newArticles: newArticleCount,
    failures,
  });
}

// === Helpers ===

/**
 * Maps a raw D1 row to a typed Article response object.
 */
function mapArticleRow(row: Record<string, unknown>) {
  return {
    id: row.id as string,
    subscriptionId: row.subscription_id as string,
    title: row.title as string,
    author: row.author as string,
    publishedAt: row.published_at as string,
    summary: row.summary as string,
    contentPath: row.content_path as string,
    sourceUrl: row.source_url as string,
    isRead: row.is_read === 1,
    fetchedAt: row.fetched_at as string,
  };
}
