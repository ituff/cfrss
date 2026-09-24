-- 文章收藏：每篇文章最多一条收藏记录（单用户应用，无需 user_id）
CREATE TABLE bookmarks (
    article_id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
);

-- 收藏列表按收藏时间倒序展示
CREATE INDEX idx_bookmarks_created ON bookmarks(created_at DESC);
