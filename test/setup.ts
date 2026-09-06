import { Parameters } from 'fast-check';

/**
 * Shared fast-check configuration for property-based tests.
 * Runs 100 iterations per property with verbose output for debugging.
 */
export const FC_OPTIONS: Parameters<unknown[]> = {
  numRuns: 100,
  verbose: true,
  seed: Date.now(),
};

/**
 * Helper to create and initialize a test D1 database with the app schema.
 * Use this in integration tests that need a fully migrated database.
 */
export async function setupTestDatabase(db: D1Database): Promise<void> {
  const schema = `
    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL CHECK(length(name) >= 1 AND length(name) <= 50),
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    INSERT OR IGNORE INTO categories (id, name, sort_order) VALUES ('default', '未分类', 0);

    CREATE TABLE IF NOT EXISTS subscriptions (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL UNIQUE CHECK(length(url) <= 2048),
      title TEXT NOT NULL,
      category_id TEXT NOT NULL DEFAULT 'default',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_fetched_at TEXT,
      fail_count INTEGER NOT NULL DEFAULT 0,
      disabled INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (category_id) REFERENCES categories(id)
    );

    CREATE TABLE IF NOT EXISTS articles (
      id TEXT PRIMARY KEY,
      subscription_id TEXT NOT NULL,
      title TEXT NOT NULL,
      author TEXT DEFAULT '',
      published_at TEXT NOT NULL,
      summary TEXT DEFAULT '',
      content_path TEXT NOT NULL,
      source_url TEXT NOT NULL,
      is_read INTEGER NOT NULL DEFAULT 0,
      fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_articles_subscription ON articles(subscription_id);
    CREATE INDEX IF NOT EXISTS idx_articles_published ON articles(published_at DESC);
    CREATE INDEX IF NOT EXISTS idx_articles_unread ON articles(is_read, published_at DESC);

    CREATE TABLE IF NOT EXISTS llm_configs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      base_url TEXT NOT NULL,
      api_key_encrypted TEXT NOT NULL,
      model_name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS llm_assignments (
      function_name TEXT PRIMARY KEY,
      llm_config_id TEXT NOT NULL,
      FOREIGN KEY (llm_config_id) REFERENCES llm_configs(id)
    );

    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS daily_digests (
      date TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      article_count INTEGER NOT NULL,
      generated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS llm_cache (
      id TEXT PRIMARY KEY,
      article_id TEXT NOT NULL,
      function_name TEXT NOT NULL,
      result TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(article_id, function_name)
    );
  `;

  // Execute each statement separately since D1 batch doesn't support multi-statement strings
  const statements = schema
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const statement of statements) {
    await db.prepare(statement).run();
  }
}
