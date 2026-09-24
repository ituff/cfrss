/**
 * Unit tests for gesture detection logic (pure functions, no DOM).
 * Tests the swipe threshold and pull-to-refresh threshold math.
 *
 * Requirements: 1.3, 1.4, 1.5, 1.6
 */
import { describe, it, expect } from 'vitest';
import { detectSwipe, detectPullRefresh } from '../../src/client/gestures';

describe('detectSwipe', () => {
  describe('threshold behavior (50px)', () => {
    it('should not trigger for deltaX exactly 50px', () => {
      const result = detectSwipe(50, 0);
      expect(result.direction).toBe('none');
    });

    it('should not trigger for deltaX exactly -50px', () => {
      const result = detectSwipe(-50, 0);
      expect(result.direction).toBe('none');
    });

    it('should trigger left for deltaX of -51px (horizontal dominant)', () => {
      const result = detectSwipe(-51, 0);
      expect(result.direction).toBe('left');
      expect(result.distance).toBe(51);
    });

    it('should trigger right for deltaX of 51px (horizontal dominant)', () => {
      const result = detectSwipe(51, 0);
      expect(result.direction).toBe('right');
      expect(result.distance).toBe(51);
    });

    it('should not trigger for deltaX below 50px', () => {
      const result = detectSwipe(30, 10);
      expect(result.direction).toBe('none');
    });

    it('should not trigger for deltaX of 0', () => {
      const result = detectSwipe(0, 0);
      expect(result.direction).toBe('none');
    });
  });

  describe('horizontal vs vertical disambiguation', () => {
    it('should not trigger if deltaY equals deltaX (not strictly horizontal)', () => {
      const result = detectSwipe(60, 60);
      expect(result.direction).toBe('none');
    });

    it('should not trigger if deltaY exceeds deltaX (vertical scroll)', () => {
      const result = detectSwipe(60, 80);
      expect(result.direction).toBe('none');
    });

    it('should trigger if deltaX exceeds deltaY (primarily horizontal)', () => {
      const result = detectSwipe(-70, 30);
      expect(result.direction).toBe('left');
      expect(result.distance).toBe(70);
    });

    it('should use absolute values for comparison', () => {
      const result = detectSwipe(60, -40);
      expect(result.direction).toBe('right');
      expect(result.distance).toBe(60);
    });

    it('should use absolute values for negative deltas', () => {
      const result = detectSwipe(-80, -20);
      expect(result.direction).toBe('left');
      expect(result.distance).toBe(80);
    });
  });

  describe('large swipe distances', () => {
    it('should detect left swipe for large negative deltaX', () => {
      const result = detectSwipe(-200, 10);
      expect(result.direction).toBe('left');
      expect(result.distance).toBe(200);
    });

    it('should detect right swipe for large positive deltaX', () => {
      const result = detectSwipe(150, 5);
      expect(result.direction).toBe('right');
      expect(result.distance).toBe(150);
    });
  });
});

describe('detectPullRefresh', () => {
  describe('threshold behavior (60px)', () => {
    it('should not trigger for deltaY exactly 60px when at top', () => {
      const result = detectPullRefresh(60, true);
      expect(result.triggered).toBe(false);
    });

    it('should trigger for deltaY of 61px when at top', () => {
      const result = detectPullRefresh(61, true);
      expect(result.triggered).toBe(true);
      expect(result.distance).toBe(61);
    });

    it('should not trigger for deltaY below 60px when at top', () => {
      const result = detectPullRefresh(30, true);
      expect(result.triggered).toBe(false);
    });

    it('should not trigger for deltaY of 0', () => {
      const result = detectPullRefresh(0, true);
      expect(result.triggered).toBe(false);
    });
  });

  describe('scroll position requirement', () => {
    it('should not trigger when not at top, even if deltaY exceeds threshold', () => {
      const result = detectPullRefresh(100, false);
      expect(result.triggered).toBe(false);
    });

    it('should not trigger when not at top with exactly 61px pull', () => {
      const result = detectPullRefresh(61, false);
      expect(result.triggered).toBe(false);
    });
  });

  describe('negative deltaY (upward)', () => {
    it('should not trigger for upward pull (negative deltaY)', () => {
      const result = detectPullRefresh(-80, true);
      expect(result.triggered).toBe(false);
    });

    it('should return distance of 0 for negative deltaY', () => {
      const result = detectPullRefresh(-50, true);
      expect(result.distance).toBe(0);
    });
  });

  describe('large pull distances', () => {
    it('should trigger for large pull at top', () => {
      const result = detectPullRefresh(200, true);
      expect(result.triggered).toBe(true);
      expect(result.distance).toBe(200);
    });
  });
});
