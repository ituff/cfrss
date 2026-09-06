import type { Context } from 'hono';
import type { Env, GitHubConfig } from '../types';
import { refreshAllFeeds, type FeedRefreshFailure } from '../services/content-fetcher';
import { storeArticle, getArticleContent, type ArticleStorageData } from '../services/content-store';
import { getConfig } from '../services/config-store';
import { decrypt } from '../utils/crypto';
import { notFoundError } from '../utils/errors';
import { parsePageLimit, isApproachingCpuLimit, markTruncated } from '../middleware/cpu-monitor';

/**
 * Load the GitHub storage config from D1, decrypting the PAT.
 * Returns null when GitHub storage is not configured.
 */
async function loadGitHubConfig(db: Env['DB'], encryptionKey: string): Promise<GitHubConfig | null> {
  const [owner, name, tokenEncrypted, branch, contentPath] = await Promise.all([
    getConfig(db, 'github_repo_owner'),
    getConfig(db, 'github_repo_name'),
    getConfig(db, 'github_token_encrypted'),
    getConfig(db, 'github_branch'),
    getConfig(db, 'github_content_path'),
  ]);
  if (!owner || !name || !tokenEncrypted) return null;
  const token = await decrypt(tokenEncrypted, encryptionKey);
  return { repoOwner: owner, repoName: name, token, branch: branch || 'main', contentPath: contentPath || 'articles' };
}

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

  // Refresh all feeds in parallel
  const refreshResult = await refreshAllFeeds(subscriptions);

  // Update health counters: failures count toward the abnormal threshold,
  // successes reset the counter.
  const MAX_CONSECUTIVE_FAILURES = 5;
  for (const failure of refreshResult.failures) {
    await db
      .prepare(
        `UPDATE subscriptions
         SET fail_count = fail_count + 1,
             disabled = CASE WHEN fail_count + 1 >= ? THEN 1 ELSE disabled END
         WHERE id = ?`
      )
      .bind(MAX_CONSECUTIVE_FAILURES, failure.subscriptionId)
      .run();
  }
  for (const success of refreshResult.successes) {
    // A successful fetch restores the feed's health (clears abnormal flag too)
    await db
      .prepare('UPDATE subscriptions SET fail_count = 0, disabled = 0 WHERE id = ? AND (fail_count > 0 OR disabled = 1)')
      .bind(success.subscriptionId)
      .run();
  }

  // Get existing source_urls to deduplicate — scoped to the subscriptions being
  // refreshed. Loading the whole articles table here pushes CPU over the free
  // tier limit once the table grows (Cloudflare error 1102).
  const existingUrls = new Set<string>();
  if (subscriptions.length > 0) {
    const placeholders = subscriptions.map(() => '?').join(', ');
    const existingUrlsResult = await db
      .prepare(`SELECT source_url FROM articles WHERE subscription_id IN (${placeholders})`)
      .bind(...subscriptions.map((s) => s.id))
      .all();
    for (const r of existingUrlsResult.results ?? []) {
      existingUrls.add((r as Record<string, unknown>).source_url as string);
    }
  }

  // Insert new articles, storing full content in GitHub storage
  let newArticleCount = 0;
  const ghConfig = await loadGitHubConfig(db, c.env.ENCRYPTION_KEY);
  const urlBySubscriptionId = new Map(subscriptions.map((s) => [s.id, s.url]));

  for (const success of refreshResult.successes) {
    for (const article of success.articles) {
      // Skip articles whose source_url already exists (dedup)
      if (existingUrls.has(article.sourceUrl)) {
        continue;
      }

      const articleId = crypto.randomUUID();
      const publishedAt = article.publishedAt || new Date().toISOString();

      // Persist the full content to GitHub storage (best effort —
      // the article is still indexed without it, but the detail
      // view will have no body until a successful re-fetch).
      let contentPath = `articles/${articleId}`;
      if (ghConfig) {
        try {
          const storageData: ArticleStorageData = {
            id: articleId,
            title: article.title,
            author: article.author,
            publishedAt,
            sourceUrl: article.sourceUrl,
            feedUrl: urlBySubscriptionId.get(success.subscriptionId) ?? '',
            htmlContent: article.htmlContent,
            fetchedAt: new Date().toISOString(),
          };
          contentPath = await storeArticle(ghConfig, storageData);
        } catch (error) {
          // Upload failed — keep the indexed row with the fallback path
          console.error(`[CFRSS] GitHub upload failed for ${articleId}:`, error instanceof Error ? error.message : error);
        }
      }

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
          publishedAt,
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
