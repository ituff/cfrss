import { describe, it, expect } from 'vitest';
import { parseOPML, generateOPML, SubscriptionWithCategory } from '../../src/services/opml';
import { AppError } from '../../src/utils/errors';

describe('OPML Service', () => {
  describe('parseOPML', () => {
    it('should parse valid OPML with categories', () => {
      const opml = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>RSS Subscriptions</title></head>
  <body>
    <outline text="Tech" title="Tech">
      <outline type="rss" text="Hacker News" title="Hacker News" xmlUrl="https://news.ycombinator.com/rss" htmlUrl="https://news.ycombinator.com"/>
      <outline type="rss" text="TechCrunch" title="TechCrunch" xmlUrl="https://techcrunch.com/feed/"/>
    </outline>
    <outline text="News" title="News">
      <outline type="rss" text="BBC News" title="BBC News" xmlUrl="https://feeds.bbci.co.uk/news/rss.xml"/>
    </outline>
  </body>
</opml>`;

      const result = parseOPML(opml);
      expect(result.feeds).toHaveLength(3);
      expect(result.feeds[0]).toEqual({
        url: 'https://news.ycombinator.com/rss',
        title: 'Hacker News',
        category: 'Tech',
      });
      expect(result.feeds[1]).toEqual({
        url: 'https://techcrunch.com/feed/',
        title: 'TechCrunch',
        category: 'Tech',
      });
      expect(result.feeds[2]).toEqual({
        url: 'https://feeds.bbci.co.uk/news/rss.xml',
        title: 'BBC News',
        category: 'News',
      });
    });

    it('should parse valid OPML without categories (flat structure)', () => {
      const opml = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>My Feeds</title></head>
  <body>
    <outline type="rss" text="Feed One" title="Feed One" xmlUrl="https://example.com/feed1.xml"/>
    <outline type="rss" text="Feed Two" title="Feed Two" xmlUrl="https://example.com/feed2.xml"/>
  </body>
</opml>`;

      const result = parseOPML(opml);
      expect(result.feeds).toHaveLength(2);
      expect(result.feeds[0]).toEqual({
        url: 'https://example.com/feed1.xml',
        title: 'Feed One',
        category: '',
      });
      expect(result.feeds[1]).toEqual({
        url: 'https://example.com/feed2.xml',
        title: 'Feed Two',
        category: '',
      });
    });

    it('should handle mixed categorized and uncategorized feeds', () => {
      const opml = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>Feeds</title></head>
  <body>
    <outline type="rss" text="Top Level Feed" xmlUrl="https://example.com/top.xml"/>
    <outline text="Category A" title="Category A">
      <outline type="rss" text="Nested Feed" xmlUrl="https://example.com/nested.xml"/>
    </outline>
  </body>
</opml>`;

      const result = parseOPML(opml);
      expect(result.feeds).toHaveLength(2);
      expect(result.feeds[0].category).toBe('');
      expect(result.feeds[1].category).toBe('Category A');
    });

    it('should use text attribute as title when title attribute is missing', () => {
      const opml = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>Feeds</title></head>
  <body>
    <outline type="rss" text="My Feed" xmlUrl="https://example.com/feed.xml"/>
  </body>
</opml>`;

      const result = parseOPML(opml);
      expect(result.feeds[0].title).toBe('My Feed');
    });

    it('should decode XML entities in attribute values', () => {
      const opml = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>Feeds</title></head>
  <body>
    <outline type="rss" text="Tom &amp; Jerry&apos;s Feed" title="Tom &amp; Jerry&apos;s Feed" xmlUrl="https://example.com/feed?a=1&amp;b=2"/>
  </body>
</opml>`;

      const result = parseOPML(opml);
      expect(result.feeds[0].title).toBe("Tom & Jerry's Feed");
      expect(result.feeds[0].url).toBe('https://example.com/feed?a=1&b=2');
    });

    it('should throw validation error for empty content', () => {
      expect(() => parseOPML('')).toThrow(AppError);
      expect(() => parseOPML('')).toThrow('OPML content is empty');
    });

    it('should throw validation error for whitespace-only content', () => {
      expect(() => parseOPML('   \n\t  ')).toThrow('OPML content is empty');
    });

    it('should throw validation error for content exceeding 5MB', () => {
      // Create content just over 5MB
      const largeContent = '<opml><body>' + 'x'.repeat(5 * 1024 * 1024) + '</body></opml>';
      expect(() => parseOPML(largeContent)).toThrow('exceeds maximum size of 5MB');
    });

    it('should throw validation error for missing opml root element', () => {
      const invalid = `<?xml version="1.0"?><root><body></body></root>`;
      expect(() => parseOPML(invalid)).toThrow('missing <opml> root element');
    });

    it('should throw validation error for missing body element', () => {
      const invalid = `<?xml version="1.0"?><opml version="2.0"><head></head></opml>`;
      expect(() => parseOPML(invalid)).toThrow('missing <body> element');
    });

    it('should skip outlines without xmlUrl (category folders)', () => {
      const opml = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>Feeds</title></head>
  <body>
    <outline text="Empty Category"/>
    <outline type="rss" text="Real Feed" xmlUrl="https://example.com/feed.xml"/>
  </body>
</opml>`;

      const result = parseOPML(opml);
      expect(result.feeds).toHaveLength(1);
      expect(result.feeds[0].url).toBe('https://example.com/feed.xml');
    });

    it('should handle Chinese characters in category names and feed titles', () => {
      const opml = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>RSS Subscriptions</title></head>
  <body>
    <outline text="科技" title="科技">
      <outline type="rss" text="少数派" title="少数派" xmlUrl="https://sspai.com/feed"/>
    </outline>
  </body>
</opml>`;

      const result = parseOPML(opml);
      expect(result.feeds[0].category).toBe('科技');
      expect(result.feeds[0].title).toBe('少数派');
    });
  });

  describe('generateOPML', () => {
    it('should generate valid OPML from subscriptions with categories', () => {
      const subscriptions: SubscriptionWithCategory[] = [
        { url: 'https://example.com/feed1.xml', title: 'Feed One', categoryName: 'Tech' },
        { url: 'https://example.com/feed2.xml', title: 'Feed Two', categoryName: 'Tech' },
        { url: 'https://example.com/feed3.xml', title: 'Feed Three', categoryName: 'News' },
      ];

      const opml = generateOPML(subscriptions);

      expect(opml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(opml).toContain('<opml version="2.0">');
      expect(opml).toContain('<head><title>RSS Subscriptions</title></head>');
      expect(opml).toContain('<body>');
      expect(opml).toContain('</body>');
      expect(opml).toContain('</opml>');
      expect(opml).toContain('text="Tech"');
      expect(opml).toContain('xmlUrl="https://example.com/feed1.xml"');
      expect(opml).toContain('xmlUrl="https://example.com/feed2.xml"');
      expect(opml).toContain('text="News"');
      expect(opml).toContain('xmlUrl="https://example.com/feed3.xml"');
    });

    it('should generate OPML for uncategorized subscriptions', () => {
      const subscriptions: SubscriptionWithCategory[] = [
        { url: 'https://example.com/feed.xml', title: 'My Feed', categoryName: '' },
      ];

      const opml = generateOPML(subscriptions);

      // Uncategorized feeds should be at body level without category wrapper
      expect(opml).toContain('xmlUrl="https://example.com/feed.xml"');
      expect(opml).not.toContain('<outline text="" title="">');
    });

    it('should escape XML special characters in attribute values', () => {
      const subscriptions: SubscriptionWithCategory[] = [
        {
          url: 'https://example.com/feed?a=1&b=2',
          title: 'Tom & Jerry\'s "Feed" <test>',
          categoryName: 'News & Media',
        },
      ];

      const opml = generateOPML(subscriptions);

      expect(opml).toContain('xmlUrl="https://example.com/feed?a=1&amp;b=2"');
      expect(opml).toContain('text="Tom &amp; Jerry&apos;s &quot;Feed&quot; &lt;test&gt;"');
      expect(opml).toContain('text="News &amp; Media"');
    });

    it('should handle empty subscription list', () => {
      const opml = generateOPML([]);

      expect(opml).toContain('<opml version="2.0">');
      expect(opml).toContain('<body>');
      expect(opml).toContain('</body>');
    });
  });

  describe('round-trip (generate then parse)', () => {
    it('should preserve feed data through export and re-import', () => {
      const subscriptions: SubscriptionWithCategory[] = [
        { url: 'https://example.com/feed1.xml', title: 'Feed One', categoryName: 'Tech' },
        { url: 'https://example.com/feed2.xml', title: 'Feed Two', categoryName: '' },
        { url: 'https://example.com/feed3.xml', title: 'Feed Three', categoryName: 'News' },
      ];

      const opml = generateOPML(subscriptions);
      const parsed = parseOPML(opml);

      expect(parsed.feeds).toHaveLength(3);

      // Find each original subscription in parsed output
      for (const sub of subscriptions) {
        const found = parsed.feeds.find((f) => f.url === sub.url);
        expect(found).toBeDefined();
        expect(found!.title).toBe(sub.title);
        expect(found!.category).toBe(sub.categoryName);
      }
    });

    it('should preserve XML special characters through round-trip', () => {
      const subscriptions: SubscriptionWithCategory[] = [
        {
          url: 'https://example.com/feed?x=1&y=2',
          title: 'A & B <C> "D"',
          categoryName: "Cat's & Dogs",
        },
      ];

      const opml = generateOPML(subscriptions);
      const parsed = parseOPML(opml);

      expect(parsed.feeds).toHaveLength(1);
      expect(parsed.feeds[0].url).toBe('https://example.com/feed?x=1&y=2');
      expect(parsed.feeds[0].title).toBe('A & B <C> "D"');
      expect(parsed.feeds[0].category).toBe("Cat's & Dogs");
    });
  });
});
