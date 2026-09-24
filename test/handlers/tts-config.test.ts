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

describe('TTS Config API', () => {
  beforeEach(async () => {
    TEST_ENV.DB = env.DB;
    await setupTestDatabase(env.DB);
    await env.DB.prepare("DELETE FROM config WHERE key LIKE 'tts_%'").run();
  });

  describe('GET /api/config/tts', () => {
    it('returns the default URL and no token when unconfigured', async () => {
      const res = await app.fetch(makeRequest('GET', '/api/config/tts'), TEST_ENV);
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body.url).toBe('https://tts.example.com');
      expect(body.hasToken).toBe(false);
      expect(body.token).toBeNull();
    });

    it('returns stored URL with masked token', async () => {
      const db = env.DB;
      const encryptedToken = await encrypt('my-secret-token-123456', TEST_ENV.ENCRYPTION_KEY);
      await db.prepare("INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('tts_url', 'https://tts.example.com', datetime('now'))").run();
      await db.prepare("INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('tts_token_encrypted', ?, datetime('now'))").bind(encryptedToken).run();

      const res = await app.fetch(makeRequest('GET', '/api/config/tts'), TEST_ENV);
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body.url).toBe('https://tts.example.com');
      expect(body.hasToken).toBe(true);
      expect(body.token).toMatch(/^\*+3456$/);
    });
  });

  describe('PUT /api/config/tts', () => {
    it('returns 400 when url has no protocol', async () => {
      const res = await app.fetch(
        makeRequest('PUT', '/api/config/tts', { url: 'tts.example.com' }),
        TEST_ENV
      );
      expect(res.status).toBe(400);
      const body = await res.json() as Record<string, unknown>;
      expect(body.code).toBe('VALIDATION_ERROR');
    });

    it('saves the url and applies the default when omitted', async () => {
      const res = await app.fetch(
        makeRequest('PUT', '/api/config/tts', {}),
        TEST_ENV
      );
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body.success).toBe(true);
      expect(body.url).toBe('https://tts.example.com');

      const stored = await env.DB.prepare("SELECT value FROM config WHERE key = 'tts_url'").first<{ value: string }>();
      expect(stored?.value).toBe('https://tts.example.com');
    });

    it('encrypts and stores the token, and keeps it on url-only saves', async () => {
      const first = await app.fetch(
        makeRequest('PUT', '/api/config/tts', { url: 'https://tts.example.com', token: 'tok-abc123456' }),
        TEST_ENV
      );
      expect(first.status).toBe(200);

      const storedToken = await env.DB.prepare("SELECT value FROM config WHERE key = 'tts_token_encrypted'").first<{ value: string }>();
      expect(storedToken?.value).toBeTruthy();
      expect(storedToken?.value).not.toContain('tok-abc123456');

      // Second save without a token must not clear the stored one
      const second = await app.fetch(
        makeRequest('PUT', '/api/config/tts', { url: 'https://tts2.example.com' }),
        TEST_ENV
      );
      expect(second.status).toBe(200);

      const res = await app.fetch(makeRequest('GET', '/api/config/tts'), TEST_ENV);
      const body = await res.json() as Record<string, unknown>;
      expect(body.url).toBe('https://tts2.example.com');
      expect(body.hasToken).toBe(true);
    });

    it('stores a valid voice and returns it from GET', async () => {
      const res = await app.fetch(
        makeRequest('PUT', '/api/config/tts', { url: 'https://tts.example.com', voice: 'zh-CN-YunxiNeural' }),
        TEST_ENV
      );
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body.voice).toBe('zh-CN-YunxiNeural');

      const stored = await env.DB.prepare("SELECT value FROM config WHERE key = 'tts_voice'").first<{ value: string }>();
      expect(stored?.value).toBe('zh-CN-YunxiNeural');

      const get = await app.fetch(makeRequest('GET', '/api/config/tts'), TEST_ENV);
      const getBody = await get.json() as Record<string, unknown>;
      expect(getBody.voice).toBe('zh-CN-YunxiNeural');
    });

    it('defaults the voice to auto when unset', async () => {
      const res = await app.fetch(makeRequest('GET', '/api/config/tts'), TEST_ENV);
      const body = await res.json() as Record<string, unknown>;
      expect(body.voice).toBe('auto');
    });

    it('normalizes an empty voice to auto', async () => {
      const res = await app.fetch(
        makeRequest('PUT', '/api/config/tts', { voice: '   ' }),
        TEST_ENV
      );
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body.voice).toBe('auto');
    });

    it('rejects a voice containing unsupported characters', async () => {
      const res = await app.fetch(
        makeRequest('PUT', '/api/config/tts', { voice: 'zh-CN-Aria Neura"l&x=1' }),
        TEST_ENV
      );
      expect(res.status).toBe(400);
      const body = await res.json() as Record<string, unknown>;
      expect(body.code).toBe('VALIDATION_ERROR');
    });

    it('rejects a voice that is too long', async () => {
      const res = await app.fetch(
        makeRequest('PUT', '/api/config/tts', { voice: 'a'.repeat(101) }),
        TEST_ENV
      );
      expect(res.status).toBe(400);
    });

    it('rejects a non-string voice', async () => {
      const res = await app.fetch(
        makeRequest('PUT', '/api/config/tts', { voice: 42 }),
        TEST_ENV
      );
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/tts/synthesis', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('returns 400 when text is missing', async () => {
      const res = await app.fetch(makeRequest('POST', '/api/tts/synthesis', {}), TEST_ENV);
      expect(res.status).toBe(400);
      const body = await res.json() as Record<string, unknown>;
      expect(body.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 when text exceeds the maximum length', async () => {
      const res = await app.fetch(
        makeRequest('POST', '/api/tts/synthesis', { text: 'a'.repeat(5001) }),
        TEST_ENV
      );
      expect(res.status).toBe(400);
    });

    it('proxies the paragraph to the read-aloud worker with the stored token', async () => {
      const encryptedToken = await encrypt('tok-secret-987654', TEST_ENV.ENCRYPTION_KEY);
      await env.DB.prepare("INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('tts_url', 'https://tts.example.com', datetime('now'))").run();
      await env.DB.prepare("INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('tts_token_encrypted', ?, datetime('now'))").bind(encryptedToken).run();

      const audio = new Uint8Array([1, 2, 3, 4]);
      const mockFetch = vi.fn().mockResolvedValue(new Response(audio, {
        status: 200,
        headers: { 'Content-Type': 'audio/mpeg' },
      }));
      vi.stubGlobal('fetch', mockFetch);

      const res = await app.fetch(
        makeRequest('POST', '/api/tts/synthesis', { text: '你好世界', voiceName: 'zh-CN-XiaoxiaoNeural' }),
        TEST_ENV
      );
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('audio/mpeg');

      const [url] = mockFetch.mock.calls[0] as [string];
      const parsed = new URL(url);
      expect(parsed.origin + parsed.pathname).toBe('https://tts.example.com/api/synthesis');
      expect(parsed.searchParams.get('text')).toBe('你好世界');
      expect(parsed.searchParams.get('voiceName')).toBe('zh-CN-XiaoxiaoNeural');
      expect(parsed.searchParams.get('token')).toBe('tok-secret-987654');
    });

    it('maps upstream failures to UPSTREAM_ERROR', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection refused')));

      const res = await app.fetch(
        makeRequest('POST', '/api/tts/synthesis', { text: 'hello' }),
        TEST_ENV
      );
      expect(res.status).toBe(502);
      const body = await res.json() as Record<string, unknown>;
      expect(body.code).toBe('UPSTREAM_ERROR');
    });

    it('uses the configured voice when the request omits one', async () => {
      await env.DB.prepare("INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('tts_voice', 'zh-CN-YunxiNeural', datetime('now'))").run();

      const mockFetch = vi.fn().mockResolvedValue(new Response(new Uint8Array([1]), {
        status: 200,
        headers: { 'Content-Type': 'audio/mpeg' },
      }));
      vi.stubGlobal('fetch', mockFetch);

      const res = await app.fetch(
        makeRequest('POST', '/api/tts/synthesis', { text: '你好' }),
        TEST_ENV
      );
      expect(res.status).toBe(200);

      const [url] = mockFetch.mock.calls[0] as [string];
      expect(new URL(url).searchParams.get('voiceName')).toBe('zh-CN-YunxiNeural');
    });

    it('lets an explicit request voice override the configured one', async () => {
      await env.DB.prepare("INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('tts_voice', 'zh-CN-YunxiNeural', datetime('now'))").run();

      const mockFetch = vi.fn().mockResolvedValue(new Response(new Uint8Array([1]), {
        status: 200,
        headers: { 'Content-Type': 'audio/mpeg' },
      }));
      vi.stubGlobal('fetch', mockFetch);

      await app.fetch(
        makeRequest('POST', '/api/tts/synthesis', { text: 'hello', voiceName: 'en-US-GuyNeural' }),
        TEST_ENV
      );

      const [url] = mockFetch.mock.calls[0] as [string];
      expect(new URL(url).searchParams.get('voiceName')).toBe('en-US-GuyNeural');
    });

    it('treats a request voice of "auto" as no explicit choice', async () => {
      await env.DB.prepare("INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('tts_voice', 'ja-JP-NanamiNeural', datetime('now'))").run();

      const mockFetch = vi.fn().mockResolvedValue(new Response(new Uint8Array([1]), {
        status: 200,
        headers: { 'Content-Type': 'audio/mpeg' },
      }));
      vi.stubGlobal('fetch', mockFetch);

      await app.fetch(
        makeRequest('POST', '/api/tts/synthesis', { text: 'テスト', voiceName: 'auto' }),
        TEST_ENV
      );

      const [url] = mockFetch.mock.calls[0] as [string];
      expect(new URL(url).searchParams.get('voiceName')).toBe('ja-JP-NanamiNeural');
    });

    it('falls back to a default voice when nothing is configured', async () => {
      const mockFetch = vi.fn().mockResolvedValue(new Response(new Uint8Array([1]), {
        status: 200,
        headers: { 'Content-Type': 'audio/mpeg' },
      }));
      vi.stubGlobal('fetch', mockFetch);

      await app.fetch(
        makeRequest('POST', '/api/tts/synthesis', { text: 'hello' }),
        TEST_ENV
      );

      const [url] = mockFetch.mock.calls[0] as [string];
      expect(new URL(url).searchParams.get('voiceName')).toBe('en-US-AriaNeural');
    });
  });
});
