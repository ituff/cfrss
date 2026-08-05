/**
 * TTS utility functions — pure logic extracted for testability.
 * These functions work with text/HTML content without requiring DOM APIs
 * in the test environment.
 *
 * Requirements: 10.4 (paragraph boundary detection)
 */

/**
 * Block-level HTML tags that serve as paragraph boundaries.
 * Used to split article content into discrete speech segments.
 */
const BLOCK_TAGS = [
  'p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'li', 'blockquote', 'pre', 'section', 'article',
  'header', 'footer', 'figcaption', 'td', 'th',
];

/**
 * Extract paragraphs from HTML content using regex-based parsing.
 * This is a pure function that doesn't rely on DOM APIs, making it
 * testable in non-browser environments (e.g., Cloudflare Workers tests).
 *
 * Strategy: recursively find block-level elements. If a block element contains
 * nested block elements, recurse into them. Otherwise, extract the text content
 * of the leaf-level block element.
 */
export function extractParagraphsFromHTML(html: string): string[] {
  if (!html || !html.trim()) {
    return [];
  }

  const paragraphs: string[] = [];
  extractFromFragment(html, paragraphs);

  // Fallback: if no block elements found, treat entire content as one paragraph
  if (paragraphs.length === 0) {
    const fullText = stripHtmlTags(html).trim();
    if (fullText) {
      paragraphs.push(fullText);
    }
  }

  return paragraphs;
}

/**
 * Recursively extract text from block elements.
 * If a block element contains child block elements, recurse into those.
 * Otherwise, extract the text content of the block element itself.
 */
function extractFromFragment(html: string, paragraphs: string[]): void {
  // Match any block-level opening tag and find its content
  const blockTagsPattern = BLOCK_TAGS.join('|');
  const blockOpenRegex = new RegExp(
    `<(${blockTagsPattern})(\\s[^>]*)?>([\\s\\S]*?)<\\/\\1>`,
    'gi'
  );

  let match: RegExpExecArray | null;
  let foundBlock = false;

  while ((match = blockOpenRegex.exec(html)) !== null) {
    foundBlock = true;
    const innerContent = match[3];

    // Check if the inner content contains nested block elements
    const hasNestedBlocks = new RegExp(
      `<(${blockTagsPattern})(\\s[^>]*)?>`,
      'i'
    ).test(innerContent);

    if (hasNestedBlocks) {
      // Recurse into nested blocks
      extractFromFragment(innerContent, paragraphs);
    } else {
      // Leaf block — extract text
      const text = stripHtmlTags(innerContent).trim();
      if (text) {
        paragraphs.push(text);
      }
    }
  }

  // If no block elements at this level but there's text, it's handled by the caller's fallback
  if (!foundBlock) {
    const text = stripHtmlTags(html).trim();
    if (text) {
      paragraphs.push(text);
    }
  }
}

/**
 * Strip all HTML tags from a string, leaving only text content.
 */
function stripHtmlTags(html: string): string {
  return html.replace(/<[^>]*>/g, '');
}

/**
 * Get the number of paragraphs in HTML content.
 * Useful for determining how many audio segments to expect.
 */
export function getParagraphCount(html: string): number {
  return extractParagraphsFromHTML(html).length;
}
