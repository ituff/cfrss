/**
 * URL validation utilities for RSS feed subscriptions.
 * Provides synchronous format validation and async feed probe with timeout.
 */

// === Types ===

export type ValidationResult =
  | { valid: true }
  | { valid: false; reason: 'format_error'; message: string };

export type ProbeResult =
  | { valid: true; title: string }
  | { valid: false; reason: 'timeout' | 'invalid_feed' | 'network_error'; message: string };

// === Constants ===

const MAX_URL_LENGTH = 2048;
const PROBE_TIMEOUT_MS = 10_000;

// === Synchronous URL Format Validation ===

/**
 * Validates URL format synchronously.
 * Checks: HTTP/HTTPS protocol, max length, parseable by URL constructor.
 */
export function validateUrl(url: string): ValidationResult {
  if (!url || typeof url !== 'string') {
    return { valid: false, reason: 'format_error', message: 'URL must be a non-empty string' };
  }

  if (url.length > MAX_URL_LENGTH) {
    return { valid: false, reason: 'format_error', message: `URL must not exceed ${MAX_URL_LENGTH} characters` };
  }

  // Check protocol before attempting URL parse
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return { valid: false, reason: 'format_error', message: 'URL must use http:// or https:// protocol' };
  }

  try {
    new URL(url);
  } catch {
    return { valid: false, reason: 'format_error', message: 'URL is not a valid format' };
  }

  return { valid: true };
}

// === Async Feed Probe ===

/**
 * Fetches a URL and attempts to parse it as an RSS 2.0 or Atom 1.0 feed.
 * Returns the feed title on success, or a typed error reason on failure.
 * Uses a 10-second AbortController timeout.
 */
export async function probeUrl(url: string): Promise<ProbeResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
      },
    });

    if (!response.ok) {
      return {
        valid: false,
        reason: 'network_error',
        message: `Server responded with status ${response.status}`,
      };
    }

    const text = await response.text();
    return parseFeedContent(text);
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { valid: false, reason: 'timeout', message: 'Feed fetch timed out after 10 seconds' };
    }
    const message = error instanceof Error ? error.message : 'Unknown network error';
    return { valid: false, reason: 'network_error', message };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Parses response text to determine if it's a valid RSS 2.0 or Atom 1.0 feed.
 * Extracts the feed title on success.
 */
function parseFeedContent(text: string): ProbeResult {
  const trimmed = text.trim();

  // Check for RSS 2.0 root element
  const isRss = /<rss[\s>]/i.test(trimmed);
  // Check for Atom 1.0 root element
  const isAtom = /<feed[\s>]/i.test(trimmed);

  if (!isRss && !isAtom) {
    return { valid: false, reason: 'invalid_feed', message: 'Response is not a valid RSS 2.0 or Atom 1.0 feed' };
  }

  // Extract title from <title> element
  const titleMatch = trimmed.match(/<title[^>]*>(.*?)<\/title>/i);
  const title = titleMatch?.[1]?.trim() || 'Untitled Feed';

  return { valid: true, title };
}
