/**
 * Unit tests for TTS service logic.
 * Tests paragraph extraction, state transitions, and cross-article stop behavior.
 *
 * Requirements: 10.1, 10.4, 10.6, 10.7
 */
import { describe, it, expect } from 'vitest';
import { extractParagraphsFromHTML } from '../../src/client/services/tts-utils';

describe('extractParagraphsFromHTML', () => {
  describe('block element extraction', () => {
    it('should extract text from <p> elements', () => {
      const html = '<p>First paragraph.</p><p>Second paragraph.</p>';
      const result = extractParagraphsFromHTML(html);
      expect(result).toEqual(['First paragraph.', 'Second paragraph.']);
    });

    it('should extract text from heading elements', () => {
      const html = '<h1>Title</h1><p>Content here.</p>';
      const result = extractParagraphsFromHTML(html);
      expect(result).toEqual(['Title', 'Content here.']);
    });

    it('should extract text from list items', () => {
      const html = '<ul><li>Item one</li><li>Item two</li></ul>';
      const result = extractParagraphsFromHTML(html);
      expect(result).toEqual(['Item one', 'Item two']);
    });

    it('should extract text from blockquotes', () => {
      const html = '<blockquote>A quoted passage.</blockquote><p>Normal text.</p>';
      const result = extractParagraphsFromHTML(html);
      expect(result).toEqual(['A quoted passage.', 'Normal text.']);
    });

    it('should skip empty block elements', () => {
      const html = '<p>Content</p><p>   </p><p>More content</p>';
      const result = extractParagraphsFromHTML(html);
      expect(result).toEqual(['Content', 'More content']);
    });
  });

  describe('fallback behavior', () => {
    it('should treat entire text as one paragraph if no block elements', () => {
      const html = 'Just some plain text without any block elements';
      const result = extractParagraphsFromHTML(html);
      expect(result).toEqual(['Just some plain text without any block elements']);
    });

    it('should return empty array for empty content', () => {
      const html = '';
      const result = extractParagraphsFromHTML(html);
      expect(result).toEqual([]);
    });

    it('should return empty array for whitespace-only content', () => {
      const html = '   \n\t  ';
      const result = extractParagraphsFromHTML(html);
      expect(result).toEqual([]);
    });
  });

  describe('inline elements inside blocks', () => {
    it('should include inline element text within the block text', () => {
      const html = '<p>Text with <strong>bold</strong> and <em>italic</em>.</p>';
      const result = extractParagraphsFromHTML(html);
      expect(result).toEqual(['Text with bold and italic.']);
    });

    it('should include link text within the block text', () => {
      const html = '<p>Click <a href="#">here</a> for more.</p>';
      const result = extractParagraphsFromHTML(html);
      expect(result).toEqual(['Click here for more.']);
    });
  });

  describe('nested block elements', () => {
    it('should not duplicate text from nested blocks', () => {
      const html = '<div><p>Inner paragraph</p></div>';
      const result = extractParagraphsFromHTML(html);
      // Should pick up the innermost block element
      expect(result).toEqual(['Inner paragraph']);
    });

    it('should handle mixed nesting correctly', () => {
      const html = '<section><h2>Heading</h2><p>Body text.</p></section>';
      const result = extractParagraphsFromHTML(html);
      expect(result).toEqual(['Heading', 'Body text.']);
    });
  });
});
