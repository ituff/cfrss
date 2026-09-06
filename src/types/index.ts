// === Environment Bindings ===
export interface Env {
  DB: D1Database;
  ENCRYPTION_KEY: string;
  AUTH_TOKEN: string;
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

// === Error Handling ===
export interface APIError {
  code: string;
  message: string;
  details?: unknown;
  retryable: boolean;
}
