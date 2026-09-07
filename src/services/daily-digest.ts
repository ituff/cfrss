/**
 * Daily Digest Service - Generates daily content summaries using LLM.
 *
 * Handles:
 * - Selecting unread articles from the last 24 hours (max 20)
 * - Checking the daily_digests cache before calling LLM
 * - Generating digest via LLM with timeout (30s) and retry (max 3)
 * - Storing generated digests in the daily_digests table
 */

import { decrypt } from '../utils/crypto';
import type { Article, DailyDigest } from '../types';

const DIGEST_TIMEOUT_MS = 30000;
const MAX_RETRIES = 3;
const MAX_DIGEST_ARTICLES = 20;

// --- Cache Operations ---

/**
 * Retrieves a cached daily digest for the given date.
 * Returns null if no cached digest exists.
 *
 * @param db - D1 database instance
 * @param date - Date string in YYYY-MM-DD format
 */
export async function getDailyDigest(db: D1Database, date: string): Promise<DailyDigest | null> {
  const row = await db
    .prepare('SELECT date, content, article_count, generated_at FROM daily_digests WHERE date = ?')
    .bind(date)
    .first<{ date: string; content: string; article_count: number; generated_at: string }>();

  if (!row) {
    return null;
  }

  return {
    date: row.date,
    content: row.content,
    articleCount: row.article_count,
    generatedAt: row.generated_at,
  };
}

// --- Article Selection ---

/**
 * Selects unread articles published within the last 24 hours for digest generation.
 * Returns at most 20 articles, ordered by published_at DESC.
 *
 * @param db - D1 database instance
 * @param since - ISO 8601 timestamp representing the cutoff (24 hours ago)
 */
export async function selectDigestArticles(db: D1Database, since: string): Promise<Article[]> {
  const rows = await db
    .prepare(
      `SELECT id, subscription_id, title, author, published_at, summary, content_path, source_url, is_read, fetched_at
       FROM articles
       WHERE is_read = 0 AND published_at >= ?
       ORDER BY published_at DESC
       LIMIT ?`
    )
    .bind(since, MAX_DIGEST_ARTICLES)
    .all<{
      id: string;
      subscription_id: string;
      title: string;
      author: string;
      published_at: string;
      summary: string;
      content_path: string;
      source_url: string;
      is_read: number;
      fetched_at: string;
    }>();

  return rows.results.map((row) => ({
    id: row.id,
    subscriptionId: row.subscription_id,
    title: row.title,
    author: row.author,
    publishedAt: row.published_at,
    summary: row.summary,
    contentUrl: row.content_path,
    isRead: row.is_read === 1,
    fetchedAt: row.fetched_at,
  }));
}

// --- Digest Generation ---

/**
 * Builds the LLM prompt for digest generation from the selected articles.
 */
function buildDigestPrompt(articles: Article[]): string {
  const articleList = articles
    .map((a, i) => `${i + 1}. [${a.title}]${a.author ? ` by ${a.author}` : ''}\n   Summary: ${a.summary || 'No summary available'}`)
    .join('\n\n');

  return [
    'You are a news digest editor. Based on the following ' + articles.length + ' articles, write a concise daily digest in Markdown.',
    '',
    'Requirements:',
    '1. Start with a 2-3 sentence overview of the main themes of the day (no heading for it).',
    '2. Group the articles into 2-5 themes, each theme as a second-level heading (## Theme).',
    '3. One bullet per article, in this exact format: **Article Title** (Source) - one-sentence core takeaway, max 40 words.',
    '4. Use only these Markdown constructs: second-level headings, bold, unordered lists. Do NOT use tables, horizontal rules, nested lists, or level-1 headings.',
    '5. Write in the dominant language of the articles (Chinese articles -> Chinese digest; English articles -> English digest).',
    '6. Keep the whole digest under 600 words. Output only the digest, no extra commentary.',
    '',
    'Articles:',
    articleList,
  ].join('\n');
}

/**
 * Calls the LLM API (non-streaming) with timeout and retry logic.
 * Uses the 'summarize' LLM assignment.
 *
 * @param db - D1 database instance
 * @param encKey - Encryption key for decrypting the API key
 * @param articles - Articles to include in the digest
 * @returns The generated digest content string
 * @throws Error if LLM call fails after all retries or config is missing
 */
async function callLLMForDigest(db: D1Database, encKey: string, articles: Article[]): Promise<string> {
  // Get the 'summarize' LLM assignment
  const assignment = await db
    .prepare("SELECT llm_config_id FROM llm_assignments WHERE function_name = 'summarize'")
    .first<{ llm_config_id: string }>();

  if (!assignment) {
    throw new Error('No LLM configuration assigned for summarize function');
  }

  // Get the LLM config
  const config = await db
    .prepare('SELECT id, name, base_url, api_key_encrypted, model_name FROM llm_configs WHERE id = ?')
    .bind(assignment.llm_config_id)
    .first<{ id: string; name: string; base_url: string; api_key_encrypted: string; model_name: string }>();

  if (!config) {
    throw new Error('Assigned LLM configuration not found');
  }

  const apiKey = await decrypt(config.api_key_encrypted, encKey);
  const url = config.base_url.replace(/\/$/, '') + '/chat/completions';
  const prompt = buildDigestPrompt(articles);

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DIGEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: config.model_name,
          messages: [{ role: 'user', content: prompt }],
          stream: false,
          enable_thinking: false,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const statusText = response.statusText || `HTTP ${response.status}`;
        throw new Error(`LLM API error: ${statusText}`);
      }

      const data = await response.json() as {
        choices?: Array<{ message?: { content?: string } }>;
      };

      const content = data?.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error('LLM API returned empty response');
      }

      return content;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name === 'AbortError') {
        lastError = new Error('LLM request timed out (30s)');
      } else {
        lastError = error instanceof Error ? error : new Error('Unknown error');
      }

      if (attempt < MAX_RETRIES) {
        continue;
      }
    }
  }

  throw lastError ?? new Error('LLM digest generation failed after retries');
}

/**
 * Generates a daily digest. Checks cache first, then generates via LLM if needed.
 *
 * @param db - D1 database instance
 * @param encKey - Encryption key for decrypting LLM API keys
 * @param articles - Pre-selected articles for the digest
 * @param date - Date string in YYYY-MM-DD format
 * @returns The generated or cached DailyDigest
 */
export async function generateDigest(
  db: D1Database,
  encKey: string,
  articles: Article[],
  date: string
): Promise<DailyDigest> {
  // Check cache first
  const cached = await getDailyDigest(db, date);
  if (cached) {
    return cached;
  }

  const generatedAt = new Date().toISOString();

  // If no articles, return empty digest without calling LLM
  if (articles.length === 0) {
    const emptyDigest: DailyDigest = {
      date,
      content: 'No new unread articles in the last 24 hours.',
      articleCount: 0,
      generatedAt,
    };

    await db
      .prepare('INSERT INTO daily_digests (date, content, article_count, generated_at) VALUES (?, ?, ?, ?)')
      .bind(emptyDigest.date, emptyDigest.content, emptyDigest.articleCount, emptyDigest.generatedAt)
      .run();

    return emptyDigest;
  }

  // Generate via LLM
  const content = await callLLMForDigest(db, encKey, articles);

  const digest: DailyDigest = {
    date,
    content,
    articleCount: articles.length,
    generatedAt,
  };

  // Store in cache
  await db
    .prepare('INSERT INTO daily_digests (date, content, article_count, generated_at) VALUES (?, ?, ?, ?)')
    .bind(digest.date, digest.content, digest.articleCount, digest.generatedAt)
    .run();

  return digest;
}
