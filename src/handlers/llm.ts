/**
 * LLM Feature Handlers - Article summarization, translation, and daily digest.
 *
 * Each handler follows the same pattern:
 * 1. Check cache for existing result
 * 2. If cached, return JSON with cached: true
 * 3. If not cached, stream LLM response via SSE and cache after completion
 */

import type { Context } from 'hono';
import type { Env } from '../types';
import { streamLLMResponse } from '../services/llm-proxy';
import { getLLMAssignments } from '../services/llm-service';
import { decrypt } from '../utils/crypto';
import { getLanguage } from '../services/config-store';
import { getDailyDigest, selectDigestArticles, generateDigest } from '../services/daily-digest';
import { validationError, notFoundError } from '../utils/errors';

import { getConfig } from '../services/config-store';
import { getArticleContent } from '../services/content-store';

/**
 * Convert stored article HTML to plain text for LLM input:
 * drop tags, decode common entities, collapse whitespace.
 */
function htmlToPlainText(html: string): string {
  if (!html) return '';
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<\/(p|div|h[1-6]|li|tr|blockquote|section)>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Load the full article content from GitHub storage, falling back to the
 * D1 summary when storage is unavailable. Returns plain text.
 */
async function loadArticleText(
  db: Env['DB'],
  encKey: string,
  articleId: string,
  fallbackSummary: string
): Promise<string> {
  const contentPath = await db
    .prepare('SELECT content_path FROM articles WHERE id = ?')
    .bind(articleId)
    .first<{ content_path: string }>();

  let html = '';
  if (contentPath?.content_path) {
    try {
      const [owner, name, tokenEncrypted, branch, contentPathBase] = await Promise.all([
        getConfig(db, 'github_repo_owner'),
        getConfig(db, 'github_repo_name'),
        getConfig(db, 'github_token_encrypted'),
        getConfig(db, 'github_branch'),
        getConfig(db, 'github_content_path'),
      ]);
      if (owner && name && tokenEncrypted) {
        const { decrypt } = await import('../utils/crypto');
        const token = await decrypt(tokenEncrypted, encKey);
        const content = await getArticleContent(
          { repoOwner: owner, repoName: name, token, branch: branch || 'main', contentPath: contentPathBase || 'articles' },
          contentPath.content_path
        );
        html = content?.htmlContent ?? '';
      }
    } catch {
      // Storage unavailable — fall back to the D1 summary below
    }
  }

  const text = htmlToPlainText(html);
  return text || htmlToPlainText(fallbackSummary) || fallbackSummary;
}

// --- Summarization Handler ---

/**
 * POST /api/llm/summarize
 *
 * Summarizes an article using the assigned LLM configuration.
 *
 * Request body:
 *   { articleId: string }
 *
 * If cached: returns JSON { cached: true, content: "..." }
 * If not cached: returns SSE stream, caches result after completion.
 * If no LLM config assigned: returns 400 with guidance message.
 */
export async function handleSummarizeArticle(c: Context<{ Bindings: Env }>) {
  const db = c.env.DB;
  const encKey = c.env.ENCRYPTION_KEY;

  const body = await c.req.json<{ articleId?: string }>();

  if (!body.articleId || typeof body.articleId !== 'string') {
    throw validationError('articleId is required and must be a string');
  }

  const articleId = body.articleId;
  const functionName = 'summarize';

  // Check llm_cache for existing result
  const cached = await db
    .prepare('SELECT result FROM llm_cache WHERE article_id = ? AND function_name = ?')
    .bind(articleId, functionName)
    .first<{ result: string }>();

  if (cached) {
    return c.json({ cached: true, content: cached.result });
  }

  // Get LLM assignment for 'summarize'
  const assignments = await getLLMAssignments(db);
  if (!assignments.summarize) {
    throw validationError(
      'No LLM configuration assigned for summarization. Please go to Settings → LLM Configuration to assign a model for the summarize function.'
    );
  }

  // Get the LLM config
  const llmConfig = await db
    .prepare('SELECT id, name, base_url, api_key_encrypted, model_name FROM llm_configs WHERE id = ?')
    .bind(assignments.summarize)
    .first<{ id: string; name: string; base_url: string; api_key_encrypted: string; model_name: string }>();

  if (!llmConfig) {
    throw notFoundError(
      'Assigned LLM configuration not found. It may have been deleted. Please reassign a config for summarization.'
    );
  }

  // Fetch the article from D1
  const article = await db
    .prepare('SELECT id, title, summary FROM articles WHERE id = ?')
    .bind(articleId)
    .first<{ id: string; title: string; summary: string }>();

  if (!article) {
    throw notFoundError(`Article not found: ${articleId}`);
  }

  // Decrypt the API key
  const apiKey = await decrypt(llmConfig.api_key_encrypted, encKey);

  // Build content for summarization — prefer full text from GitHub storage
  const fullText = await loadArticleText(db, encKey, articleId, article.summary ?? '');
  const articleContent = `Title: ${article.title}

${fullText}`;

  // Follow the language configured in Settings
  const uiLang = await getLanguage(db);
  const langName = uiLang === 'zh' ? 'Chinese' : 'English';
  const prompt = `Summarize the following article in no more than 300 words. Write the summary in ${langName}:\n\n${articleContent}`;

  // Stream LLM response
  const stream = await streamLLMResponse({
    baseUrl: llmConfig.base_url,
    apiKey,
    modelName: llmConfig.model_name,
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 500,
  });

  // Create a TransformStream that collects output for caching while passing through
  let fullContent = '';
  const decoder = new TextDecoder();

  const cachingStream = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      controller.enqueue(chunk);

      const text = decoder.decode(chunk, { stream: true });
      const lines = text.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('data: ') && trimmed !== 'data: [DONE]') {
          try {
            const parsed = JSON.parse(trimmed.slice(6));
            if (parsed.content) {
              fullContent += parsed.content;
            }
          } catch {
            // Skip malformed lines
          }
        }
      }
    },
    async flush() {
      if (fullContent.length > 0) {
        try {
          const cacheId = crypto.randomUUID();
          await db
            .prepare(
              "INSERT OR IGNORE INTO llm_cache (id, article_id, function_name, result, created_at) VALUES (?, ?, ?, ?, datetime('now'))"
            )
            .bind(cacheId, articleId, functionName, fullContent)
            .run();
        } catch {
          // Cache write failure is non-critical
        }
      }
    },
  });

  const responseStream = stream.pipeThrough(cachingStream);

  return new Response(responseStream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}

// --- Translation Handler ---

/**
 * POST /api/llm/translate
 *
 * Translates an article to the specified target language (or the user's configured language).
 *
 * Request body:
 *   { articleId: string, targetLanguage?: 'zh' | 'en' }
 *
 * If cached: returns JSON { cached: true, content: "..." }
 * If not cached: returns SSE stream, caches result after completion.
 * If no LLM config assigned: returns 400 with guidance message.
 */
export async function handleTranslateArticle(c: Context<{ Bindings: Env }>) {
  const db = c.env.DB;
  const encKey = c.env.ENCRYPTION_KEY;

  // Parse request body
  const body = await c.req.json<{ articleId?: string; targetLanguage?: string }>();

  if (!body.articleId) {
    throw validationError('articleId is required');
  }

  const articleId = body.articleId;

  // Determine target language
  // The language configured in Settings is authoritative (client UI language may differ)
  let targetLanguage: 'zh' | 'en' = (await getLanguage(db)) ?? 'en';

  const functionName = `translate_${targetLanguage}`;

  // Check cache
  const cached = await db
    .prepare('SELECT result FROM llm_cache WHERE article_id = ? AND function_name = ?')
    .bind(articleId, functionName)
    .first<{ result: string }>();

  if (cached) {
    return c.json({ cached: true, content: cached.result });
  }

  // Get LLM assignment for translate
  const assignments = await getLLMAssignments(db);
  if (!assignments.translate) {
    throw validationError(
      'No LLM configuration assigned for translation. Please go to Settings → LLM Configuration to assign a model for the translate function.'
    );
  }

  // Get the LLM config
  const llmConfig = await db
    .prepare('SELECT id, name, base_url, api_key_encrypted, model_name FROM llm_configs WHERE id = ?')
    .bind(assignments.translate)
    .first<{ id: string; name: string; base_url: string; api_key_encrypted: string; model_name: string }>();

  if (!llmConfig) {
    throw notFoundError('Assigned LLM configuration not found. It may have been deleted.');
  }

  // Get article content
  const article = await db
    .prepare('SELECT id, title, summary FROM articles WHERE id = ?')
    .bind(articleId)
    .first<{ id: string; title: string; summary: string }>();

  if (!article) {
    throw notFoundError(`Article not found: ${articleId}`);
  }

  // Decrypt API key
  const apiKey = await decrypt(llmConfig.api_key_encrypted, encKey);

  // Build prompt
  const targetLangName = targetLanguage === 'zh' ? 'Chinese' : 'English';
  const fullText = await loadArticleText(db, encKey, articleId, article.summary || article.title);
  const prompt = `Translate the following article into ${targetLangName}. Output only the ${targetLangName} translation.\n\n${fullText}`;

  // Stream LLM response
  const stream = await streamLLMResponse({
    baseUrl: llmConfig.base_url,
    apiKey,
    modelName: llmConfig.model_name,
    messages: [{ role: 'user', content: prompt }],
  });

  // Create a transform stream that collects output for caching
  let fullContent = '';
  const decoder = new TextDecoder();

  const cachingStream = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      controller.enqueue(chunk);

      // Extract content from SSE data lines for caching
      const text = decoder.decode(chunk, { stream: true });
      const lines = text.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('data: ') && trimmed !== 'data: [DONE]') {
          try {
            const parsed = JSON.parse(trimmed.slice(6));
            if (parsed.content) {
              fullContent += parsed.content;
            }
          } catch {
            // Skip malformed lines
          }
        }
      }
    },
    async flush() {
      // Cache the result after stream completes
      if (fullContent.length > 0) {
        try {
          const cacheId = crypto.randomUUID();
          await db
            .prepare(
              "INSERT OR REPLACE INTO llm_cache (id, article_id, function_name, result, created_at) VALUES (?, ?, ?, ?, datetime('now'))"
            )
            .bind(cacheId, articleId, functionName, fullContent)
            .run();
        } catch {
          // Cache write failure is non-critical
        }
      }
    },
  });

  const responseStream = stream.pipeThrough(cachingStream);

  return new Response(responseStream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}


// --- Daily Digest Handlers ---

/**
 * GET /api/llm/digest
 *
 * Retrieves the daily digest for a given date (query param ?date=YYYY-MM-DD).
 * Defaults to today's date if no date is provided.
 *
 * Returns:
 *   - { digest: DailyDigest } if found
 *   - { digest: null } if no digest exists for the date
 */
export async function handleGetDailyDigest(c: Context<{ Bindings: Env }>) {
  const db = c.env.DB;

  const dateParam = c.req.query('date');
  const date = dateParam || new Date().toISOString().split('T')[0];

  // Validate date format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw validationError('date must be in YYYY-MM-DD format');
  }

  const digest = await getDailyDigest(db, date);
  return c.json({ digest });
}

/**
 * POST /api/llm/digest/generate
 *
 * Generates a daily digest for today's date.
 * Selects unread articles from the last 24 hours (max 20) and calls LLM.
 * If a cached digest already exists for today, returns the cached version.
 *
 * Returns: { digest: DailyDigest }
 */
export async function handleGenerateDailyDigest(c: Context<{ Bindings: Env }>) {
  const db = c.env.DB;
  const encKey = c.env.ENCRYPTION_KEY;

  const today = new Date().toISOString().split('T')[0];
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // Select articles for the digest
  const articles = await selectDigestArticles(db, since);

  // Generate (or return cached) digest
  const digest = await generateDigest(db, encKey, articles, today);
  return c.json({ digest });
}
