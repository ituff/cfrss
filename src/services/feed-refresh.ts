/**
 * Feed refresh orchestration service.
 *
 * Shared by the manual refresh endpoint (POST /api/articles/refresh, see
 * src/handlers/articles.ts) and the hourly cron handler (src/scheduled.ts):
 * fetches feeds in parallel, updates subscription health counters,
 * de-duplicates against existing articles and persists new ones — index row
 * in D1 (is_read = 0, i.e. unread) plus full content in GitHub storage.
 *
 * Validates: Requirements 14.1, 14.2 (refresh + persistence pipeline)
 */

import { refreshAllFeeds, type FeedRefreshFailure } from './content-fetcher';
import { storeArticle, loadGitHubConfig, type ArticleStorageData } from './content-store';
import type { Env, Subscription } from '../types';

export interface RefreshOutcome {
  refreshed: number;
  newArticles: number;
  failures: FeedRefreshFailure[];
}

// Failures count toward the abnormal threshold; successes reset the counter.
const MAX_CONSECUTIVE_FAILURES = 5;

/**
 * Refresh the given subscriptions and persist the result.
 * The caller is responsible for selecting which subscriptions to refresh.
 */
export async function refreshSubscriptionsAndStore(
  env: Env,
  subscriptions: Subscription[]
): Promise<RefreshOutcome> {
  const db = env.DB;

  // Refresh all feeds in parallel
  const refreshResult = await refreshAllFeeds(subscriptions);

  // Update health counters: failures count toward the abnormal threshold,
  // successes reset the counter.
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
  const ghConfig = await loadGitHubConfig(db, env.ENCRYPTION_KEY);
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

  return {
    refreshed: refreshResult.successes.length,
    newArticles: newArticleCount,
    failures: refreshResult.failures,
  };
}
