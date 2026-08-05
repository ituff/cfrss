/**
 * RSS/Atom feed parser for Cloudflare Workers.
 * Implements a lightweight string-based XML parser (no DOMParser available in Workers).
 * Supports RSS 2.0 and Atom 1.0 formats.
 * Includes parallel feed refresh with timeout and fault tolerance.
 *
 * Validates: Requirements 14.1, 14.2, 14.3, 14.4
 */

import { Subscription } from '../types';

// === Types ===

export interface ParsedArticle {
  title: string;
  author: string;
  publishedAt: string;    // ISO 8601
  summary: string;
  htmlContent: string;    // Full content HTML
  sourceUrl: string;      // Link to original article
}

export interface FeedRefreshSuccess {
  subscriptionId: string;
  articles: ParsedArticle[];
}

export interface FeedRefreshFailure {
  subscriptionId: string;
  subscriptionTitle: string;
  error: string;
}

export interface RefreshResult {
  successes: FeedRefreshSuccess[];
  failures: FeedRefreshFailure[];
}

export interface ParsedFeedResult {
  feedTitle: string;
  articles: ParsedArticle[];
}

// === Main Parser ===

/**
 * Parse an RSS 2.0 or Atom 1.0 XML feed into structured article data.
 * Auto-detects the feed format based on root element.
 */
export function parseFeed(xml: string): ParsedFeedResult {
  if (!xml || xml.trim().length === 0) {
    return { feedTitle: '', articles: [] };
  }

  // Detect feed format
  if (isRSS(xml)) {
    return parseRSS(xml);
  } else if (isAtom(xml)) {
    return parseAtom(xml);
  }

  // Unknown format — return empty
  return { feedTitle: '', articles: [] };
}

// === Format Detection ===

function isRSS(xml: string): boolean {
  return /<rss[\s>]/i.test(xml);
}

function isAtom(xml: string): boolean {
  return /<feed[\s>]/i.test(xml) && !/<rss[\s>]/i.test(xml);
}

// === RSS 2.0 Parser ===

function parseRSS(xml: string): ParsedFeedResult {
  // Extract channel content
  const channelContent = extractTagContent(xml, 'channel');
  if (!channelContent) {
    return { feedTitle: '', articles: [] };
  }

  // Extract feed title from channel
  const feedTitle = extractTextContent(channelContent, 'title');

  // Extract items
  const items = extractAllTags(channelContent, 'item');
  const articles: ParsedArticle[] = items.map(parseRSSItem);

  return { feedTitle, articles };
}

function parseRSSItem(itemXml: string): ParsedArticle {
  const title = extractTextContent(itemXml, 'title');
  const link = extractTextContent(itemXml, 'link');

  // Author: prefer dc:creator, fallback to author
  const author = extractNamespacedTextContent(itemXml, 'dc:creator')
    || extractTextContent(itemXml, 'author');

  // Date: pubDate in RFC 2822 format → convert to ISO 8601
  const pubDate = extractTextContent(itemXml, 'pubDate');
  const publishedAt = pubDate ? rfc2822ToISO8601(pubDate) : '';

  // Summary: description
  const summary = extractTextContent(itemXml, 'description');

  // Full content: content:encoded
  const htmlContent = extractNamespacedTextContent(itemXml, 'content:encoded')
    || summary;

  return {
    title,
    author,
    publishedAt,
    summary,
    htmlContent,
    sourceUrl: link,
  };
}

// === Atom 1.0 Parser ===

function parseAtom(xml: string): ParsedFeedResult {
  // Extract feed-level content (everything before the first <entry>)
  const feedTitle = extractTextContent(xml, 'title');

  // Extract entries
  const entries = extractAllTags(xml, 'entry');
  const articles: ParsedArticle[] = entries.map(parseAtomEntry);

  return { feedTitle, articles };
}

function parseAtomEntry(entryXml: string): ParsedArticle {
  const title = extractTextContent(entryXml, 'title');

  // Link: <link href="..."/> or <link href="..." rel="alternate"/>
  const sourceUrl = extractAtomLink(entryXml);

  // Author: <author><name>...</name></author>
  const authorBlock = extractTagContent(entryXml, 'author');
  const author = authorBlock ? extractTextContent(authorBlock, 'name') : '';

  // Date: prefer <published>, fallback to <updated> (already ISO 8601)
  const published = extractTextContent(entryXml, 'published');
  const updated = extractTextContent(entryXml, 'updated');
  const publishedAt = published || updated || '';

  // Summary
  const summary = extractTextContent(entryXml, 'summary');

  // Content
  const htmlContent = extractTextContent(entryXml, 'content') || summary;

  return {
    title,
    author,
    publishedAt,
    summary,
    htmlContent,
    sourceUrl,
  };
}

/**
 * Extract the href from the first <link> element in Atom.
 * Handles both self-closing <link href="..." /> and <link href="...">text</link>.
 */
function extractAtomLink(xml: string): string {
  // Match <link ... href="..." ... /> or <link ... href="..." ...>
  const linkRegex = /<link\b([^>]*?)(?:\/>|>[^<]*<\/link>)/gi;
  let match: RegExpExecArray | null;
  let alternateHref = '';
  let firstHref = '';

  while ((match = linkRegex.exec(xml)) !== null) {
    const attrs = match[1];
    const href = extractAttribute(attrs, 'href');
    if (!href) continue;

    if (!firstHref) {
      firstHref = href;
    }

    const rel = extractAttribute(attrs, 'rel');
    if (rel === 'alternate' || !rel) {
      alternateHref = href;
      break;
    }
  }

  return alternateHref || firstHref;
}

// === XML Utility Functions ===

/**
 * Extract the text content of the first occurrence of a tag.
 * Handles CDATA sections and nested content.
 */
function extractTextContent(xml: string, tagName: string): string {
  // Handle self-closing tags (no content)
  const selfClosingRegex = new RegExp(`<${escapeRegex(tagName)}\\b[^>]*/>`, 'i');
  const selfClosingMatch = selfClosingRegex.exec(xml);

  // Try to find opening and closing tags
  const content = extractTagContent(xml, tagName);
  if (content === null) {
    return '';
  }

  // Strip CDATA wrapper if present
  const stripped = stripCDATA(content);
  // Decode XML entities
  return decodeXMLEntities(stripped.trim());
}

/**
 * Extract content between opening and closing tags (raw inner content).
 * Returns null if tag not found.
 */
function extractTagContent(xml: string, tagName: string): string | null {
  const escapedTag = escapeRegex(tagName);
  const openRegex = new RegExp(`<${escapedTag}(?:\\b[^>]*)?>`, 'i');
  const closeRegex = new RegExp(`</${escapedTag}>`, 'i');

  const openMatch = openRegex.exec(xml);
  if (!openMatch) return null;

  const startIdx = openMatch.index + openMatch[0].length;

  // Find the matching close tag (handling nesting for non-namespaced tags)
  const closeMatch = closeRegex.exec(xml.substring(startIdx));
  if (!closeMatch) return null;

  return xml.substring(startIdx, startIdx + closeMatch.index);
}

/**
 * Extract text content for namespaced tags (e.g., dc:creator, content:encoded).
 * These need special handling because the colon is part of the tag name.
 */
function extractNamespacedTextContent(xml: string, tagName: string): string {
  const escapedTag = escapeRegex(tagName);
  const regex = new RegExp(
    `<${escapedTag}(?:\\b[^>]*)?>([\\s\\S]*?)</${escapedTag}>`,
    'i'
  );

  const match = regex.exec(xml);
  if (!match) return '';

  const content = stripCDATA(match[1]);
  return decodeXMLEntities(content.trim());
}

/**
 * Extract all occurrences of a specific tag and return their full inner content.
 */
function extractAllTags(xml: string, tagName: string): string[] {
  const results: string[] = [];
  const escapedTag = escapeRegex(tagName);
  const openTag = `<${tagName}`;
  const closeTag = `</${tagName}>`;

  let searchFrom = 0;

  while (searchFrom < xml.length) {
    const openIdx = xml.toLowerCase().indexOf(openTag.toLowerCase(), searchFrom);
    if (openIdx === -1) break;

    // Find the end of the opening tag
    const openTagEnd = xml.indexOf('>', openIdx);
    if (openTagEnd === -1) break;

    // Find the matching close tag
    const closeIdx = xml.toLowerCase().indexOf(closeTag.toLowerCase(), openTagEnd);
    if (closeIdx === -1) break;

    const innerContent = xml.substring(openTagEnd + 1, closeIdx);
    results.push(innerContent);

    searchFrom = closeIdx + closeTag.length;
  }

  return results;
}

/**
 * Extract the value of a specific attribute from an attribute string.
 */
function extractAttribute(attrString: string, attrName: string): string {
  const regex = new RegExp(`${escapeRegex(attrName)}\\s*=\\s*["']([^"']*?)["']`, 'i');
  const match = regex.exec(attrString);
  if (!match) return '';
  return decodeXMLEntities(match[1]);
}

/**
 * Strip CDATA wrapper from content.
 */
function stripCDATA(content: string): string {
  const cdataRegex = /^<!\[CDATA\[([\s\S]*?)\]\]>$/;
  const match = cdataRegex.exec(content.trim());
  if (match) {
    return match[1];
  }
  return content;
}

/**
 * Decode common XML entities.
 */
function decodeXMLEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/**
 * Escape special regex characters in a string.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// === Date Conversion ===

/**
 * Convert RFC 2822 date string to ISO 8601 format.
 * Example: "Mon, 15 Jan 2024 08:30:00 GMT" → "2024-01-15T08:30:00.000Z"
 */
export function rfc2822ToISO8601(dateStr: string): string {
  if (!dateStr || dateStr.trim().length === 0) {
    return '';
  }

  const trimmed = dateStr.trim();

  // Try parsing with Date constructor (handles most RFC 2822 formats)
  const date = new Date(trimmed);
  if (!isNaN(date.getTime())) {
    return date.toISOString();
  }

  // If Date constructor fails, return the original string
  return trimmed;
}

// === Parallel Feed Refresh ===

/** Default timeout per feed in milliseconds (15 seconds). */
const FEED_FETCH_TIMEOUT_MS = 15_000;

/**
 * Fetch a single feed with a timeout via AbortController.
 * Returns the parsed articles or throws on failure.
 */
export async function fetchSingleFeed(url: string, timeoutMs: number = FEED_FETCH_TIMEOUT_MS): Promise<ParsedArticle[]> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const xml = await response.text();
    const result = parseFeed(xml);
    return result.articles;
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Timeout after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Refresh all feeds concurrently using Promise.allSettled.
 * Each feed is fetched with a 15-second timeout.
 * If a feed fails, it is added to the failures array without blocking others.
 *
 * Validates: Requirements 14.3, 14.4
 */
export async function refreshAllFeeds(
  subscriptions: Subscription[],
  timeoutMs: number = FEED_FETCH_TIMEOUT_MS
): Promise<RefreshResult> {
  const results = await Promise.allSettled(
    subscriptions.map(async (sub) => {
      const articles = await fetchSingleFeed(sub.url, timeoutMs);
      return { subscriptionId: sub.id, articles };
    })
  );

  const successes: FeedRefreshSuccess[] = [];
  const failures: FeedRefreshFailure[] = [];

  results.forEach((result, index) => {
    const sub = subscriptions[index];
    if (result.status === 'fulfilled') {
      successes.push(result.value);
    } else {
      const errorMessage = result.reason instanceof Error
        ? result.reason.message
        : String(result.reason);
      failures.push({
        subscriptionId: sub.id,
        subscriptionTitle: sub.title,
        error: errorMessage,
      });
    }
  });

  return { successes, failures };
}
