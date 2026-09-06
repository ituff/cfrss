/**
 * Subscription Manager - Category & Subscription CRUD operations.
 *
 * Manages category lifecycle: create, rename, delete, and list.
 * Manages subscription lifecycle: add, delete, move, and list.
 * Ensures the 'default' category cannot be deleted or renamed,
 * and cascades subscriptions to 'default' on category deletion.
 */

import { Category, Subscription } from '../types';
import { validationError, notFoundError, conflictError } from '../utils/errors';

/**
 * List all categories ordered by sort_order.
 */
export async function listCategories(db: D1Database): Promise<Category[]> {
  const stmt = db.prepare('SELECT id, name, sort_order FROM categories ORDER BY sort_order ASC');
  const result = await stmt.all<{ id: string; name: string; sort_order: number }>();
  return (result.results ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    order: row.sort_order,
  }));
}

/**
 * Create a new category with a generated UUID.
 * Validates name length (1-50 chars).
 */
export async function createCategory(db: D1Database, name: string): Promise<Category> {
  validateCategoryName(name);

  const id = crypto.randomUUID();
  // New categories get a sort_order after existing ones
  const maxOrder = await db
    .prepare('SELECT COALESCE(MAX(sort_order), 0) as max_order FROM categories')
    .first<{ max_order: number }>();
  const sortOrder = (maxOrder?.max_order ?? 0) + 1;

  await db
    .prepare('INSERT INTO categories (id, name, sort_order) VALUES (?, ?, ?)')
    .bind(id, name, sortOrder)
    .run();

  return { id, name, order: sortOrder };
}

/**
 * Rename an existing category.
 * Validates name length, checks category exists, prevents renaming 'default'.
 */
export async function renameCategory(db: D1Database, id: string, name: string): Promise<Category> {
  validateCategoryName(name);

  if (id === 'default') {
    throw validationError('Cannot rename the default category');
  }

  const existing = await db
    .prepare('SELECT id, name, sort_order FROM categories WHERE id = ?')
    .bind(id)
    .first<{ id: string; name: string; sort_order: number }>();

  if (!existing) {
    throw notFoundError(`Category not found: ${id}`);
  }

  await db
    .prepare('UPDATE categories SET name = ? WHERE id = ?')
    .bind(name, id)
    .run();

  return { id, name, order: existing.sort_order };
}

/**
 * Delete a category and move all its subscriptions to 'default'.
 * Prevents deleting the 'default' category.
 */
export async function deleteCategory(db: D1Database, id: string): Promise<void> {
  if (id === 'default') {
    throw validationError('Cannot delete the default category');
  }

  const existing = await db
    .prepare('SELECT id FROM categories WHERE id = ?')
    .bind(id)
    .first<{ id: string }>();

  if (!existing) {
    throw notFoundError(`Category not found: ${id}`);
  }

  // Cascade: move subscriptions to default
  await db
    .prepare("UPDATE subscriptions SET category_id = 'default' WHERE category_id = ?")
    .bind(id)
    .run();

  await db
    .prepare('DELETE FROM categories WHERE id = ?')
    .bind(id)
    .run();
}

/**
 * Validate category name length (1-50 characters).
 */
function validateCategoryName(name: string): void {
  if (name.length < 1 || name.length > 50) {
    throw validationError('Category name must be between 1 and 50 characters');
  }
}


// === Subscription CRUD ===

interface SubscriptionRow {
  id: string;
  url: string;
  title: string;
  category_id: string;
  created_at: string;
  last_fetched_at: string | null;
  fail_count?: number;
  disabled?: number;
  unread_count?: number;
}

function rowToSubscription(row: SubscriptionRow): Subscription {
  return {
    id: row.id,
    url: row.url,
    title: row.title,
    categoryId: row.category_id,
    createdAt: row.created_at,
    lastFetchedAt: row.last_fetched_at,
    failCount: row.fail_count ?? 0,
    disabled: (row.disabled ?? 0) === 1,
    unreadCount: row.unread_count ?? 0,
  };
}

/**
 * Reset a subscription's health state (clear abnormal flag and failure counter).
 */
export async function resetSubscriptionHealth(db: D1Database, id: string): Promise<void> {
  await db
    .prepare('UPDATE subscriptions SET fail_count = 0, disabled = 0 WHERE id = ?')
    .bind(id)
    .run();
}

/**
 * Validate subscription URL format.
 * Must be http:// or https:// and at most 2048 characters.
 */
function validateSubscriptionUrl(url: string): void {
  if (url.length > 2048) {
    throw validationError('URL must be at most 2048 characters');
  }
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    throw validationError('URL must start with http:// or https://');
  }
}

/**
 * List all subscriptions ordered by creation date.
 */
export async function listSubscriptions(db: D1Database): Promise<Subscription[]> {
  const stmt = db.prepare(
    `SELECT s.id, s.url, s.title, s.category_id, s.created_at, s.last_fetched_at, s.fail_count, s.disabled,
            (SELECT COUNT(*) FROM articles a WHERE a.subscription_id = s.id AND a.is_read = 0) AS unread_count
     FROM subscriptions s ORDER BY s.created_at ASC`
  );
  const result = await stmt.all<SubscriptionRow>();
  return (result.results ?? []).map(rowToSubscription);
}

/**
 * Add a new subscription.
 * Validates URL format (http/https, ≤2048 chars) and checks for duplicates.
 * Throws conflictError if URL already exists.
 */
export async function addSubscription(
  db: D1Database,
  url: string,
  title: string,
  categoryId: string = 'default'
): Promise<Subscription> {
  validateSubscriptionUrl(url);

  // Check for duplicate URL
  const existing = await db
    .prepare('SELECT id FROM subscriptions WHERE url = ?')
    .bind(url)
    .first<{ id: string }>();

  if (existing) {
    throw conflictError('Subscription already exists');
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

  await db
    .prepare(
      'INSERT INTO subscriptions (id, url, title, category_id, created_at) VALUES (?, ?, ?, ?, ?)'
    )
    .bind(id, url, title, categoryId, now)
    .run();

  return {
    id,
    url,
    title,
    categoryId,
    createdAt: now,
    lastFetchedAt: null,
  };
}

/**
 * Delete a subscription by ID.
 * Throws notFoundError if subscription does not exist.
 */
export async function deleteSubscription(db: D1Database, id: string): Promise<void> {
  const existing = await db
    .prepare('SELECT id FROM subscriptions WHERE id = ?')
    .bind(id)
    .first<{ id: string }>();

  if (!existing) {
    throw notFoundError(`Subscription not found: ${id}`);
  }

  await db.prepare('DELETE FROM subscriptions WHERE id = ?').bind(id).run();
}

/**
 * Move a subscription to a different category.
 * Validates both subscription and category exist.
 */
/**
 * Update a subscription's title and/or RSS URL.
 * Validates the URL format and checks it isn't used by another subscription.
 * Throws notFoundError if the subscription doesn't exist.
 */
export async function updateSubscription(
  db: D1Database,
  id: string,
  updates: { title?: string; url?: string }
): Promise<Subscription> {
  const existing = await db
    .prepare('SELECT id FROM subscriptions WHERE id = ?')
    .bind(id)
    .first<{ id: string }>();
  if (!existing) {
    throw notFoundError(`Subscription not found: ${id}`);
  }

  if (updates.title !== undefined) {
    const title = updates.title.trim();
    if (!title || title.length > 200) {
      throw validationError('Title must be 1-200 characters');
    }
    await db.prepare('UPDATE subscriptions SET title = ? WHERE id = ?').bind(title, id).run();
  }

  if (updates.url !== undefined) {
    const url = updates.url.trim();
    validateSubscriptionUrl(url);

    // Dedup: the URL must not be used by a different subscription
    const dup = await db
      .prepare('SELECT id FROM subscriptions WHERE url = ? AND id != ?')
      .bind(url, id)
      .first<{ id: string }>();
    if (dup) {
      throw conflictError('URL is already used by another subscription');
    }

    await db
      .prepare("UPDATE subscriptions SET url = ?, last_fetched_at = NULL, fail_count = 0, disabled = 0 WHERE id = ?")
      .bind(url, id)
      .run();
  }

  const updated = await db
    .prepare(
      `SELECT s.id, s.url, s.title, s.category_id, s.created_at, s.last_fetched_at, s.fail_count, s.disabled,
              (SELECT COUNT(*) FROM articles a WHERE a.subscription_id = s.id AND a.is_read = 0) AS unread_count
       FROM subscriptions s WHERE s.id = ?`
    )
    .bind(id)
    .first<SubscriptionRow>();
  if (!updated) {
    throw notFoundError(`Subscription not found: ${id}`);
  }
  return rowToSubscription(updated);
}

export async function moveSubscription(
  db: D1Database,
  id: string,
  categoryId: string
): Promise<Subscription> {
  const existing = await db
    .prepare('SELECT id, url, title, category_id, created_at, last_fetched_at FROM subscriptions WHERE id = ?')
    .bind(id)
    .first<SubscriptionRow>();

  if (!existing) {
    throw notFoundError(`Subscription not found: ${id}`);
  }

  const category = await db
    .prepare('SELECT id FROM categories WHERE id = ?')
    .bind(categoryId)
    .first<{ id: string }>();

  if (!category) {
    throw notFoundError(`Category not found: ${categoryId}`);
  }

  await db
    .prepare('UPDATE subscriptions SET category_id = ? WHERE id = ?')
    .bind(categoryId, id)
    .run();

  return {
    id: existing.id,
    url: existing.url,
    title: existing.title,
    categoryId,
    createdAt: existing.created_at,
    lastFetchedAt: existing.last_fetched_at,
  };
}
