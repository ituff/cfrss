/**
 * OPML parser and exporter for RSS subscription import/export.
 * Implements a lightweight string-based XML parser suitable for Cloudflare Workers
 * (no DOM/DOMParser available).
 *
 * Validates: Requirements 6.1, 6.2, 6.4, 6.5
 */

import { validationError } from '../utils/errors';

// === Types ===

export interface ParsedFeed {
  url: string;       // xmlUrl attribute
  title: string;     // text or title attribute
  category: string;  // parent outline's text/title, or empty for top-level
}

export interface ParsedOPML {
  feeds: ParsedFeed[];
}

export interface SubscriptionWithCategory {
  url: string;
  title: string;
  categoryName: string;
}

// === Constants ===

/** Maximum OPML file size: 5MB */
const MAX_FILE_SIZE = 5 * 1024 * 1024;

// === Parser ===

/**
 * Parse an OPML XML string into structured feed data.
 * Supports nested outlines (category > feed) and flat outlines (feed at top level).
 *
 * @throws AppError with VALIDATION_ERROR code for invalid input
 */
export function parseOPML(content: string): ParsedOPML {
  // Validate input is non-empty
  if (!content || content.trim().length === 0) {
    throw validationError('OPML content is empty');
  }

  // Validate file size (5MB limit)
  const byteLength = new TextEncoder().encode(content).byteLength;
  if (byteLength > MAX_FILE_SIZE) {
    throw validationError(`OPML file exceeds maximum size of 5MB (got ${(byteLength / 1024 / 1024).toFixed(2)}MB)`);
  }

  // Validate basic OPML structure
  if (!content.includes('<opml') && !content.includes('<OPML')) {
    throw validationError('Invalid OPML format: missing <opml> root element');
  }

  if (!content.includes('<body') && !content.includes('<Body') && !content.includes('<BODY')) {
    throw validationError('Invalid OPML format: missing <body> element');
  }

  // Extract body content
  const bodyContent = extractBodyContent(content);
  if (bodyContent === null) {
    throw validationError('Invalid OPML format: could not parse <body> content');
  }

  // Parse outline elements from body
  const feeds = parseOutlines(bodyContent);

  return { feeds };
}

/**
 * Extract the content between <body> and </body> tags.
 */
function extractBodyContent(xml: string): string | null {
  const bodyStartRegex = /<body[^>]*>/i;
  const bodyEndRegex = /<\/body>/i;

  const startMatch = bodyStartRegex.exec(xml);
  if (!startMatch) return null;

  const endMatch = bodyEndRegex.exec(xml);
  if (!endMatch) return null;

  const startIdx = startMatch.index + startMatch[0].length;
  const endIdx = endMatch.index;

  if (endIdx <= startIdx) return null;

  return xml.substring(startIdx, endIdx);
}

/**
 * Parse outline elements, handling both nested (category > feed) and flat structures.
 */
function parseOutlines(bodyContent: string): ParsedFeed[] {
  const feeds: ParsedFeed[] = [];

  // Find all top-level outline elements in body
  const outlineRegex = /<outline\b([^>]*?)(\/>|>([\s\S]*?)<\/outline>)/gi;
  let match: RegExpExecArray | null;

  while ((match = outlineRegex.exec(bodyContent)) !== null) {
    const attrs = parseAttributes(match[1]);
    const innerContent = match[3] || '';
    const isSelfClosing = match[2] === '/>';

    if (attrs.xmlUrl || attrs.xmlurl) {
      // This is a feed outline at top level (no category)
      feeds.push({
        url: attrs.xmlUrl || attrs.xmlurl || '',
        title: attrs.text || attrs.title || attrs.xmlUrl || attrs.xmlurl || '',
        category: '',
      });
    } else if (!isSelfClosing && innerContent.trim().length > 0) {
      // This is a category outline — parse children
      const categoryName = attrs.text || attrs.title || '';
      const childFeeds = parseChildOutlines(innerContent, categoryName);
      feeds.push(...childFeeds);
    }
    // Skip self-closing outlines without xmlUrl (empty categories)
  }

  return feeds;
}

/**
 * Parse child outline elements within a category.
 */
function parseChildOutlines(content: string, categoryName: string): ParsedFeed[] {
  const feeds: ParsedFeed[] = [];
  const outlineRegex = /<outline\b([^>]*?)(\/>|>([\s\S]*?)<\/outline>)/gi;
  let match: RegExpExecArray | null;

  while ((match = outlineRegex.exec(content)) !== null) {
    const attrs = parseAttributes(match[1]);

    if (attrs.xmlUrl || attrs.xmlurl) {
      feeds.push({
        url: attrs.xmlUrl || attrs.xmlurl || '',
        title: attrs.text || attrs.title || attrs.xmlUrl || attrs.xmlurl || '',
        category: categoryName,
      });
    }
    // Nested sub-categories not supported (standard OPML is 2 levels)
  }

  return feeds;
}

/**
 * Parse XML attributes from an attribute string.
 * Handles both single and double quoted values, and XML entity decoding.
 */
function parseAttributes(attrString: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRegex = /(\w+)\s*=\s*["']([^"']*?)["']/g;
  let match: RegExpExecArray | null;

  while ((match = attrRegex.exec(attrString)) !== null) {
    const key = match[1];
    const value = decodeXMLEntities(match[2]);
    attrs[key] = value;
  }

  return attrs;
}

/**
 * Decode common XML entities in attribute values.
 */
function decodeXMLEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

// === Generator ===

/**
 * Generate a valid OPML 2.0 XML string from subscription data.
 * Groups feeds by category name.
 */
export function generateOPML(subscriptions: SubscriptionWithCategory[]): string {
  // Group subscriptions by category
  const grouped = new Map<string, SubscriptionWithCategory[]>();

  for (const sub of subscriptions) {
    const category = sub.categoryName || '';
    if (!grouped.has(category)) {
      grouped.set(category, []);
    }
    grouped.get(category)!.push(sub);
  }

  // Build OPML XML
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<opml version="2.0">\n';
  xml += '  <head><title>RSS Subscriptions</title></head>\n';
  xml += '  <body>\n';

  // Output uncategorized feeds first (empty category name)
  const uncategorized = grouped.get('') || [];
  for (const sub of uncategorized) {
    xml += `    <outline type="rss" text="${escapeXML(sub.title)}" title="${escapeXML(sub.title)}" xmlUrl="${escapeXML(sub.url)}"/>\n`;
  }

  // Output categorized feeds
  for (const [category, subs] of grouped) {
    if (category === '') continue; // Already handled above

    xml += `    <outline text="${escapeXML(category)}" title="${escapeXML(category)}">\n`;
    for (const sub of subs) {
      xml += `      <outline type="rss" text="${escapeXML(sub.title)}" title="${escapeXML(sub.title)}" xmlUrl="${escapeXML(sub.url)}"/>\n`;
    }
    xml += '    </outline>\n';
  }

  xml += '  </body>\n';
  xml += '</opml>\n';

  return xml;
}

/**
 * Escape XML special characters for safe use in attribute values.
 */
function escapeXML(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
