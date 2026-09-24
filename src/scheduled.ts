/**
 * Hourly cron handler.
 *
 * Wired via [triggers] crons in wrangler.toml ("0 * * * *"). Runs the exact
 * same refresh pipeline as the manual refresh endpoint (fetch feeds →
 * update health counters → deduplicate → insert new articles unread +
 * persist full content to GitHub storage).
 *
 * Free-tier Workers have a hard 10ms CPU budget per invocation and feed XML
 * parsing is CPU-bound, so each run processes at most CRON_MAX_FEEDS
 * subscriptions (default 10), picking the stalest-fetched ones first — a
 * subscription list larger than the cap rotates across successive hourly
 * runs. Abnormal (disabled) subscriptions are skipped; the health mechanism
 * re-enables them after the first successful manual refresh.
 */

import type { Env, Subscription } from './types';
import { refreshSubscriptionsAndStore } from './services/feed-refresh';

const DEFAULT_MAX_FEEDS = 10;

export async function handleScheduled(
  controller: ScheduledController,
  env: Env,
  _ctx: ExecutionContext
): Promise<void> {
  const parsed = Number(env.CRON_MAX_FEEDS);
  const maxFeeds = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_FEEDS;

  // Stalest first: never-fetched subscriptions before old-fetched ones.
  const subsResult = await env.DB.prepare(
    `SELECT * FROM subscriptions
     WHERE disabled = 0
     ORDER BY (last_fetched_at IS NULL) DESC, last_fetched_at ASC
     LIMIT ?`
  )
    .bind(maxFeeds)
    .all();

  const subscriptions = (subsResult.results ?? []).map((row: Record<string, unknown>) => ({
    id: row.id as string,
    url: row.url as string,
    title: row.title as string,
    categoryId: row.category_id as string,
    createdAt: row.created_at as string,
    lastFetchedAt: (row.last_fetched_at as string) || null,
  }));

  if (subscriptions.length === 0) {
    console.log('[CFRSS] cron refresh: no subscriptions to refresh');
    return;
  }

  const outcome = await refreshSubscriptionsAndStore(env, subscriptions);

  console.log(
    `[CFRSS] cron refresh (${controller.cron}, batch=${subscriptions.length}): ` +
      `refreshed=${outcome.refreshed} newArticles=${outcome.newArticles} failures=${outcome.failures.length}`
  );
}
