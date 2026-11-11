// === Environment Bindings ===
export interface Env {
  DB: D1Database;
  ENCRYPTION_KEY: string;
  AUTH_TOKEN: string;
  /** Cron 批次上限：每次定时任务最多刷新的订阅数（字符串数字，可选，默认 10） */
  CRON_MAX_FEEDS?: string;
  /**
   * Cloudflare's built-in version-metadata binding (`[version_metadata]` in
   * wrangler.toml). Filled in by the platform on every deploy, so it reports
   * the version actually serving traffic. Absent under `wrangler dev` and in
   * tests.
   */
  CF_VERSION_METADATA?: {
    /** UUID of the deployed Worker version. */
    id: string;
    /** Optional tag set at deploy time. */
    tag?: string;
    /** ISO 8601 upload time of that version. */
    timestamp: string;
  };
}

// === Subscription Management ===
export interface Subscription {
  id: string;
  url: string;           // Feed URL, max 2048 chars
  title: string;
  categoryId: string;
  createdAt: string;     // ISO 8601
  lastFetchedAt: string | null;
  failCount?: number;    // Consecutive refresh failures
  disabled?: boolean;    // Marked abnormal after too many failures; skipped on refresh
  unreadCount?: number;  // Unread articles (populated by list endpoint)
}

export interface Category {
  id: string;
  name: string;          // 1-50 chars
  order: number;
}

// === Articles ===
export interface Article {
  id: string;
  subscriptionId: string;
  title: string;
  author: string;
  publishedAt: string;   // ISO 8601
  summary: string;
  contentUrl: string;    // GitHub storage path
  sourceUrl: string;     // Link to the original article
  isRead: boolean;
  fetchedAt: string;
}

export interface ArticleContent {
  id: string;
  title: string;
  author: string;
  publishedAt: string;
  htmlContent: string;
  sourceUrl: string;
}

// === Bookmarks ===

/** A bookmarked article, flattened with the article metadata for list views. */
export interface Bookmark {
  articleId: string;
  createdAt: string;     // ISO 8601-ish: 'YYYY-MM-DD HH:MM:SS'
  subscriptionId: string;
  title: string;
  author: string;
  publishedAt: string;   // ISO 8601
  summary: string;
  sourceUrl: string;
  isRead: boolean;
}

// === LLM Configuration ===
export interface LLMConfig {
  id: string;
  name: string;
  baseUrl: string;       // HTTPS API endpoint
  apiKey: string;        // encrypted in storage
  modelName: string;
}

export interface LLMAssignment {
  summarize: string | null;  // LLM config ID
  translate: string | null;  // LLM config ID
}

// === GitHub Configuration ===
export interface GitHubConfig {
  repoOwner: string;
  repoName: string;
  token: string;         // encrypted in storage
  branch: string;        // default: main
  contentPath: string;
}

// === OPML ===
export interface OPMLImportResult {
  imported: number;
  skipped: number;
  failed: number;
  details: Array<{
    url: string;
    status: 'imported' | 'skipped' | 'failed';
    reason?: string;
  }>;
}

// === Daily Digest ===
export interface DailyDigest {
  date: string;          // YYYY-MM-DD
  content: string;       // LLM-generated markdown
  generatedAt: string;   // ISO 8601
  articleCount: number;
}

// === UI preferences ===

/** Supported UI themes. */
export type Theme = 'light' | 'dark' | 'oled' | 'eink';

/** Supported interface languages. */
export type Language = 'zh' | 'en';

// === Error Handling ===
export interface APIError {
  code: string;
  message: string;
  details?: unknown;
  retryable: boolean;
}
