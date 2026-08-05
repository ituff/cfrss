import { describe, it, expect } from 'vitest';
import { validateUrl } from '../../src/utils/url-validator';

describe('validateUrl - synchronous format validation', () => {
  describe('valid URLs', () => {
    it('accepts a valid https URL', () => {
      const result = validateUrl('https://example.com/feed.xml');
      expect(result).toEqual({ valid: true });
    });

    it('accepts a valid http URL', () => {
      const result = validateUrl('http://example.com/rss');
      expect(result).toEqual({ valid: true });
    });

    it('accepts a URL with port number', () => {
      const result = validateUrl('https://example.com:8080/feed');
      expect(result).toEqual({ valid: true });
    });

    it('accepts a URL with path and query params', () => {
      const result = validateUrl('https://example.com/feed?format=rss&lang=en');
      expect(result).toEqual({ valid: true });
    });

    it('accepts a URL at exactly 2048 characters', () => {
      const base = 'https://example.com/';
      const url = base + 'a'.repeat(2048 - base.length);
      const result = validateUrl(url);
      expect(result).toEqual({ valid: true });
    });
  });

  describe('invalid URLs - protocol', () => {
    it('rejects ftp:// protocol', () => {
      const result = validateUrl('ftp://example.com/feed.xml');
      expect(result).toEqual({
        valid: false,
        reason: 'format_error',
        message: 'URL must use http:// or https:// protocol',
      });
    });

    it('rejects URLs without protocol', () => {
      const result = validateUrl('example.com/feed.xml');
      expect(result).toEqual({
        valid: false,
        reason: 'format_error',
        message: 'URL must use http:// or https:// protocol',
      });
    });

    it('rejects javascript: protocol', () => {
      const result = validateUrl('javascript:alert(1)');
      expect(result).toEqual({
        valid: false,
        reason: 'format_error',
        message: 'URL must use http:// or https:// protocol',
      });
    });

    it('rejects data: protocol', () => {
      const result = validateUrl('data:text/html,<h1>hi</h1>');
      expect(result).toEqual({
        valid: false,
        reason: 'format_error',
        message: 'URL must use http:// or https:// protocol',
      });
    });
  });

  describe('invalid URLs - length', () => {
    it('rejects URLs exceeding 2048 characters', () => {
      const base = 'https://example.com/';
      const url = base + 'a'.repeat(2049 - base.length);
      const result = validateUrl(url);
      expect(result).toEqual({
        valid: false,
        reason: 'format_error',
        message: 'URL must not exceed 2048 characters',
      });
    });
  });

  describe('invalid URLs - format', () => {
    it('rejects empty string', () => {
      const result = validateUrl('');
      expect(result).toEqual({
        valid: false,
        reason: 'format_error',
        message: 'URL must be a non-empty string',
      });
    });

    it('rejects malformed URL that starts with https:// but is unparseable', () => {
      // URL constructor throws for invalid URLs even with valid protocol
      const result = validateUrl('https://');
      expect(result).toEqual({
        valid: false,
        reason: 'format_error',
        message: 'URL is not a valid format',
      });
    });
  });
});
