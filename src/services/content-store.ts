/**
 * GitHub Content Store service.
 * Stores and retrieves article content via GitHub REST API.
 * Articles are stored as JSON files at path: {contentPath}/{YYYY}/{MM}/{article-id}.json
 */

import { GitHubConfig, ArticleContent } from '../types';
import { upstreamError } from '../utils/errors';
import { getConfig } from './config-store';
import { decrypt } from '../utils/crypto';

/**
 * Data structure for storing an article to GitHub.
 */
export interface ArticleStorageData {
  id: string;
  title: string;
  author: string;
  publishedAt: string;
  sourceUrl: string;
  feedUrl: string;
  htmlContent: string;
  fetchedAt: string;
}

/**
 * Load the GitHub storage config from D1, decrypting the PAT.
 * Returns null when GitHub storage is not configured.
 */
export async function loadGitHubConfig(db: D1Database, encryptionKey: string): Promise<GitHubConfig | null> {
  const [owner, name, tokenEncrypted, branch, contentPath] = await Promise.all([
    getConfig(db, 'github_repo_owner'),
    getConfig(db, 'github_repo_name'),
    getConfig(db, 'github_token_encrypted'),
    getConfig(db, 'github_branch'),
    getConfig(db, 'github_content_path'),
  ]);
  if (!owner || !name || !tokenEncrypted) return null;
  const token = await decrypt(tokenEncrypted, encryptionKey);
  return { repoOwner: owner, repoName: name, token, branch: branch || 'main', contentPath: contentPath || 'articles' };
}

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

/** Options for controlling retry behavior (useful for testing). */
export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
}

/**
 * Executes a fetch request with exponential backoff retry logic.
 * Retries up to 3 times with delays of 1s, 2s, 4s.
 */
export async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retryOptions?: RetryOptions
): Promise<Response> {
  const retries = retryOptions?.maxRetries ?? MAX_RETRIES;
  const baseDelay = retryOptions?.baseDelayMs ?? BASE_DELAY_MS;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, options);

      // Don't retry on client errors (4xx) except 429 (rate limit)
      if (response.ok || (response.status >= 400 && response.status < 500 && response.status !== 429)) {
        return response;
      }

      // Server errors (5xx) or rate limit (429) → retry
      if (attempt < retries) {
        const delay = baseDelay * Math.pow(2, attempt);
        await sleep(delay);
        continue;
      }

      return response;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < retries) {
        const delay = baseDelay * Math.pow(2, attempt);
        await sleep(delay);
        continue;
      }
    }
  }

  throw upstreamError(
    `GitHub API request failed after ${retries + 1} attempts: ${lastError?.message ?? 'Unknown error'}`,
    { url }
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Builds the GitHub API headers for authentication.
 */
function buildHeaders(token: string): Record<string, string> {
  return {
    Authorization: `token ${token}`,
    Accept: 'application/vnd.github.v3+json',
    'Content-Type': 'application/json',
    // GitHub API rejects requests without a User-Agent (Workers subrequests
    // don't set one automatically) — a missing UA gets a 403.
    'User-Agent': 'CFRSS-Reader',
  };
}

/**
 * Generates the storage path for an article based on its publishedAt date.
 * Format: {contentPath}/{YYYY}/{MM}/{article-id}.json
 */
export function generateArticlePath(contentPath: string, articleId: string, publishedAt: string): string {
  const date = new Date(publishedAt);
  const year = date.getUTCFullYear().toString();
  const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');

  const prefix = contentPath.replace(/^\/+|\/+$/g, '');
  return `${prefix}/${year}/${month}/${articleId}.json`;
}

/**
 * Checks if an article already exists at the given path in GitHub.
 */
export async function checkArticleExists(config: GitHubConfig, path: string): Promise<boolean> {
  const url = `https://api.github.com/repos/${config.repoOwner}/${config.repoName}/contents/${path}?ref=${config.branch}`;

  const response = await fetchWithRetry(url, {
    method: 'GET',
    headers: buildHeaders(config.token),
  });

  return response.status === 200;
}

/**
 * Stores an article as a JSON file in the GitHub repository.
 * Returns the content path where the article was stored.
 * If the article already exists (dedup check), returns the path without storing again.
 */
export async function storeArticle(config: GitHubConfig, article: ArticleStorageData): Promise<string> {
  const path = generateArticlePath(config.contentPath, article.id, article.publishedAt);

  // Dedup: check if file already exists
  const exists = await checkArticleExists(config, path);
  if (exists) {
    return path;
  }

  const content = JSON.stringify(article, null, 2);
  const base64Content = btoa(unescape(encodeURIComponent(content)));

  const url = `https://api.github.com/repos/${config.repoOwner}/${config.repoName}/contents/${path}`;

  const response = await fetchWithRetry(url, {
    method: 'PUT',
    headers: buildHeaders(config.token),
    body: JSON.stringify({
      message: `Add article: ${article.title}`,
      content: base64Content,
      branch: config.branch,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw upstreamError(
      `Failed to store article to GitHub: ${response.status} ${response.statusText}`,
      { path, status: response.status, body: errorBody }
    );
  }

  return path;
}

/**
 * Retrieves article content from GitHub by its storage path.
 * Returns null if the file does not exist.
 */
export async function getArticleContent(config: GitHubConfig, path: string): Promise<ArticleContent | null> {
  const url = `https://api.github.com/repos/${config.repoOwner}/${config.repoName}/contents/${path}?ref=${config.branch}`;

  const response = await fetchWithRetry(url, {
    method: 'GET',
    headers: buildHeaders(config.token),
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const errorBody = await response.text();
    throw upstreamError(
      `Failed to retrieve article from GitHub: ${response.status} ${response.statusText}`,
      { path, status: response.status, body: errorBody }
    );
  }

  const data = (await response.json()) as { content?: string; encoding?: string };

  if (!data.content) {
    return null;
  }

  // GitHub returns base64-encoded content (may include newlines)
  const decoded = decodeURIComponent(escape(atob(data.content.replace(/\n/g, ''))));
  const article = JSON.parse(decoded) as ArticleStorageData;

  return {
    id: article.id,
    title: article.title,
    author: article.author,
    publishedAt: article.publishedAt,
    htmlContent: article.htmlContent,
    sourceUrl: article.sourceUrl,
  };
}
