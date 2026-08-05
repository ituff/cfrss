-- 订阅源分类
CREATE TABLE categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL CHECK(length(name) >= 1 AND length(name) <= 50),
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 默认分类（不可删除）
INSERT INTO categories (id, name, sort_order) VALUES ('default', '未分类', 0);

-- RSS 订阅源
CREATE TABLE subscriptions (
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL UNIQUE CHECK(length(url) <= 2048),
    title TEXT NOT NULL,
    category_id TEXT NOT NULL DEFAULT 'default',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_fetched_at TEXT,
    FOREIGN KEY (category_id) REFERENCES categories(id)
);

-- 文章元数据
CREATE TABLE articles (
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

CREATE INDEX idx_articles_subscription ON articles(subscription_id);
CREATE INDEX idx_articles_published ON articles(published_at DESC);
CREATE INDEX idx_articles_unread ON articles(is_read, published_at DESC);

-- LLM 配置
CREATE TABLE llm_configs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    base_url TEXT NOT NULL,
    api_key_encrypted TEXT NOT NULL,
    model_name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- LLM 功能分配
CREATE TABLE llm_assignments (
    function_name TEXT PRIMARY KEY,
    llm_config_id TEXT NOT NULL,
    FOREIGN KEY (llm_config_id) REFERENCES llm_configs(id)
);

-- 系统配置（KV 模式）
CREATE TABLE config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 每日摘要缓存
CREATE TABLE daily_digests (
    date TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    article_count INTEGER NOT NULL,
    generated_at TEXT NOT NULL
);

-- LLM 结果缓存
CREATE TABLE llm_cache (
    id TEXT PRIMARY KEY,
    article_id TEXT NOT NULL,
    function_name TEXT NOT NULL,
    result TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(article_id, function_name)
);
