import type { Context } from 'hono';
import type { Env } from '../types';
import { getArticleContent, loadGitHubConfig } from '../services/content-store';
import { refreshSubscriptionsAndStore } from '../services/feed-refresh';
import { notFoundError, validationError } from '../utils/errors';
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

  const article = mapArticleRow(result) as Record<string, unknown>;

  // Full content lives in GitHub storage — fetch and attach it
  try {
    const ghConfig = await loadGitHubConfig(db, c.env.ENCRYPTION_KEY);
    if (ghConfig && article.contentPath) {
      const content = await getArticleContent(ghConfig, article.contentPath as string);
      if (content) {
        article.htmlContent = content.htmlContent;
        if (content.title) article.title = content.title;
        if (content.author) article.author = content.author;
      }
    }
  } catch {
    // Storage unavailable — return metadata without content
  }

  return c.json({ article });
}

/**
 * POST /api/articles/refresh
 *
 * Triggers a refresh for all subscriptions. Fetches feeds in parallel,
 * inserts new articles into D1 (deduplicating by source_url), and returns
 * a summary of the refresh operation.
 */
/**
 * PUT /api/articles/:id/read
 *
 * Marks an article read or unread.
 * Accepts { isRead: boolean } in the request body.
 */
export async function handleUpdateReadState(c: Context<{ Bindings: Env }>) {
  const db = c.env.DB;
  const id = c.req.param('id')!;
  const body = await c.req.json<{ isRead?: boolean }>();

  if (typeof body.isRead !== 'boolean') {
    throw validationError('isRead is required and must be a boolean');
  }

  const result = await db
    .prepare('UPDATE articles SET is_read = ? WHERE id = ?')
    .bind(body.isRead ? 1 : 0, id)
    .run();

  if ((result.meta.changes ?? 0) === 0) {
    throw notFoundError(`Article not found: ${id}`);
  }

  return c.json({ success: true, isRead: body.isRead });
}

export async function handleRefreshFeeds(c: Context<{ Bindings: Env }>) {
  const db = c.env.DB;

  // Optional body { ids?: string[], force?: boolean } — refresh only the given
  // subscriptions, and optionally retry ones already marked abnormal.
  // The free tier's 10ms CPU budget can't parse every feed in one request,
  // so callers (the web client) chunk large subscription lists.
  let filterIds: string[] | null = null;
  let force = false;
  try {
    const body = await c.req.json<{ ids?: string[]; force?: boolean }>();
    if (body?.ids?.length) {
      filterIds = body.ids;
    }
    force = body?.force === true;
  } catch {
    // No JSON body — refresh everything
  }

  // Get subscriptions. Subscriptions marked abnormal (disabled) are skipped
  // unless force=true — they keep failing and would otherwise burn the
  // request's resource budget on every refresh.
  const subsResult = force
    ? await db.prepare('SELECT * FROM subscriptions').all()
    : await db.prepare('SELECT * FROM subscriptions WHERE disabled = 0').all();

  let subscriptions = (subsResult.results ?? []).map((row: Record<string, unknown>) => ({
    id: row.id as string,
    url: row.url as string,
    title: row.title as string,
    categoryId: row.category_id as string,
    createdAt: row.created_at as string,
    lastFetchedAt: (row.last_fetched_at as string) || null,
  }));

  if (filterIds) {
    const idSet = new Set(filterIds);
    subscriptions = subscriptions.filter((s) => idSet.has(s.id));
  }

  // Fetch, deduplicate and persist — shared with the hourly cron handler
  const outcome = await refreshSubscriptionsAndStore(c.env, subscriptions);

  return c.json({
    refreshed: outcome.refreshed,
    newArticles: outcome.newArticles,
    failures: outcome.failures,
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
