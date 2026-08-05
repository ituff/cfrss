import { describe, it, expect } from 'vitest';
import { parseHash } from '../../src/client/router';

describe('Router - parseHash', () => {
  it('parses empty hash as home route', () => {
    const route = parseHash('');
    expect(route.path).toBe('home');
    expect(route.params).toEqual({});
  });

  it('parses #/ as home route', () => {
    const route = parseHash('#/');
    expect(route.path).toBe('home');
    expect(route.params).toEqual({});
  });

  it('parses #/subscriptions', () => {
    const route = parseHash('#/subscriptions');
    expect(route.path).toBe('subscriptions');
    expect(route.params).toEqual({});
  });

  it('parses #/articles', () => {
    const route = parseHash('#/articles');
    expect(route.path).toBe('articles');
    expect(route.params).toEqual({});
  });

  it('parses #/articles/:id with param', () => {
    const route = parseHash('#/articles/abc-123');
    expect(route.path).toBe('article-detail');
    expect(route.params).toEqual({ id: 'abc-123' });
  });

  it('parses #/settings', () => {
    const route = parseHash('#/settings');
    expect(route.path).toBe('settings');
    expect(route.params).toEqual({});
  });

  it('returns home for unknown routes', () => {
    const route = parseHash('#/unknown');
    expect(route.path).toBe('home');
    expect(route.params).toEqual({});
  });

  it('handles article IDs with special characters', () => {
    const route = parseHash('#/articles/foo-bar_123.json');
    expect(route.path).toBe('article-detail');
    expect(route.params.id).toBe('foo-bar_123.json');
  });
});
