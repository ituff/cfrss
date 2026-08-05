import { describe, it, expect, beforeEach, vi } from 'vitest';
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

describe('GitHub Config API', () => {
  beforeEach(async () => {
    TEST_ENV.DB = env.DB;
    await setupTestDatabase(env.DB);
    // Clear github config entries to ensure test isolation
    await env.DB.prepare("DELETE FROM config WHERE key LIKE 'github_%'").run();
  });

  describe('GET /api/config/github', () => {
    it('returns null/default values when no config is set', async () => {
      const res = await app.fetch(makeRequest('GET', '/api/config/github'), TEST_ENV);
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body.repoOwner).toBeNull();
      expect(body.repoName).toBeNull();
      expect(body.token).toBeNull();
      expect(body.branch).toBe('main');
      expect(body.contentPath).toBe('articles');
    });

    it('returns stored config with masked token', async () => {
      const db = env.DB;
      const encryptedToken = await encrypt('ghp_abcdefghij1234567890', TEST_ENV.ENCRYPTION_KEY);

      await db.prepare("INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('github_repo_owner', 'myuser', datetime('now'))").run();
      await db.prepare("INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('github_repo_name', 'myrepo', datetime('now'))").run();
      await db.prepare("INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('github_token_encrypted', ?, datetime('now'))").bind(encryptedToken).run();
      await db.prepare("INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('github_branch', 'develop', datetime('now'))").run();
      await db.prepare("INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('github_content_path', 'content/rss', datetime('now'))").run();

      const res = await app.fetch(makeRequest('GET', '/api/config/github'), TEST_ENV);
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body.repoOwner).toBe('myuser');
      expect(body.repoName).toBe('myrepo');
      // Token should be masked - only last 4 chars visible
      expect(body.token).toMatch(/^\*+7890$/);
      expect(body.branch).toBe('develop');
      expect(body.contentPath).toBe('content/rss');
    });
  });

  describe('PUT /api/config/github', () => {
    it('returns 400 when repoOwner is missing', async () => {
      const res = await app.fetch(
        makeRequest('PUT', '/api/config/github', { repoName: 'repo', token: 'ghp_123' }),
        TEST_ENV
      );
      expect(res.status).toBe(400);
      const body = await res.json() as Record<string, unknown>;
      expect(body.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 when repoName is missing', async () => {
      const res = await app.fetch(
        makeRequest('PUT', '/api/config/github', { repoOwner: 'user', token: 'ghp_123' }),
        TEST_ENV
      );
      expect(res.status).toBe(400);
    });

    it('returns 400 when token is missing', async () => {
      const res = await app.fetch(
        makeRequest('PUT', '/api/config/github', { repoOwner: 'user', repoName: 'repo' }),
        TEST_ENV
      );
      expect(res.status).toBe(400);
    });

    it('returns 400 when repoOwner is empty string', async () => {
      const res = await app.fetch(
        makeRequest('PUT', '/api/config/github', { repoOwner: '  ', repoName: 'repo', token: 'ghp_123' }),
        TEST_ENV
      );
      expect(res.status).toBe(400);
    });

    it('saves config and returns masked token on success', async () => {
      const res = await app.fetch(
        makeRequest('PUT', '/api/config/github', {
          repoOwner: 'testowner',
          repoName: 'testrepo',
          token: 'ghp_testtoken12345678',
          branch: 'main',
          contentPath: 'articles',
        }),
        TEST_ENV
      );
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body.success).toBe(true);
      expect(body.repoOwner).toBe('testowner');
      expect(body.repoName).toBe('testrepo');
      expect(body.token).toMatch(/^\*+5678$/);
      expect(body.branch).toBe('main');
      expect(body.contentPath).toBe('articles');
    });

    it('uses default branch and contentPath when not provided', async () => {
      const res = await app.fetch(
        makeRequest('PUT', '/api/config/github', {
          repoOwner: 'owner',
          repoName: 'repo',
          token: 'ghp_abc123',
        }),
        TEST_ENV
      );
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body.branch).toBe('main');
      expect(body.contentPath).toBe('articles');
    });

    it('persists config values to the database', async () => {
      await app.fetch(
        makeRequest('PUT', '/api/config/github', {
          repoOwner: 'persisted-owner',
          repoName: 'persisted-repo',
          token: 'ghp_persistedtoken',
          branch: 'dev',
          contentPath: 'data/articles',
        }),
        TEST_ENV
      );

      // Verify with a GET request
      const res = await app.fetch(makeRequest('GET', '/api/config/github'), TEST_ENV);
      const body = await res.json() as Record<string, unknown>;
      expect(body.repoOwner).toBe('persisted-owner');
      expect(body.repoName).toBe('persisted-repo');
      expect(body.branch).toBe('dev');
      expect(body.contentPath).toBe('data/articles');
    });
  });

  describe('POST /api/config/github/test', () => {
    it('returns error when config is not set', async () => {
      const res = await app.fetch(makeRequest('POST', '/api/config/github/test'), TEST_ENV);
      const body = await res.json() as Record<string, unknown>;
      expect(body.success).toBe(false);
      expect(body.message).toContain('incomplete');
    });

    it('returns failure when config is incomplete (missing token)', async () => {
      const db = env.DB;
      await db.prepare("INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('github_repo_owner', 'user', datetime('now'))").run();
      await db.prepare("INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('github_repo_name', 'repo', datetime('now'))").run();

      const res = await app.fetch(makeRequest('POST', '/api/config/github/test'), TEST_ENV);
      const body = await res.json() as Record<string, unknown>;
      expect(body.success).toBe(false);
    });
  });
});
