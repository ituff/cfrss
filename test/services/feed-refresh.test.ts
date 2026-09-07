import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { env } from 'cloudflare:test';
import app from '../../src/index';
import { setupTestDatabase } from '../setup';
import type { Env } from '../../src/types';

const TEST_ENV: Env = {
  DB: null as unknown as D1Database,
  ENCRYPTION_KEY: 'test-encryption-key-32bytes-long!',
  AUTH_TOKEN: 'test-auth-token',
};

function makeRequest(method: string, path: string, body?: unknown) {
  const init: RequestInit = {
    method,
    headers: {
      Authorization: 'Bearer test-auth-token',
      'Content-Type': 'application/json',
    },
  };
  if (body) {
    init.body = JSON.stringify(body);
  }
  return new Request(`http://localhost${path}`, init);
}

function makeRSSXml(items: Array<{ title: string; link: string }>): string {
  const itemsXml = items
    .map(
      (item) => `
    <item>
      <title>${item.title}</title>
      <link>${item.link}</link>
      <pubDate>${new Date().toUTCString()}</pubDate>
      <description>Summary of ${item.title}</description>
    </item>`
    )
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Test Feed</title>${itemsXml}
  </channel>
</rss>`;
}

async function insertSubscription(id: string): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO subscriptions (id, url, title, category_id, last_fetched_at, fail_count, disabled) VALUES (?, ?, ?, 'default', NULL, 0, 0)"
  )
    .bind(id, `https://example.com/${id}.xml`, `Feed ${id}`)
    .run();
}

// 保护重构：手动刷新端点与 cron 共用 refreshSubscriptionsAndStore 服务，
// 该端到端用例固化「抓取 → 去重 → 未读入库 → last_fetched_at 更新」契约。
describe('POST /api/articles/refresh (shared pipeline contract)', () => {
  beforeEach(async () => {
    TEST_ENV.DB = env.DB;
    await setupTestDatabase(env.DB);
    await env.DB.prepare('DELETE FROM articles').run();
    await env.DB.prepare('DELETE FROM subscriptions').run();
    await env.DB.prepare("DELETE FROM config WHERE key LIKE 'github_%'").run();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('inserts new articles as unread and returns the refresh summary', async () => {
    await insertSubscription('sub-a');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          makeRSSXml([
            { title: 'Article 1', link: 'https://example.com/1' },
            { title: 'Article 2', link: 'https://example.com/2' },
          ]),
          { status: 200 }
        )
      )
    );

    const res = await app.fetch(makeRequest('POST', '/api/articles/refresh'), TEST_ENV);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.refreshed).toBe(1);
    expect(body.newArticles).toBe(2);
    expect(body.failures).toEqual([]);

    const articles = await env.DB.prepare('SELECT * FROM articles ORDER BY title').all();
    expect(articles.results).toHaveLength(2);
    for (const row of articles.results as Record<string, unknown>[]) {
      expect(row.is_read).toBe(0); // 新文章默认未读
      expect(String(row.content_path)).toMatch(/^articles\//); // GitHub 未配置时的回退路径
    }

    const sub = await env.DB.prepare('SELECT last_fetched_at FROM subscriptions WHERE id = ?').bind('sub-a').first();
    expect((sub as Record<string, unknown>).last_fetched_at).not.toBeNull();
  });

  it('does not insert duplicates on a second refresh (source_url dedup)', async () => {
    await insertSubscription('sub-a');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(makeRSSXml([{ title: 'Article 1', link: 'https://example.com/1' }]), { status: 200 })
      )
    );

    const first = await app.fetch(makeRequest('POST', '/api/articles/refresh'), TEST_ENV);
    expect(((await first.json()) as Record<string, unknown>).newArticles).toBe(1);

    const second = await app.fetch(makeRequest('POST', '/api/articles/refresh'), TEST_ENV);
    const body = (await second.json()) as Record<string, unknown>;
    expect(body.newArticles).toBe(0);
    expect(body.refreshed).toBe(1);
  });

  it('reports failures but keeps non-failing subscriptions unaffected', async () => {
    await insertSubscription('sub-good');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('sub-good')) {
          return new Response(makeRSSXml([{ title: 'Good', link: 'https://example.com/good' }]), { status: 200 });
        }
        return new Response('server error', { status: 500 });
      })
    );
    await env.DB.prepare(
      "INSERT INTO subscriptions (id, url, title, category_id, last_fetched_at, fail_count, disabled) VALUES ('sub-bad', 'https://example.com/bad.xml', 'Feed sub-bad', 'default', NULL, 0, 0)"
    ).run();

    const res = await app.fetch(makeRequest('POST', '/api/articles/refresh'), TEST_ENV);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.refreshed).toBe(1);
    expect(body.newArticles).toBe(1);
    expect((body.failures as unknown[]).length).toBe(1);

    // 失败一次只累加计数，不立即停用
    const bad = await env.DB.prepare('SELECT fail_count, disabled FROM subscriptions WHERE id = ?')
      .bind('sub-bad')
      .first();
    expect((bad as Record<string, unknown>).fail_count).toBe(1);
    expect((bad as Record<string, unknown>).disabled).toBe(0);
  });
});
