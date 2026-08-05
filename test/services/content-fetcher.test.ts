import { describe, it, expect } from 'vitest';
import { parseFeed, rfc2822ToISO8601 } from '../../src/services/content-fetcher';

describe('Content Fetcher - parseFeed', () => {
  describe('RSS 2.0 parsing', () => {
    it('should parse a basic RSS 2.0 feed', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>My Tech Blog</title>
    <link>https://example.com</link>
    <item>
      <title>First Post</title>
      <link>https://example.com/post-1</link>
      <author>john@example.com</author>
      <pubDate>Mon, 15 Jan 2024 08:30:00 GMT</pubDate>
      <description>A short summary of the post.</description>
    </item>
  </channel>
</rss>`;

      const result = parseFeed(xml);
      expect(result.feedTitle).toBe('My Tech Blog');
      expect(result.articles).toHaveLength(1);
      expect(result.articles[0]).toEqual({
        title: 'First Post',
        author: 'john@example.com',
        publishedAt: '2024-01-15T08:30:00.000Z',
        summary: 'A short summary of the post.',
        htmlContent: 'A short summary of the post.',
        sourceUrl: 'https://example.com/post-1',
      });
    });

    it('should parse RSS 2.0 with content:encoded', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>Tech News</title>
    <item>
      <title>Article With Content</title>
      <link>https://example.com/article</link>
      <description>Short summary</description>
      <content:encoded><![CDATA[<p>Full <strong>HTML</strong> content here.</p>]]></content:encoded>
      <pubDate>Tue, 16 Jan 2024 10:00:00 +0000</pubDate>
    </item>
  </channel>
</rss>`;

      const result = parseFeed(xml);
      expect(result.articles[0].summary).toBe('Short summary');
      expect(result.articles[0].htmlContent).toBe('<p>Full <strong>HTML</strong> content here.</p>');
    });

    it('should parse RSS 2.0 with dc:creator', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>Blog</title>
    <item>
      <title>Post by DC Creator</title>
      <link>https://example.com/post</link>
      <dc:creator>Jane Doe</dc:creator>
      <pubDate>Wed, 17 Jan 2024 12:00:00 GMT</pubDate>
      <description>Summary text</description>
    </item>
  </channel>
</rss>`;

      const result = parseFeed(xml);
      expect(result.articles[0].author).toBe('Jane Doe');
    });

    it('should parse multiple RSS items', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Multi Post Blog</title>
    <item>
      <title>Post One</title>
      <link>https://example.com/1</link>
      <pubDate>Mon, 15 Jan 2024 08:00:00 GMT</pubDate>
      <description>First</description>
    </item>
    <item>
      <title>Post Two</title>
      <link>https://example.com/2</link>
      <pubDate>Tue, 16 Jan 2024 09:00:00 GMT</pubDate>
      <description>Second</description>
    </item>
    <item>
      <title>Post Three</title>
      <link>https://example.com/3</link>
      <pubDate>Wed, 17 Jan 2024 10:00:00 GMT</pubDate>
      <description>Third</description>
    </item>
  </channel>
</rss>`;

      const result = parseFeed(xml);
      expect(result.articles).toHaveLength(3);
      expect(result.articles[0].title).toBe('Post One');
      expect(result.articles[1].title).toBe('Post Two');
      expect(result.articles[2].title).toBe('Post Three');
    });

    it('should handle RSS items with missing fields', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Minimal Feed</title>
    <item>
      <title>Only Title</title>
    </item>
  </channel>
</rss>`;

      const result = parseFeed(xml);
      expect(result.articles).toHaveLength(1);
      expect(result.articles[0]).toEqual({
        title: 'Only Title',
        author: '',
        publishedAt: '',
        summary: '',
        htmlContent: '',
        sourceUrl: '',
      });
    });

    it('should handle CDATA in description', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>CDATA Feed</title>
    <item>
      <title>CDATA Post</title>
      <link>https://example.com/cdata</link>
      <description><![CDATA[<p>HTML in description with <a href="https://example.com">link</a></p>]]></description>
      <pubDate>Thu, 18 Jan 2024 14:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

      const result = parseFeed(xml);
      expect(result.articles[0].summary).toBe('<p>HTML in description with <a href="https://example.com">link</a></p>');
    });

    it('should decode XML entities in RSS fields', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Entities &amp; More</title>
    <item>
      <title>Tom &amp; Jerry&apos;s &quot;Adventure&quot;</title>
      <link>https://example.com/post?a=1&amp;b=2</link>
      <description>&lt;p&gt;Content with &lt;em&gt;entities&lt;/em&gt;&lt;/p&gt;</description>
      <pubDate>Fri, 19 Jan 2024 16:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

      const result = parseFeed(xml);
      expect(result.feedTitle).toBe('Entities & More');
      expect(result.articles[0].title).toBe('Tom & Jerry\'s "Adventure"');
      expect(result.articles[0].sourceUrl).toBe('https://example.com/post?a=1&b=2');
      expect(result.articles[0].summary).toBe('<p>Content with <em>entities</em></p>');
    });
  });

  describe('Atom 1.0 parsing', () => {
    it('should parse a basic Atom 1.0 feed', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>My Atom Blog</title>
  <entry>
    <title>First Entry</title>
    <link href="https://example.com/entry-1" rel="alternate"/>
    <author><name>Alice</name></author>
    <published>2024-01-15T08:30:00Z</published>
    <summary>A short summary</summary>
    <content type="html">&lt;p&gt;Full content here.&lt;/p&gt;</content>
  </entry>
</feed>`;

      const result = parseFeed(xml);
      expect(result.feedTitle).toBe('My Atom Blog');
      expect(result.articles).toHaveLength(1);
      expect(result.articles[0]).toEqual({
        title: 'First Entry',
        author: 'Alice',
        publishedAt: '2024-01-15T08:30:00Z',
        summary: 'A short summary',
        htmlContent: '<p>Full content here.</p>',
        sourceUrl: 'https://example.com/entry-1',
      });
    });

    it('should use updated when published is missing in Atom', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Updated Feed</title>
  <entry>
    <title>Entry Without Published</title>
    <link href="https://example.com/entry"/>
    <updated>2024-02-20T12:00:00Z</updated>
    <summary>Some summary</summary>
  </entry>
</feed>`;

      const result = parseFeed(xml);
      expect(result.articles[0].publishedAt).toBe('2024-02-20T12:00:00Z');
    });

    it('should extract link with rel="alternate"', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Links Feed</title>
  <entry>
    <title>Multiple Links</title>
    <link href="https://example.com/self" rel="self"/>
    <link href="https://example.com/alternate" rel="alternate"/>
    <summary>Has multiple links</summary>
  </entry>
</feed>`;

      const result = parseFeed(xml);
      expect(result.articles[0].sourceUrl).toBe('https://example.com/alternate');
    });

    it('should use first link href when no rel="alternate" present', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Simple Links</title>
  <entry>
    <title>Link Entry</title>
    <link href="https://example.com/only-link"/>
    <summary>Single link</summary>
  </entry>
</feed>`;

      const result = parseFeed(xml);
      expect(result.articles[0].sourceUrl).toBe('https://example.com/only-link');
    });

    it('should parse multiple Atom entries', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Multi Entry Feed</title>
  <entry>
    <title>Entry 1</title>
    <link href="https://example.com/1"/>
    <published>2024-01-01T00:00:00Z</published>
    <summary>First</summary>
  </entry>
  <entry>
    <title>Entry 2</title>
    <link href="https://example.com/2"/>
    <published>2024-01-02T00:00:00Z</published>
    <summary>Second</summary>
  </entry>
</feed>`;

      const result = parseFeed(xml);
      expect(result.articles).toHaveLength(2);
      expect(result.articles[0].title).toBe('Entry 1');
      expect(result.articles[1].title).toBe('Entry 2');
    });

    it('should handle Atom entries with missing fields', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Sparse Feed</title>
  <entry>
    <title>Minimal Entry</title>
  </entry>
</feed>`;

      const result = parseFeed(xml);
      expect(result.articles).toHaveLength(1);
      expect(result.articles[0]).toEqual({
        title: 'Minimal Entry',
        author: '',
        publishedAt: '',
        summary: '',
        htmlContent: '',
        sourceUrl: '',
      });
    });

    it('should handle CDATA in Atom content', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>CDATA Atom Feed</title>
  <entry>
    <title>CDATA Entry</title>
    <link href="https://example.com/cdata"/>
    <content type="html"><![CDATA[<div><h1>Title</h1><p>Content with <strong>HTML</strong></p></div>]]></content>
  </entry>
</feed>`;

      const result = parseFeed(xml);
      expect(result.articles[0].htmlContent).toBe('<div><h1>Title</h1><p>Content with <strong>HTML</strong></p></div>');
    });
  });

  describe('Edge cases', () => {
    it('should return empty result for empty input', () => {
      const result = parseFeed('');
      expect(result.feedTitle).toBe('');
      expect(result.articles).toHaveLength(0);
    });

    it('should return empty result for whitespace-only input', () => {
      const result = parseFeed('   \n\t  ');
      expect(result.feedTitle).toBe('');
      expect(result.articles).toHaveLength(0);
    });

    it('should return empty result for unknown XML format', () => {
      const result = parseFeed('<html><body>Not a feed</body></html>');
      expect(result.feedTitle).toBe('');
      expect(result.articles).toHaveLength(0);
    });

    it('should handle RSS with no items', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Empty Feed</title>
    <description>No articles yet</description>
  </channel>
</rss>`;

      const result = parseFeed(xml);
      expect(result.feedTitle).toBe('Empty Feed');
      expect(result.articles).toHaveLength(0);
    });

    it('should handle Atom feed with no entries', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Empty Atom Feed</title>
</feed>`;

      const result = parseFeed(xml);
      expect(result.feedTitle).toBe('Empty Atom Feed');
      expect(result.articles).toHaveLength(0);
    });

    it('should use summary as htmlContent when content:encoded is missing in RSS', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Fallback Feed</title>
    <item>
      <title>No Content Encoded</title>
      <link>https://example.com/fallback</link>
      <description>This is both summary and content</description>
    </item>
  </channel>
</rss>`;

      const result = parseFeed(xml);
      expect(result.articles[0].summary).toBe('This is both summary and content');
      expect(result.articles[0].htmlContent).toBe('This is both summary and content');
    });

    it('should use summary as htmlContent when content is missing in Atom', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Fallback Atom Feed</title>
  <entry>
    <title>No Content</title>
    <link href="https://example.com/fallback"/>
    <summary>This is both summary and content</summary>
  </entry>
</feed>`;

      const result = parseFeed(xml);
      expect(result.articles[0].summary).toBe('This is both summary and content');
      expect(result.articles[0].htmlContent).toBe('This is both summary and content');
    });
  });

  describe('rfc2822ToISO8601', () => {
    it('should convert standard RFC 2822 date', () => {
      const result = rfc2822ToISO8601('Mon, 15 Jan 2024 08:30:00 GMT');
      expect(result).toBe('2024-01-15T08:30:00.000Z');
    });

    it('should convert RFC 2822 with timezone offset', () => {
      const result = rfc2822ToISO8601('Tue, 16 Jan 2024 10:00:00 +0000');
      expect(result).toBe('2024-01-16T10:00:00.000Z');
    });

    it('should handle RFC 2822 without day name', () => {
      const result = rfc2822ToISO8601('15 Jan 2024 08:30:00 GMT');
      expect(result).toBe('2024-01-15T08:30:00.000Z');
    });

    it('should return empty string for empty input', () => {
      expect(rfc2822ToISO8601('')).toBe('');
    });

    it('should return original string for unparseable dates', () => {
      expect(rfc2822ToISO8601('not a date')).toBe('not a date');
    });
  });
});
