/**
 * Device identity service — client tests.
 *
 * The Workers test pool has no DOM or localStorage, so both are stubbed. The
 * service generates a uuid on first use and must reuse it afterwards: that
 * stability is the entire point, since it is what lets the server tell an
 * e-reader apart from an iPad across sessions.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// --- localStorage stub ---------------------------------------------------

let store: Record<string, string> = {};
let storageThrows = false;

const localStorageStub = {
  getItem(key: string): string | null {
    if (storageThrows) throw new Error('storage unavailable');
    return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
  },
  setItem(key: string, value: string): void {
    if (storageThrows) throw new Error('storage unavailable');
    store[key] = String(value);
  },
  removeItem(key: string): void {
    if (storageThrows) throw new Error('storage unavailable');
    delete store[key];
  },
};

(globalThis as unknown as { localStorage: unknown }).localStorage = localStorageStub;

// The Workers pool exposes a navigator with an empty userAgent, so it must be
// overridden rather than merely defined when absent.
Object.defineProperty(globalThis, 'navigator', {
  value: {
    userAgent:
      'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  },
  configurable: true,
  writable: true,
});

// Imported after the stubs so the module sees them
import {
  getDeviceId,
  getDeviceName,
  describeDevice,
  resetDeviceId,
} from '../../../src/client/services/device.js';

describe('device identity', () => {
  beforeEach(() => {
    store = {};
    storageThrows = false;
    resetDeviceId();
    vi.restoreAllMocks();
  });

  describe('getDeviceId', () => {
    it('generates a uuid v4 on first call', () => {
      const id = getDeviceId();
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });

    it('returns the same id on later calls', () => {
      expect(getDeviceId()).toBe(getDeviceId());
    });

    it('persists the id so a fresh module state reuses it', () => {
      const first = getDeviceId();
      expect(first).not.toBeNull();

      // Simulate a new page load: drop the in-memory cache, keep storage
      resetDeviceId();
      store['cfrss_device_id'] = first as string;
      expect(getDeviceId()).toBe(first);
    });

    it('reuses an id already present in storage without generating a new one', () => {
      store['cfrss_device_id'] = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
      expect(getDeviceId()).toBe('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
    });

    it('returns null when storage is unavailable, rather than throwing', () => {
      storageThrows = true;
      expect(getDeviceId()).toBeNull();
    });
  });

  describe('describeDevice', () => {
    it('labels an iPad on Safari', () => {
      expect(
        describeDevice('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15')
      ).toBe('iPad · Safari');
    });

    it('labels Edge before Chrome, since Edge also claims Chrome', () => {
      expect(
        describeDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0')
      ).toBe('Windows · Edge');
    });

    it('labels an Android Chrome client', () => {
      expect(
        describeDevice('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36')
      ).toBe('Android · Chrome');
    });

    it('degrades gracefully for an empty user agent', () => {
      expect(describeDevice('')).toBe('Unknown device');
    });
  });

  describe('getDeviceName', () => {
    it('derives and caches a readable name', () => {
      const name = getDeviceName();
      expect(name).toBe('iPad · Safari');
      expect(store['cfrss_device_name']).toBe('iPad · Safari');
    });

    it('prefers a previously stored name', () => {
      store['cfrss_device_name'] = 'My e-reader';
      expect(getDeviceName()).toBe('My e-reader');
    });
  });
});
