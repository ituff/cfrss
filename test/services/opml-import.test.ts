/**
 * Tests for OPML import/export handlers.
 *
 * Validates: Requirements 6.3, 6.6
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { setupTestDatabase } from '../setup';
import { handleImportOPML, handleExportOPML } from '../../src/handlers/opml';
import type { Context } from 'hono';
import type { Env, OPMLImportResult } from '../../src/types';

// Helper to create a minimal Hono-like context for testing handlers
function createMockContext(options: {
  body?: string;
  contentType?: string;
  formData?: FormData;
}): Context<{ Bindings: Env }> {
  const { body = '', contentType = 'text/xml', formData } = options;

  return {
    env: { DB: env.DB, ENCRYPTION_KEY: 'test-key', AUTH_TOKEN: 'test-token' },
    req: {
      header: (name: string) => {
        if (name === 'content-type') return contentType;
        return undefined;
      },
      text: async () => body,
      formData: async () => formData!,
    },
    json: (data: unknown, status?: number) => {
      return new Response(JSON.stringify(data), {
        status: status || 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  } as unknown as Context<{ Bindings: Env }>;
}

const SAMPLE_OPML = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>Test Feeds</title></head>
  <body>
    <outline text="Tech" title="Tech">
      <outline type="rss" text="TechCrunch" title="TechCrunch" xmlUrl="https://techcrunch.com/feed"/>
      <outline type="rss" text="Ars Technica" title="Ars Technica" xmlUrl="https://arstechnica.com/feed"/>
    </outline>
    <outline type="rss" text="Top Level Feed" title="Top Level Feed" xmlUrl="https://toplevel.com/rss"/>
  </body>
</opml>`;

describe('OPML Import Handler', () => {
  let db: D1Database;

  beforeEach(async () => {
    db = env.DB;
    await setupTestDatabase(db);
    await db.prepare('DELETE FROM subscriptions').run();
    await db.prepare("DELETE FROM categories WHERE id != 'default'").run();
  });

  it('should import feeds from OPML text body', async () => {
    const ctx = createMockContext({ body: SAMPLE_OPML });
    const response = await handleImportOPML(ctx);
    const result: OPMLImportResult = await response.json();

    expect(result.imported).toBe(3);
    expect(result.skipped).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.details).toHaveLength(3);
  });

  it('should create categories from OPML structure', async () => {
    const ctx = createMockContext({ body: SAMPLE_OPML });
    await handleImportOPML(ctx);

    const categories = await db
      .prepare('SELECT name FROM categories ORDER BY sort_order ASC')
      .all<{ name: string }>();
    const names = (categories.results ?? []).map((r) => r.name);
    expect(names).toContain('Tech');
  });

  it('should assign feeds to correct categories', async () => {
    const ctx = createMockContext({ body: SAMPLE_OPML });
    await handleImportOPML(ctx);

    // Top-level feed should be in 'default'
    const topLevel = await db
      .prepare("SELECT category_id FROM subscriptions WHERE url = 'https://toplevel.com/rss'")
      .first<{ category_id: string }>();
    expect(topLevel?.category_id).toBe('default');

    // Tech feed should be in the 'Tech' category
    const techCat = await db
      .prepare("SELECT id FROM categories WHERE name = 'Tech'")
      .first<{ id: string }>();
    const techFeed = await db
      .prepare("SELECT category_id FROM subscriptions WHERE url = 'https://techcrunch.com/feed'")
      .first<{ category_id: string }>();
    expect(techFeed?.category_id).toBe(techCat?.id);
  });

  it('should skip duplicate URLs', async () => {
    // Pre-insert a subscription
    await db
      .prepare(
        "INSERT INTO subscriptions (id, url, title, category_id, created_at) VALUES ('existing-1', 'https://techcrunch.com/feed', 'TC', 'default', '2024-01-01 00:00:00')"
      )
      .run();

    const ctx = createMockContext({ body: SAMPLE_OPML });
    const response = await handleImportOPML(ctx);
    const result: OPMLImportResult = await response.json();

    expect(result.imported).toBe(2);
    expect(result.skipped).toBe(1);
    expect(result.details.find((d) => d.status === 'skipped')?.url).toBe(
      'https://techcrunch.com/feed'
    );
    expect(result.details.find((d) => d.status === 'skipped')?.reason).toBe('Duplicate URL');
  });

  it('should handle duplicates within the same OPML file', async () => {
    const opmlWithDupes = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>Dupes</title></head>
  <body>
    <outline type="rss" text="Feed A" xmlUrl="https://same.com/feed"/>
    <outline type="rss" text="Feed B" xmlUrl="https://same.com/feed"/>
  </body>
</opml>`;

    const ctx = createMockContext({ body: opmlWithDupes });
    const response = await handleImportOPML(ctx);
    const result: OPMLImportResult = await response.json();

    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(1);
  });

  it('should reuse existing categories by name (case-insensitive)', async () => {
    // Create a "Tech" category first
    await db
      .prepare("INSERT INTO categories (id, name, sort_order) VALUES ('tech-cat', 'Tech', 1)")
      .run();

    const ctx = createMockContext({ body: SAMPLE_OPML });
    await handleImportOPML(ctx);

    // Should not create a duplicate "Tech" category
    const categories = await db
      .prepare("SELECT id FROM categories WHERE LOWER(name) = 'tech'")
      .all<{ id: string }>();
    expect(categories.results).toHaveLength(1);
    expect(categories.results![0].id).toBe('tech-cat');
  });

  it('should handle multipart form data upload', async () => {
    const formData = new FormData();
    formData.append('file', new File([SAMPLE_OPML], 'subscriptions.opml', { type: 'text/xml' }));

    const ctx = createMockContext({
      contentType: 'multipart/form-data; boundary=---',
      formData,
    });
    const response = await handleImportOPML(ctx);
    const result: OPMLImportResult = await response.json();

    expect(result.imported).toBe(3);
  });

  it('should throw validation error for empty content', async () => {
    const ctx = createMockContext({ body: '' });
    await expect(handleImportOPML(ctx)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('should throw validation error for missing file in form data', async () => {
    const formData = new FormData();
    const ctx = createMockContext({
      contentType: 'multipart/form-data; boundary=---',
      formData,
    });
    await expect(handleImportOPML(ctx)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('should return proper summary counts', async () => {
    // Pre-insert one feed that will be a duplicate
    await db
      .prepare(
        "INSERT INTO subscriptions (id, url, title, category_id, created_at) VALUES ('pre-1', 'https://arstechnica.com/feed', 'Ars', 'default', '2024-01-01 00:00:00')"
      )
      .run();

    const ctx = createMockContext({ body: SAMPLE_OPML });
    const response = await handleImportOPML(ctx);
    const result: OPMLImportResult = await response.json();

    expect(result.imported).toBe(2);
    expect(result.skipped).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.imported + result.skipped + result.failed).toBe(3);
  });
});

describe('OPML Export Handler', () => {
  let db: D1Database;

  beforeEach(async () => {
    db = env.DB;
    await setupTestDatabase(db);
    await db.prepare('DELETE FROM subscriptions').run();
    await db.prepare("DELETE FROM categories WHERE id != 'default'").run();
  });

  it('should export empty OPML when no subscriptions exist', async () => {
    const ctx = createMockContext({});
    const response = await handleExportOPML(ctx);

    expect(response.headers.get('Content-Type')).toBe('application/xml; charset=utf-8');
    const body = await response.text();
    expect(body).toContain('<opml version="2.0">');
    expect(body).toContain('<body>');
    expect(body).toContain('</body>');
  });

  it('should export subscriptions grouped by category', async () => {
    // Create category and subscriptions
    await db
      .prepare("INSERT INTO categories (id, name, sort_order) VALUES ('news-cat', 'News', 1)")
      .run();
    await db
      .prepare(
        "INSERT INTO subscriptions (id, url, title, category_id, created_at) VALUES ('sub-1', 'https://news.com/feed', 'News Feed', 'news-cat', '2024-01-01 00:00:00')"
      )
      .run();
    await db
      .prepare(
        "INSERT INTO subscriptions (id, url, title, category_id, created_at) VALUES ('sub-2', 'https://blog.com/rss', 'Blog', 'default', '2024-01-01 00:00:00')"
      )
      .run();

    const ctx = createMockContext({});
    const response = await handleExportOPML(ctx);
    const body = await response.text();

    expect(body).toContain('xmlUrl="https://news.com/feed"');
    expect(body).toContain('xmlUrl="https://blog.com/rss"');
    expect(body).toContain('text="News"');
  });

  it('should set Content-Disposition header for file download', async () => {
    const ctx = createMockContext({});
    const response = await handleExportOPML(ctx);

    expect(response.headers.get('Content-Disposition')).toBe(
      'attachment; filename="subscriptions.opml"'
    );
  });
});
