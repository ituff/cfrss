/**
 * Frontend API client service for the RSS Reader.
 * Provides typed fetch wrappers for all backend endpoints with error handling and retry logic.
 *
 * Requirements: 15.1
 */

import type {
  Subscription,
  Category,
  Article,
  ArticleContent,
  LLMConfig,
  LLMAssignment,
  GitHubConfig,
  OPMLImportResult,
  DailyDigest,
  APIError,
} from '../../types/index.js';

// === Types for API responses ===

export interface ArticleListResponse {
  articles: Article[];
  truncated: boolean;
  limit: number;
  offset: number;
}

export interface ArticleListOptions {
  unread?: boolean;
  subscriptionId?: string;
  limit?: number;
  offset?: number;
}

export interface RefreshResult {
  refreshed: number;
  newArticles: number;
  failures: Array<{ subscriptionId: string; url: string; error: string }>;
}

export interface LLMConfigInput {
  name: string;
  baseUrl: string;
  apiKey: string;
  modelName: string;
}

export interface LLMConfigUpdateInput {
  name?: string;
  baseUrl?: string;
  apiKey?: string;
  modelName?: string;
}

export interface LLMTestResult {
  success: boolean;
  message: string;
}

export interface GitHubConfigInput {
  repoOwner: string;
  repoName: string;
  token: string;
  branch?: string;
  contentPath?: string;
}

export interface GitHubConfigResponse {
  repoOwner: string | null;
  repoName: string | null;
  token: string | null;
  branch: string;
  contentPath: string;
}

export interface GitHubTestResult {
  success: boolean;
  message: string;
}

export interface SummarizeRequest {
  articleId: string;
}

export interface TranslateRequest {
  articleId: string;
  targetLanguage?: 'zh' | 'en';
}

export interface LLMCachedResponse {
  cached: true;
  content: string;
}

// === Error class for API failures ===

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryable: boolean;
  readonly details?: unknown;

  constructor(status: number, error: APIError) {
    super(error.message);
    this.name = 'ApiError';
    this.code = error.code;
    this.status = status;
    this.retryable = error.retryable;
    this.details = error.details;
  }
}

// === Configuration ===

let authToken: string | null = null;

/**
 * Set the auth token used for API requests.
 * Must be called before making API calls.
 */
export function setAuthToken(token: string): void {
  authToken = token;
}

/**
 * Get the current auth token.
 */
export function getAuthToken(): string | null {
  return authToken;
}

// === Base request helper ===

/**
 * Makes a typed API request with auth header, JSON parsing, error handling, and retry logic.
 * Retries once on 5xx errors or network failures.
 */
async function apiRequest<T>(
  method: string,
  path: string,
  body?: unknown,
  options?: { retries?: number; rawResponse?: boolean }
): Promise<T> {
  const maxRetries = options?.retries ?? 1;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const headers: Record<string, string> = {};

      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }

      if (body !== undefined && !(body instanceof FormData)) {
        headers['Content-Type'] = 'application/json';
      }

      const fetchOptions: RequestInit = {
        method,
        headers,
      };

      if (body !== undefined) {
        fetchOptions.body = body instanceof FormData ? body : JSON.stringify(body);
      }

      const response = await fetch(path, fetchOptions);

      // On 5xx, retry if attempts remain
      if (response.status >= 500 && attempt < maxRetries) {
        lastError = new Error(`Server error: ${response.status}`);
        continue;
      }

      // Handle non-OK responses
      if (!response.ok) {
        let errorBody: APIError;
        try {
          errorBody = await response.json() as APIError;
        } catch {
          errorBody = {
            code: 'UNKNOWN_ERROR',
            message: `HTTP ${response.status}: ${response.statusText}`,
            retryable: response.status >= 500,
          };
        }
        throw new ApiError(response.status, errorBody);
      }

      // Return raw response if requested (for blob/stream responses)
      if (options?.rawResponse) {
        return response as unknown as T;
      }

      // Parse JSON response
      const data = await response.json() as T;
      return data;
    } catch (err) {
      // Network failure — retry if attempts remain
      if (err instanceof ApiError) {
        throw err; // Don't retry client errors (4xx)
      }

      if (attempt < maxRetries && !(err instanceof ApiError)) {
        lastError = err instanceof Error ? err : new Error(String(err));
        continue;
      }

      // All retries exhausted
      if (err instanceof Error && err.name !== 'ApiError') {
        throw new ApiError(0, {
          code: 'NETWORK_ERROR',
          message: err.message || 'Network request failed',
          retryable: true,
        });
      }

      throw err;
    }
  }

  // Should not reach here, but just in case
  throw lastError || new Error('Request failed');
}

// === Subscription API ===

/**
 * Get all subscriptions.
 */
export async function getSubscriptions(): Promise<Subscription[]> {
  const data = await apiRequest<{ subscriptions: Subscription[] }>('GET', '/api/subscriptions');
  return data.subscriptions;
}

/**
 * Add a new subscription.
 */
export async function addSubscription(url: string, categoryId?: string): Promise<Subscription> {
  const data = await apiRequest<{ subscription: Subscription }>('POST', '/api/subscriptions', {
    url,
    categoryId: categoryId || 'default',
  });
  return data.subscription;
}

/**
 * Delete a subscription by ID.
 */
export async function deleteSubscription(id: string): Promise<void> {
  await apiRequest<{ success: boolean }>('DELETE', `/api/subscriptions/${id}`);
}

/**
 * Move a subscription to a different category.
 */
export async function moveSubscription(id: string, categoryId: string): Promise<Subscription> {
  const data = await apiRequest<{ subscription: Subscription }>(
    'PUT',
    `/api/subscriptions/${id}/category`,
    { categoryId }
  );
  return data.subscription;
}

// === Category API ===

/**
 * Get all categories.
 */
export async function getCategories(): Promise<Category[]> {
  const data = await apiRequest<{ categories: Category[] }>('GET', '/api/categories');
  return data.categories;
}

/**
 * Create a new category.
 */
export async function createCategory(name: string): Promise<Category> {
  const data = await apiRequest<{ category: Category }>('POST', '/api/categories', { name });
  return data.category;
}

/**
 * Rename a category.
 */
export async function renameCategory(id: string, name: string): Promise<Category> {
  const data = await apiRequest<{ category: Category }>('PUT', `/api/categories/${id}`, { name });
  return data.category;
}

/**
 * Delete a category. Subscriptions in this category are moved to 'default'.
 */
export async function deleteCategory(id: string): Promise<void> {
  await apiRequest<{ success: boolean }>('DELETE', `/api/categories/${id}`);
}

// === Article API ===

/**
 * Get a paginated list of articles with optional filters.
 */
export async function getArticles(opts?: ArticleListOptions): Promise<ArticleListResponse> {
  const params = new URLSearchParams();
  if (opts?.unread) params.set('unread', 'true');
  if (opts?.subscriptionId) params.set('subscriptionId', opts.subscriptionId);
  if (opts?.limit !== undefined) params.set('limit', String(opts.limit));
  if (opts?.offset !== undefined) params.set('offset', String(opts.offset));

  const query = params.toString();
  const path = query ? `/api/articles?${query}` : '/api/articles';

  return apiRequest<ArticleListResponse>('GET', path);
}

/**
 * Get a single article by ID.
 */
export async function getArticle(id: string): Promise<Article> {
  const data = await apiRequest<{ article: Article }>('GET', `/api/articles/${id}`);
  return data.article;
}

/**
 * Trigger a refresh of all subscription feeds.
 */
export async function refreshFeeds(): Promise<RefreshResult> {
  return apiRequest<RefreshResult>('POST', '/api/articles/refresh');
}

// === OPML API ===

/**
 * Import subscriptions from an OPML file.
 */
export async function importOPML(file: File): Promise<OPMLImportResult> {
  const formData = new FormData();
  formData.append('file', file);
  return apiRequest<OPMLImportResult>('POST', '/api/opml/import', formData);
}

/**
 * Export all subscriptions as an OPML file.
 */
export async function exportOPML(): Promise<Blob> {
  const response = await apiRequest<Response>('GET', '/api/opml/export', undefined, {
    rawResponse: true,
  });
  return response.blob();
}

// === Config API — Theme ===

/**
 * Get the current theme setting.
 */
export async function getTheme(): Promise<string> {
  const data = await apiRequest<{ theme: string }>('GET', '/api/config/theme');
  return data.theme;
}

/**
 * Set the theme.
 */
export async function setTheme(theme: 'light' | 'dark'): Promise<void> {
  await apiRequest<{ success: boolean }>('PUT', '/api/config/theme', { theme });
}

// === Config API — Language ===

/**
 * Get the current language setting.
 */
export async function getLanguage(): Promise<string> {
  const data = await apiRequest<{ language: string }>('GET', '/api/config/language');
  return data.language;
}

/**
 * Set the language.
 */
export async function setLanguage(language: 'zh' | 'en'): Promise<void> {
  await apiRequest<{ success: boolean }>('PUT', '/api/config/language', { language });
}

// === Config API — LLM ===

/**
 * Get all LLM configurations.
 */
export async function getLLMConfigs(): Promise<LLMConfig[]> {
  const data = await apiRequest<{ configs: LLMConfig[] }>('GET', '/api/config/llm');
  return data.configs;
}

/**
 * Create a new LLM configuration.
 */
export async function createLLMConfig(input: LLMConfigInput): Promise<LLMConfig> {
  const data = await apiRequest<{ config: LLMConfig }>('POST', '/api/config/llm', input);
  return data.config;
}

/**
 * Update an existing LLM configuration.
 */
export async function updateLLMConfig(id: string, input: LLMConfigUpdateInput): Promise<LLMConfig> {
  const data = await apiRequest<{ config: LLMConfig }>('PUT', `/api/config/llm/${id}`, input);
  return data.config;
}

/**
 * Delete an LLM configuration.
 */
export async function deleteLLMConfig(id: string): Promise<void> {
  await apiRequest<{ success: boolean }>('DELETE', `/api/config/llm/${id}`);
}

/**
 * Test an LLM configuration's connectivity.
 */
export async function testLLMConfig(id: string): Promise<LLMTestResult> {
  return apiRequest<LLMTestResult>('POST', `/api/config/llm/${id}/test`);
}

/**
 * Get LLM function assignments.
 */
export async function getLLMAssignments(): Promise<LLMAssignment> {
  const data = await apiRequest<{ assignments: LLMAssignment }>('GET', '/api/config/llm/assignments');
  return data.assignments;
}

/**
 * Set LLM function assignments.
 */
export async function setLLMAssignments(assignments: LLMAssignment): Promise<void> {
  await apiRequest<{ success: boolean; assignments: LLMAssignment }>(
    'PUT',
    '/api/config/llm/assignments',
    assignments
  );
}

// === Config API — GitHub ===

/**
 * Get the GitHub configuration (token is masked).
 */
export async function getGitHubConfig(): Promise<GitHubConfigResponse> {
  return apiRequest<GitHubConfigResponse>('GET', '/api/config/github');
}

/**
 * Set the GitHub configuration.
 */
export async function setGitHubConfig(config: GitHubConfigInput): Promise<void> {
  await apiRequest<{ success: boolean }>('PUT', '/api/config/github', config);
}

/**
 * Test the GitHub configuration connectivity.
 */
export async function testGitHubConfig(): Promise<GitHubTestResult> {
  return apiRequest<GitHubTestResult>('POST', '/api/config/github/test');
}

// === LLM API — Summarize / Translate / Digest ===

/**
 * Summarize an article. Returns cached content if available, otherwise returns null
 * (the caller should use `summarizeArticleStream` for streaming responses).
 */
export async function summarizeArticle(articleId: string): Promise<LLMCachedResponse | null> {
  const response = await apiRequest<Response>('POST', '/api/llm/summarize', { articleId }, {
    rawResponse: true,
  });

  const contentType = response.headers.get('content-type') || '';

  // If JSON response, it's a cached result
  if (contentType.includes('application/json')) {
    return response.json() as Promise<LLMCachedResponse>;
  }

  // If SSE stream, return null — caller should use streaming variant
  return null;
}

/**
 * Summarize an article with streaming. Returns a ReadableStream of SSE data.
 */
export async function summarizeArticleStream(articleId: string): Promise<ReadableStream<Uint8Array> | null> {
  const response = await apiRequest<Response>('POST', '/api/llm/summarize', { articleId }, {
    rawResponse: true,
  });

  const contentType = response.headers.get('content-type') || '';

  if (contentType.includes('text/event-stream')) {
    return response.body;
  }

  // If it was a cached response, return null
  return null;
}

/**
 * Translate an article. Returns cached content if available, otherwise returns null
 * (the caller should use `translateArticleStream` for streaming responses).
 */
export async function translateArticle(
  articleId: string,
  targetLanguage?: 'zh' | 'en'
): Promise<LLMCachedResponse | null> {
  const response = await apiRequest<Response>(
    'POST',
    '/api/llm/translate',
    { articleId, targetLanguage },
    { rawResponse: true }
  );

  const contentType = response.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    return response.json() as Promise<LLMCachedResponse>;
  }

  return null;
}

/**
 * Translate an article with streaming. Returns a ReadableStream of SSE data.
 */
export async function translateArticleStream(
  articleId: string,
  targetLanguage?: 'zh' | 'en'
): Promise<ReadableStream<Uint8Array> | null> {
  const response = await apiRequest<Response>(
    'POST',
    '/api/llm/translate',
    { articleId, targetLanguage },
    { rawResponse: true }
  );

  const contentType = response.headers.get('content-type') || '';

  if (contentType.includes('text/event-stream')) {
    return response.body;
  }

  return null;
}

/**
 * Get the daily digest for a given date (defaults to today).
 */
export async function getDailyDigest(date?: string): Promise<DailyDigest | null> {
  const params = date ? `?date=${date}` : '';
  const data = await apiRequest<{ digest: DailyDigest | null }>('GET', `/api/llm/digest${params}`);
  return data.digest;
}

/**
 * Generate the daily digest for today.
 */
export async function generateDailyDigest(): Promise<DailyDigest> {
  const data = await apiRequest<{ digest: DailyDigest }>('POST', '/api/llm/digest/generate');
  return data.digest;
}
