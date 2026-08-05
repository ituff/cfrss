/**
 * Theme Engine unit tests.
 *
 * Since the test environment is Cloudflare Workers (no DOM), we mock
 * document, window, and localStorage to test theme logic.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// We need to set up global mocks before importing the module
let themeModule: typeof import('../../src/client/services/theme');

// Mock storage
let mockStorage: Record<string, string> = {};
// Mock DOM attribute
let mockDataTheme: string | null = null;
// Mock matchMedia result
let mockDarkPreference = false;
// Mock fetch responses
let mockFetchResponse: { ok: boolean; theme: string | null } | null = null;
let mockFetchError = false;

describe('Theme Engine', () => {
  beforeEach(async () => {
    // Reset mocks
    mockStorage = {};
    mockDataTheme = null;
    mockDarkPreference = false;
    mockFetchResponse = null;
    mockFetchError = false;

    // Setup global mocks
    (globalThis as any).document = {
      documentElement: {
        getAttribute: (name: string) => {
          if (name === 'data-theme') return mockDataTheme;
          return null;
        },
        setAttribute: (name: string, value: string) => {
          if (name === 'data-theme') mockDataTheme = value;
        },
      },
    };

    (globalThis as any).localStorage = {
      getItem: (key: string) => mockStorage[key] ?? null,
      setItem: (key: string, value: string) => {
        mockStorage[key] = value;
      },
      removeItem: (key: string) => {
        delete mockStorage[key];
      },
    };

    (globalThis as any).window = {
      matchMedia: (query: string) => ({
        matches: query === '(prefers-color-scheme: dark)' ? mockDarkPreference : false,
      }),
    };

    (globalThis as any).fetch = vi.fn(async () => {
      if (mockFetchError) throw new Error('Network error');
      if (mockFetchResponse) {
        return {
          ok: mockFetchResponse.ok,
          json: async () => ({ theme: mockFetchResponse!.theme }),
        };
      }
      return { ok: false };
    });

    // Re-import to get fresh module with mocked globals
    themeModule = await import('../../src/client/services/theme');
  });

  afterEach(() => {
    delete (globalThis as any).document;
    delete (globalThis as any).localStorage;
    delete (globalThis as any).window;
    delete (globalThis as any).fetch;
    vi.resetModules();
  });

  describe('applyTheme', () => {
    it('should set data-theme attribute on documentElement', () => {
      themeModule.applyTheme('dark');
      expect(mockDataTheme).toBe('dark');
    });

    it('should persist theme to localStorage', () => {
      themeModule.applyTheme('light');
      expect(mockStorage['theme']).toBe('light');
    });

    it('should handle dark theme', () => {
      themeModule.applyTheme('dark');
      expect(mockDataTheme).toBe('dark');
      expect(mockStorage['theme']).toBe('dark');
    });
  });

  describe('getCurrentTheme', () => {
    it('should return theme from DOM attribute when set', () => {
      mockDataTheme = 'dark';
      expect(themeModule.getCurrentTheme()).toBe('dark');
    });

    it('should fall back to localStorage when DOM attribute not set', () => {
      mockDataTheme = null;
      mockStorage['theme'] = 'dark';
      expect(themeModule.getCurrentTheme()).toBe('dark');
    });

    it('should fall back to OS preference when no stored value', () => {
      mockDataTheme = null;
      mockDarkPreference = true;
      expect(themeModule.getCurrentTheme()).toBe('dark');
    });

    it('should default to light when no preference detected', () => {
      mockDataTheme = null;
      mockDarkPreference = false;
      expect(themeModule.getCurrentTheme()).toBe('light');
    });
  });

  describe('initTheme', () => {
    it('should sync with server theme when available', async () => {
      mockDataTheme = 'light';
      mockStorage['theme'] = 'light';
      mockFetchResponse = { ok: true, theme: 'dark' };

      await themeModule.initTheme();

      expect(mockDataTheme).toBe('dark');
      expect(mockStorage['theme']).toBe('dark');
    });

    it('should not change theme if server matches current', async () => {
      mockDataTheme = 'dark';
      mockStorage['theme'] = 'dark';
      mockFetchResponse = { ok: true, theme: 'dark' };

      await themeModule.initTheme();

      expect(mockDataTheme).toBe('dark');
    });

    it('should use OS preference when server fails and no localStorage (req 2.5)', async () => {
      mockDataTheme = null;
      mockDarkPreference = true;
      mockFetchError = true;

      await themeModule.initTheme();

      expect(mockDataTheme).toBe('dark');
      expect(mockStorage['theme']).toBe('dark');
    });

    it('should default to light when server fails, no localStorage, no OS dark (req 2.5)', async () => {
      mockDataTheme = null;
      mockDarkPreference = false;
      mockFetchError = true;

      await themeModule.initTheme();

      expect(mockDataTheme).toBe('light');
      expect(mockStorage['theme']).toBe('light');
    });

    it('should keep localStorage theme when server fails but localStorage exists', async () => {
      mockDataTheme = 'dark';
      mockStorage['theme'] = 'dark';
      mockFetchError = true;

      await themeModule.initTheme();

      // Should not change - localStorage already had a value applied by inline script
      expect(mockDataTheme).toBe('dark');
    });

    it('should handle server returning null theme gracefully', async () => {
      mockDataTheme = 'light';
      mockStorage['theme'] = 'light';
      mockFetchResponse = { ok: true, theme: null };

      await themeModule.initTheme();

      // Server returned no preference, keep current
      expect(mockDataTheme).toBe('light');
    });
  });
});
