/**
 * OPML Import/Export route handlers.
 *
 * Validates: Requirements 6.3, 6.6
 */

import type { Context } from 'hono';
import type { Env, OPMLImportResult } from '../types';
import { parseOPML, generateOPML, type SubscriptionWithCategory } from '../services/opml';
import { validationError } from '../utils/errors';

/**
 * POST /api/opml/import
 *
 * Accepts OPML content as:
 * - multipart/form-data with a file field named "file"
 * - raw text/xml or application/xml body
 *
 * Parses feeds, deduplicates against existing subscriptions,
 * creates categories as needed, and returns an import summary.
 */
export async function handleImportOPML(c: Context<{ Bindings: Env }>) {
  const db = c.env.DB;
  const contentType = c.req.header('content-type') || '';

  let opmlContent: string;

  if (contentType.includes('multipart/form-data')) {
    const formData = await c.req.formData();
    const file = formData.get('file');
    if (!file) {
      throw validationError('No file provided in form data');
    }
    if (file instanceof File) {
      opmlContent = await file.text();
    } else {
      opmlContent = file as string;
    }
  } else {
    opmlContent = await c.req.text();
  }

  if (!opmlContent || opmlContent.trim().length === 0) {
    throw validationError('OPML content is empty');
  }

  // Parse OPML (throws on invalid format)
  const parsed = parseOPML(opmlContent);

  // Get existing subscription URLs for deduplication
  const existingResult = await db
    .prepare('SELECT url FROM subscriptions')
    .all<{ url: string }>();
  const existingUrls = new Set((existingResult.results ?? []).map((r) => r.url));

  // Get existing categories for lookup
  const categoriesResult = await db
    .prepare('SELECT id, name FROM categories')
    .all<{ id: string; name: string }>();
  const categoryMap = new Map<string, string>();
  for (const cat of categoriesResult.results ?? []) {
    categoryMap.set(cat.name.toLowerCase(), cat.id);
  }

  const result: OPMLImportResult = {
    imported: 0,
    skipped: 0,
    failed: 0,
    details: [],
  };

  for (const feed of parsed.feeds) {
    // Skip if URL already exists (deduplication)
    if (existingUrls.has(feed.url)) {
      result.skipped++;
      result.details.push({ url: feed.url, status: 'skipped', reason: 'Duplicate URL' });
      continue;
    }

    try {
      // Determine category ID
      const categoryName = feed.category || 'default';
      let categoryId: string;

      if (categoryName === 'default') {
        categoryId = 'default';
      } else {
        const existingCategoryId = categoryMap.get(categoryName.toLowerCase());
        if (existingCategoryId) {
          categoryId = existingCategoryId;
        } else {
          // Create new category
          categoryId = crypto.randomUUID();
          const maxOrder = await db
            .prepare('SELECT COALESCE(MAX(sort_order), 0) as max_order FROM categories')
            .first<{ max_order: number }>();
          const sortOrder = (maxOrder?.max_order ?? 0) + 1;

          await db
            .prepare('INSERT INTO categories (id, name, sort_order) VALUES (?, ?, ?)')
            .bind(categoryId, categoryName, sortOrder)
            .run();

          // Add to local map so subsequent feeds in same category don't create duplicates
          categoryMap.set(categoryName.toLowerCase(), categoryId);
        }
      }

      // Insert subscription
      const subId = crypto.randomUUID();
      const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

      await db
        .prepare(
          'INSERT INTO subscriptions (id, url, title, category_id, created_at) VALUES (?, ?, ?, ?, ?)'
        )
        .bind(subId, feed.url, feed.title, categoryId, now)
        .run();

      // Track as imported and add to existing set to handle duplicates within the file
      existingUrls.add(feed.url);
      result.imported++;
      result.details.push({ url: feed.url, status: 'imported' });
    } catch (err) {
      result.failed++;
      const reason = err instanceof Error ? err.message : 'Unknown error';
      result.details.push({ url: feed.url, status: 'failed', reason });
    }
  }

  return c.json(result);
}

/**
 * GET /api/opml/export
 *
 * Fetches all subscriptions with category names and generates OPML XML.
 * Returns the file with proper XML Content-Type.
 */
export async function handleExportOPML(c: Context<{ Bindings: Env }>) {
  const db = c.env.DB;

  const rows = await db
    .prepare(
      `SELECT s.url, s.title, c.name as category_name
       FROM subscriptions s
       LEFT JOIN categories c ON s.category_id = c.id
       ORDER BY c.sort_order ASC, s.created_at ASC`
    )
    .all<{ url: string; title: string; category_name: string | null }>();

  const subscriptions: SubscriptionWithCategory[] = (rows.results ?? []).map((row) => ({
    url: row.url,
    title: row.title,
    categoryName: row.category_name || '',
  }));

  const opmlXml = generateOPML(subscriptions);

  return new Response(opmlXml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Content-Disposition': 'attachment; filename="subscriptions.opml"',
    },
  });
}
