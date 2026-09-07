import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { env } from 'cloudflare:test';
import { handleScheduled } from '../src/scheduled';
import { setupTestDatabase } from './setup';
import type { Env } from '../src/types';

const TEST_ENV: Env = {
  DB: null as unknown as D1Database,
  ENCRYPTION_KEY: 'test-encryption-key-32bytes-long!',
  AUTH_TOKEN: 'test-auth-token',
  CRON_MAX_FEEDS: '2',
};

const CONTROLLER = { cron: '0 * * * *' } as unknown as ScheduledController;
const CTX = {
  waitUntil() {},
  passThroughOnException() {},
} as unknown as ExecutionContext;

function makeRSSXml(title: string, link: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Test Feed</title>
    <item>
      <title>${title}</title>
      <link>${link}</link>
      <pubDate>${new Date().toUTCString()}</pubDate>
      <description>Summary of ${title}</description>
    </item>
  </channel>
</rss>`;
}

async function insertSubscription(
  id: string,
  opts: { disabled?: boolean; lastFetchedAt?: string | null } = {}
): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO subscriptions (id, url, title, category_id, last_fetched_at, fail_count, disabled) VALUES (?, ?, ?, ?, ?, 0, ?)'
  )
    .bind(
      id,
      `https://example.com/${id}.xml`,
      `Feed ${id}`,
      'default',
      opts.lastFetchedAt ?? null,
      opts.disabled ? 1 : 0
    )
    .run();
}

async function articleRowsFor(subscriptionId: string): Promise<Record<string, unknown>[]> {
  const result = await env.DB.prepare('SELECT * FROM articles WHERE subscription_id = ?')
    .bind(subscriptionId)
    .all();
  return result.results as Record<string, unknown>[];
}

// 每小时 cron：批次上限、最旧优先轮转、跳过停用订阅、新文章默认未读
describe('handleScheduled - hourly cron refresh', () => {
  beforeEach(async () => {
    TEST_ENV.DB = env.DB;
    await setupTestDatabase(env.DB);
    await env.DB.prepare('DELETE FROM articles').run();
    await env.DB.prepare('DELETE FROM subscriptions').run();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('refreshes at most CRON_MAX_FEEDS subscriptions, stalest first', async () => {
    // A 从未抓取（最优先），B 抓取时间较早，C 较晚 —— 上限 2，只刷新 A、B
    await insertSubscription('sub-a');
    await insertSubscription('sub-b', { lastFetchedAt: '2024-01-01 00:00:00' });
    await insertSubscription('sub-c', { lastFetchedAt: '2024-06-01 00:00:00' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const id = String(input).match(/sub-([a-z]+)/)?.[1] ?? 'x';
        return new Response(makeRSSXml(`Article ${id}`, `https://example.com/${id}`), { status: 200 });
      })
    );

    await handleScheduled(CONTROLLER, TEST_ENV, CTX);

    expect(await articleRowsFor('sub-a')).toHaveLength(1);
    expect(await articleRowsFor('sub-b')).toHaveLength(1);
    expect(await articleRowsFor('sub-c')).toHaveLength(0);

    // 已刷新的订阅更新 last_fetched_at，未刷新的保持不变
    const b = await env.DB.prepare('SELECT last_fetched_at FROM subscriptions WHERE id = ?').bind('sub-b').first();
    expect((b as Record<string, unknown>).last_fetched_at).not.toBe('2024-01-01 00:00:00');
    const c = await env.DB.prepare('SELECT last_fetched_at FROM subscriptions WHERE id = ?').bind('sub-c').first();
    expect((c as Record<string, unknown>).last_fetched_at).toBe('2024-06-01 00:00:00');
  });

  it('skips disabled (abnormal) subscriptions', async () => {
    await insertSubscription('sub-dead', { disabled: true });
    await insertSubscription('sub-alive');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(makeRSSXml('Article', 'https://example.com/a'), { status: 200 }))
    );

    await handleScheduled(CONTROLLER, TEST_ENV, CTX);

    expect(await articleRowsFor('sub-dead')).toHaveLength(0);
    expect(await articleRowsFor('sub-alive')).toHaveLength(1);
  });

  it('stores new cron-fetched articles as unread', async () => {
    await insertSubscription('sub-a');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(makeRSSXml('Fresh article', 'https://example.com/fresh'), { status: 200 }))
    );

    await handleScheduled(CONTROLLER, TEST_ENV, CTX);

    const rows = await articleRowsFor('sub-a');
    expect(rows).toHaveLength(1);
    expect(rows[0].is_read).toBe(0);
  });

  it('does nothing when there are no subscriptions', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await handleScheduled(CONTROLLER, TEST_ENV, CTX);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
