import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { env } from 'cloudflare:test';
import app from '../../src/index';
import { setupTestDatabase } from '../setup';
import { encrypt } from '../../src/utils/crypto';
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

/** OpenAI-style SSE payload served by the stubbed upstream. */
function sseResponse(chunks: string[]): Response {
  const body =
    chunks.map((c) => `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`).join('') +
    'data: [DONE]\n\n';
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

async function seedArticleAndConfig(db: D1Database): Promise<string> {
  await db
    .prepare(
      "INSERT OR IGNORE INTO subscriptions (id, url, title) VALUES ('sub-1', 'https://example.com/feed.xml', 'Example')"
    )
    .run();
  await db
    .prepare(
      "INSERT OR REPLACE INTO articles (id, subscription_id, title, summary, content_path, source_url, published_at) VALUES ('art-1', 'sub-1', 'Test Article', '<p>Hello world</p>', '', 'https://example.com/a', datetime('now'))"
    )
    .run();

  const encrypted = await encrypt('sk-test-key', TEST_ENV.ENCRYPTION_KEY);
  await db
    .prepare(
      "INSERT OR REPLACE INTO llm_configs (id, name, base_url, api_key_encrypted, model_name) VALUES ('cfg-1', 'mock', 'https://llm.example.com/v1', ?, 'mock-model')"
    )
    .bind(encrypted)
    .run();
  await db
    .prepare(
      "INSERT OR REPLACE INTO llm_assignments (function_name, llm_config_id) VALUES ('translate', 'cfg-1')"
    )
    .run();
  return 'art-1';
}

describe('POST /api/llm/translate (target languages)', () => {
  beforeEach(async () => {
    TEST_ENV.DB = env.DB;
    await setupTestDatabase(env.DB);
    await env.DB.prepare('DELETE FROM llm_cache').run();
    await env.DB.prepare('DELETE FROM llm_assignments').run();
    await env.DB.prepare('DELETE FROM llm_configs').run();
    await env.DB.prepare("DELETE FROM articles WHERE id = 'art-1'").run();
    await env.DB.prepare("DELETE FROM subscriptions WHERE id = 'sub-1'").run();
    await env.DB.prepare("DELETE FROM config WHERE key = 'language'").run();
    await seedArticleAndConfig(env.DB);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects an unsupported targetLanguage with 400', async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    const res = await app.fetch(
      makeRequest('POST', '/api/llm/translate', { articleId: 'art-1', targetLanguage: 'xx' }),
      TEST_ENV
    );
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('streams a translation for targetLanguage=ja and prompts in Japanese', async () => {
    const mockFetch = vi.fn().mockResolvedValue(sseResponse(['<p>こんにちは</p>', '<p>chunik</p>']));
    vi.stubGlobal('fetch', mockFetch);

    const res = await app.fetch(
      makeRequest('POST', '/api/llm/translate', { articleId: 'art-1', targetLanguage: 'ja' }),
      TEST_ENV
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/event-stream');

    const text = await res.text();
    expect(text).toContain('こんにちは');
    expect(text).toContain('data: [DONE]');

    // The upstream prompt must name the target language and carry the article
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0] as [string, { body: string }];
    expect(url).toBe('https://llm.example.com/v1/chat/completions');
    const upstreamBody = JSON.parse(options.body);
    expect(upstreamBody.stream).toBe(true);
    expect(upstreamBody.messages[0].content).toContain('Japanese');
    expect(upstreamBody.messages[0].content).toContain('Hello world');

    // Result cached under the language-specific key
    const cached = await env.DB.prepare(
      "SELECT result FROM llm_cache WHERE article_id = 'art-1' AND function_name = 'translate_ja'"
    ).first<{ result: string }>();
    expect(cached?.result).toContain('こんにちは');
  });

  it('serves a repeat request from cache without calling the upstream', async () => {
    const mockFetch = vi.fn().mockResolvedValue(sseResponse(['<p>bonjour</p>']));
    vi.stubGlobal('fetch', mockFetch);

    const first = await app.fetch(
      makeRequest('POST', '/api/llm/translate', { articleId: 'art-1', targetLanguage: 'fr' }),
      TEST_ENV
    );
    await first.text();
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const second = await app.fetch(
      makeRequest('POST', '/api/llm/translate', { articleId: 'art-1', targetLanguage: 'fr' }),
      TEST_ENV
    );
    expect(second.status).toBe(200);
    const body = await second.json() as { cached?: boolean; content?: string };
    expect(body.cached).toBe(true);
    expect(body.content).toContain('bonjour');
    expect(mockFetch).toHaveBeenCalledTimes(1); // no additional upstream call
  });

  it('uses distinct cache keys per target language', async () => {
    const mockFetch = vi.fn()
      .mockImplementation(async (_url, options) => {
        const body = JSON.parse((options as { body: string }).body);
        const lang = body.messages[0].content.includes('German') ? 'de' : 'it';
        return sseResponse([`<p>lang-${lang}</p>`]);
      });
    vi.stubGlobal('fetch', mockFetch);

    await (await app.fetch(
      makeRequest('POST', '/api/llm/translate', { articleId: 'art-1', targetLanguage: 'de' }),
      TEST_ENV
    )).text();
    await (await app.fetch(
      makeRequest('POST', '/api/llm/translate', { articleId: 'art-1', targetLanguage: 'it' }),
      TEST_ENV
    )).text();

    expect(mockFetch).toHaveBeenCalledTimes(2);
    const de = await env.DB.prepare(
      "SELECT result FROM llm_cache WHERE function_name = 'translate_de'"
    ).first<{ result: string }>();
    const it_ = await env.DB.prepare(
      "SELECT result FROM llm_cache WHERE function_name = 'translate_it'"
    ).first<{ result: string }>();
    expect(de?.result).toContain('lang-de');
    expect(it_?.result).toContain('lang-it');
  });

  it('falls back to the configured UI language when targetLanguage is omitted', async () => {
    await env.DB.prepare(
      "INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('language', 'zh', datetime('now'))"
    ).run();
    const mockFetch = vi.fn().mockResolvedValue(sseResponse(['<p>你好</p>']));
    vi.stubGlobal('fetch', mockFetch);

    const res = await app.fetch(
      makeRequest('POST', '/api/llm/translate', { articleId: 'art-1' }),
      TEST_ENV
    );
    await res.text();

    const [url, options] = mockFetch.mock.calls[0] as [string, { body: string }];
    expect(url).toBe('https://llm.example.com/v1/chat/completions');
    const upstreamBody = JSON.parse(options.body);
    expect(upstreamBody.messages[0].content).toContain('Simplified Chinese');
    const cached = await env.DB.prepare(
      "SELECT function_name FROM llm_cache WHERE article_id = 'art-1'"
    ).first<{ function_name: string }>();
    expect(cached?.function_name).toBe('translate_zh');
  });
});
