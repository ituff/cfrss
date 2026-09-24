/**
 * Bookmarks service — persisted per-article "save for later" state.
 *
 * Single-user application, so bookmark rows carry no user identifier:
 * `bookmarks.article_id` is the primary key, which makes toggling naturally
 * idempotent (adding twice cannot duplicate a row).
 *
 * Follows the same shape as subscription-manager.ts: plain functions taking a
 * `D1Database` first, returning camelCase objects mapped from snake_case rows.
 */

import type { Bookmark } from '../types';

interface BookmarkRow {
  article_id: string;
  created_at: string;
  subscription_id: string;
  title: string;
  author: string | null;
  published_at: string;
  summary: string | null;
  source_url: string;
  is_read: number | null;
}

function rowToBookmark(row: BookmarkRow): Bookmark {
  return {
    articleId: row.article_id,
    createdAt: row.created_at,
    subscriptionId: row.subscription_id,
    title: row.title,
    author: row.author ?? '',
    publishedAt: row.published_at,
    summary: row.summary ?? '',
    sourceUrl: row.source_url,
    isRead: (row.is_read ?? 0) === 1,
  };
}

/**
 * List bookmarked articles, most recently bookmarked first.
 *
 * Joins the article metadata so the list view can render cards without a
 * second round-trip. Rows whose article has been deleted leave with the
 * article (ON DELETE CASCADE), so the join never drops legitimately.
 */
export async function listBookmarks(
  db: D1Database,
  limit = 50,
  offset = 0
): Promise<Bookmark[]> {
  const result = await db
    .prepare(
      `SELECT b.article_id, b.created_at,
              a.subscription_id, a.title, a.author, a.published_at,
              a.summary, a.source_url, a.is_read
       FROM bookmarks b
       JOIN articles a ON a.id = b.article_id
       ORDER BY b.created_at DESC, b.article_id DESC
       LIMIT ? OFFSET ?`
    )
    .bind(limit, offset)
    .all<BookmarkRow>();

  return (result.results ?? []).map(rowToBookmark);
}

/** Whether a single article is bookmarked. */
export async function isBookmarked(db: D1Database, articleId: string): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 AS hit FROM bookmarks WHERE article_id = ?')
    .bind(articleId)
    .first();

  return row !== null && row !== undefined;
}

/**
 * Bookmark an article. Idempotent — bookmarking an already-bookmarked article
 * succeeds without changing the original `created_at`.
 *
 * Returns false when the article does not exist (the FK would reject the row).
 */
export async function addBookmark(db: D1Database, articleId: string): Promise<boolean> {
  const article = await db
    .prepare('SELECT 1 AS hit FROM articles WHERE id = ?')
    .bind(articleId)
    .first();

  if (article === null || article === undefined) {
    return false;
  }

  await db
    .prepare('INSERT OR IGNORE INTO bookmarks (article_id) VALUES (?)')
    .bind(articleId)
    .run();

  return true;
}

/**
 * Remove a bookmark. Returns false when the article was not bookmarked, so the
 * caller can answer 404 instead of pretending the removal did something.
 */
export async function removeBookmark(db: D1Database, articleId: string): Promise<boolean> {
  const result = await db
    .prepare('DELETE FROM bookmarks WHERE article_id = ?')
    .bind(articleId)
    .run();

  return (result.meta.changes ?? 0) > 0;
}
