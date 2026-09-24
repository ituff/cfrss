import type { Context } from 'hono';
import type { Env } from '../types';
import { addBookmark, isBookmarked, listBookmarks, removeBookmark } from '../services/bookmarks';
import { notFoundError } from '../utils/errors';
import { parsePageLimit, isApproachingCpuLimit, markTruncated } from '../middleware/cpu-monitor';

/**
 * GET /api/bookmarks
 *
 * Returns bookmarked articles, most recently bookmarked first. Each item is a
 * `{ bookmark: {...}, article: {...} }` pair: the bookmark carries `createdAt`
 * (when it was saved) and the article carries the full card metadata, so the
 * client can render a list without a second request per row.
 *
 * Supports ?limit=N (default 50, max 100) and ?offset=N.
 */
export async function handleListBookmarks(c: Context<{ Bindings: Env }>) {
  const db = c.env.DB;
  const limit = parsePageLimit(c.req.query('limit'));
  const offset = Math.max(0, parseInt(c.req.query('offset') || '0', 10) || 0);

  const rows = await listBookmarks(db, limit, offset);

  const bookmarks = rows.map((row) => {
    const { articleId, createdAt, subscriptionId, title, author, publishedAt, summary, sourceUrl, isRead } = row;
    return {
      bookmark: { articleId, createdAt },
      article: { id: articleId, subscriptionId, title, author, publishedAt, summary, sourceUrl, isRead },
    };
  });

  let truncated = false;
  if (isApproachingCpuLimit(c)) {
    truncated = true;
    markTruncated(c);
  }

  return c.json({ bookmarks, truncated, limit, offset });
}

/**
 * GET /api/articles/:id/bookmark
 *
 * Whether the given article is bookmarked. Used by the reader toolbar to
 * restore the correct button state on load.
 */
export async function handleGetBookmarkState(c: Context<{ Bindings: Env }>) {
  const articleId = c.req.param('id')!;
  const bookmarked = await isBookmarked(c.env.DB, articleId);
  return c.json({ bookmarked });
}

/**
 * PUT /api/articles/:id/bookmark
 *
 * Bookmarks an article. Idempotent — repeating the call is a no-op and keeps
 * the original bookmark timestamp.
 */
export async function handleAddBookmark(c: Context<{ Bindings: Env }>) {
  const db = c.env.DB;
  const articleId = c.req.param('id')!;

  const ok = await addBookmark(db, articleId);
  if (!ok) {
    throw notFoundError(`Article not found: ${articleId}`);
  }

  return c.json({ success: true, bookmarked: true });
}

/**
 * DELETE /api/articles/:id/bookmark
 *
 * Removes a bookmark. Returns 404 when the article was not bookmarked.
 */
export async function handleRemoveBookmark(c: Context<{ Bindings: Env }>) {
  const db = c.env.DB;
  const articleId = c.req.param('id')!;

  const removed = await removeBookmark(db, articleId);
  if (!removed) {
    throw notFoundError(`Bookmark not found: ${articleId}`);
  }

  return c.json({ success: true, bookmarked: false });
}
