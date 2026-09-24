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
//
// The cron runs hourly and refreshes only CRON_MAX_FEEDS subscriptions per run,
// cycling by least-recently-fetched, so a subscription is re-examined roughly
// once every (total_feeds / CRON_MAX_FEEDS) hours. With 42 feeds and a cap of
// 10 that is ~4h between attempts. A low threshold would therefore disable a
// feed after a single bad afternoon (a flaky host, a brief outage), so the
// threshold has to span multiple days: 24 consecutive failures ≈ 4 days.
//
// ⚠️ Raising this value does NOT re-enable feeds that were already disabled
// under an older, lower value. A disabled feed is never selected again (the
// cron filters on `disabled = 0`, and the manual refresh only includes them
// when force=true), so its fail_count freezes at whatever it was and it stays
// disabled indefinitely. Observed 2026-09-21: the value went 5 → 24 on
// 2026-09-18 and three feeds disabled under the old rule were still stuck at
// fail_count = 6 days later, with last_fetched_at still NULL.
//
// The only recovery is an explicit re-enable — `PUT /api/subscriptions/:id/enable`,
// surfaced in the UI as the "重新启用" action on a feed marked ⚠. If you change
// this threshold, consider re-enabling previously disabled feeds in the same
// breath, or the change silently applies to no one.
const MAX_CONSECUTIVE_FAILURES = 24;

/**
 * A subscription is only eligible for auto-disable once it has been observed
 * for long enough that its failure count is meaningful. Without this, a feed
 * whose failure counter had been accumulating since long before the current
 * policy reset it to 0 would be disabled on its very next failure.
 */
const DISABLE_MIN_AGE_HOURS = 24;

/**
 * Classify a fetch error as transient (upstream-side hiccup) rather than a
 * statement about the feed's health.
 *
 * Rationale: a site whose origin is briefly unavailable answers with a 5xx —
 * a different failure class from a feed that is genuinely gone (404, DNS
 * failure, TLS error, or a UA block). Counting 5xx toward the auto-disable
 * threshold would let an unlucky afternoon of upstream flakiness retire a
 * perfectly good subscription.
 *
 * Exported for the test suite.
 */
export function isTransientFailure(error: string | undefined): boolean {
  if (!error) return false;
  // "HTTP <code>" — 5xx is upstream trouble. 4xx is not: 404/410 mean the feed
  // moved or died, and a 403 means the site is actively blocking us.
  const status = /^HTTP (\d{3})/.exec(error);
  if (status) {
    const code = Number(status[1]);
    return code >= 500 && code <= 599;
  }
  // An upstream that never responds is a timeout on their side, not a dead feed.
  if (/^Timeout after /.test(error)) return true;
  return false;
}

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
  // successes reset the counter. Transient upstream errors (5xx, upstream
  // timeouts) are deliberately excluded — they say nothing about whether the
  // feed itself is still alive, and counting them would flag healthy feeds.
  for (const failure of refreshResult.failures) {
    if (isTransientFailure(failure.error)) {
      continue;
    }
    // Auto-disable only once the subscription is old enough for its failure
    // count to reflect the current policy (see DISABLE_MIN_AGE_HOURS).
    await db
      .prepare(
        `UPDATE subscriptions
         SET fail_count = fail_count + 1,
             disabled = CASE
               WHEN fail_count + 1 >= ?
                AND created_at <= datetime('now', ?)
               THEN 1 ELSE disabled END
         WHERE id = ?`
      )
      .bind(MAX_CONSECUTIVE_FAILURES, `-${DISABLE_MIN_AGE_HOURS} hours`, failure.subscriptionId)
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
