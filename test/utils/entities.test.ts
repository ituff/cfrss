import { describe, it, expect } from 'vitest';
import { decodeHtmlEntities } from '../../src/utils/entities';

describe('decodeHtmlEntities', () => {
  it('decodes named XML entities', () => {
    expect(decodeHtmlEntities('Tom &amp; Jerry&apos;s &quot;Adventure&quot;')).toBe(
      'Tom & Jerry\'s "Adventure"'
    );
    expect(decodeHtmlEntities('https://example.com/feed?a=1&amp;b=2')).toBe(
      'https://example.com/feed?a=1&b=2'
    );
    expect(decodeHtmlEntities('&lt;tag&gt;')).toBe('<tag>');
    expect(decodeHtmlEntities('a&nbsp;b')).toBe('a b');
  });

  it('decodes decimal and hexadecimal numeric entities', () => {
    expect(decodeHtmlEntities('&#43; &#x41;')).toBe('+ A');
  });

  it('never double-unescapes pre-escaped entities', () => {
    // A chained `&amp;` -> `&` first would turn this into real markup.
    expect(decodeHtmlEntities('&amp;lt;script&amp;gt;')).toBe('&lt;script&gt;');
    expect(decodeHtmlEntities('&amp;amp;')).toBe('&amp;');
  });

  it('leaves unknown entities and plain text untouched', () => {
    expect(decodeHtmlEntities('&unknown; plain & text')).toBe('&unknown; plain & text');
    expect(decodeHtmlEntities('')).toBe('');
    expect(decodeHtmlEntities('no entities here')).toBe('no entities here');
  });
});
