/**
 * Touch gesture handling module.
 * Provides horizontal swipe detection for article navigation,
 * and pull-to-refresh for article list refreshing.
 *
 * Requirements: 1.3, 1.4, 1.5, 1.6
 */

// === Pure detection logic (testable without DOM) ===

export interface SwipeResult {
  direction: 'left' | 'right' | 'none';
  distance: number;
}

export interface PullResult {
  triggered: boolean;
  distance: number;
}

/**
 * Determine swipe direction from touch delta values.
 * A horizontal swipe is triggered when:
 *   - |deltaX| > 50px (threshold)
 *   - |deltaX| > |deltaY| (distinguishes from vertical scroll)
 */
export function detectSwipe(deltaX: number, deltaY: number): SwipeResult {
  const absDeltaX = Math.abs(deltaX);
  const absDeltaY = Math.abs(deltaY);

  // Must exceed 50px threshold and be primarily horizontal
  if (absDeltaX > 50 && absDeltaX > absDeltaY) {
    return {
      direction: deltaX < 0 ? 'left' : 'right',
      distance: absDeltaX,
    };
  }

  return { direction: 'none', distance: absDeltaX };
}

/**
 * Determine if a pull-to-refresh gesture was triggered.
 * Conditions:
 *   - The list is at scroll position 0 (atTop must be true)
 *   - deltaY > 60px (downward pull threshold)
 */
export function detectPullRefresh(deltaY: number, atTop: boolean): PullResult {
  if (atTop && deltaY > 60) {
    return { triggered: true, distance: deltaY };
  }
  return { triggered: false, distance: Math.max(0, deltaY) };
}

// === DOM-integrated gesture classes ===

export interface SwipeDetectorOptions {
  /** Element to listen for swipe gestures on */
  element: HTMLElement;
  /** Called when user swipes left (next article) */
  onSwipeLeft?: () => void;
  /** Called when user swipes right (previous article) */
  onSwipeRight?: () => void;
}

export class SwipeDetector {
  private element: HTMLElement;
  private onSwipeLeft: (() => void) | undefined;
  private onSwipeRight: (() => void) | undefined;
  private startX = 0;
  private startY = 0;
  private tracking = false;

  constructor(options: SwipeDetectorOptions) {
    this.element = options.element;
    this.onSwipeLeft = options.onSwipeLeft;
    this.onSwipeRight = options.onSwipeRight;

    this.handleTouchStart = this.handleTouchStart.bind(this);
    this.handleTouchMove = this.handleTouchMove.bind(this);
    this.handleTouchEnd = this.handleTouchEnd.bind(this);
  }

  /** Attach touch event listeners. */
  attach(): void {
    this.element.addEventListener('touchstart', this.handleTouchStart, { passive: true });
    this.element.addEventListener('touchmove', this.handleTouchMove, { passive: true });
    this.element.addEventListener('touchend', this.handleTouchEnd, { passive: true });
  }

  /** Detach touch event listeners. */
  detach(): void {
    this.element.removeEventListener('touchstart', this.handleTouchStart);
    this.element.removeEventListener('touchmove', this.handleTouchMove);
    this.element.removeEventListener('touchend', this.handleTouchEnd);
  }

  private handleTouchStart(e: TouchEvent): void {
    if (e.touches.length === 1) {
      this.startX = e.touches[0].clientX;
      this.startY = e.touches[0].clientY;
      this.tracking = true;
    }
  }

  private handleTouchMove(_e: TouchEvent): void {
    // We only track, no action needed during move for swipe detection
  }

  private handleTouchEnd(e: TouchEvent): void {
    if (!this.tracking) return;
    this.tracking = false;

    const endX = e.changedTouches[0].clientX;
    const endY = e.changedTouches[0].clientY;
    const deltaX = endX - this.startX;
    const deltaY = endY - this.startY;

    const result = detectSwipe(deltaX, deltaY);

    if (result.direction === 'left') {
      this.onSwipeLeft?.();
    } else if (result.direction === 'right') {
      this.onSwipeRight?.();
    }
  }
}

export interface PullToRefreshOptions {
  /** Scrollable element to detect pull-to-refresh on */
  element: HTMLElement;
  /** Called when pull-to-refresh is triggered */
  onRefresh: () => Promise<void> | void;
  /** Max time (ms) to wait for refresh to complete before hiding indicator. Default: 2000 */
  maxRefreshTime?: number;
}

export class PullToRefreshDetector {
  private element: HTMLElement;
  private onRefresh: () => Promise<void> | void;
  private maxRefreshTime: number;
  private startY = 0;
  private currentY = 0;
  private tracking = false;
  private refreshing = false;
  private indicator: HTMLElement | null = null;

  constructor(options: PullToRefreshOptions) {
    this.element = options.element;
    this.onRefresh = options.onRefresh;
    this.maxRefreshTime = options.maxRefreshTime ?? 2000;

    this.handleTouchStart = this.handleTouchStart.bind(this);
    this.handleTouchMove = this.handleTouchMove.bind(this);
    this.handleTouchEnd = this.handleTouchEnd.bind(this);
  }

  /** Attach touch event listeners. */
  attach(): void {
    this.element.addEventListener('touchstart', this.handleTouchStart, { passive: true });
    this.element.addEventListener('touchmove', this.handleTouchMove, { passive: false });
    this.element.addEventListener('touchend', this.handleTouchEnd, { passive: true });
  }

  /** Detach touch event listeners and clean up. */
  detach(): void {
    this.element.removeEventListener('touchstart', this.handleTouchStart);
    this.element.removeEventListener('touchmove', this.handleTouchMove);
    this.element.removeEventListener('touchend', this.handleTouchEnd);
    this.hideIndicator();
  }

  private isAtTop(): boolean {
    return this.element.scrollTop <= 0;
  }

  private handleTouchStart(e: TouchEvent): void {
    if (this.refreshing) return;
    if (e.touches.length === 1 && this.isAtTop()) {
      this.startY = e.touches[0].clientY;
      this.currentY = this.startY;
      this.tracking = true;
    }
  }

  private handleTouchMove(e: TouchEvent): void {
    if (!this.tracking || this.refreshing) return;

    this.currentY = e.touches[0].clientY;
    const deltaY = this.currentY - this.startY;

    // Only track downward pulls when at top
    if (deltaY > 0 && this.isAtTop()) {
      this.showIndicator(deltaY);
      // Prevent default scrolling while pulling
      e.preventDefault();
    } else {
      this.tracking = false;
      this.hideIndicator();
    }
  }

  private handleTouchEnd(): void {
    if (!this.tracking || this.refreshing) return;
    this.tracking = false;

    const deltaY = this.currentY - this.startY;
    const result = detectPullRefresh(deltaY, true);

    if (result.triggered) {
      this.triggerRefresh();
    } else {
      this.hideIndicator();
    }
  }

  private async triggerRefresh(): Promise<void> {
    this.refreshing = true;
    this.updateIndicator('refreshing');

    // Set a max timeout to hide indicator
    const timeout = setTimeout(() => {
      this.refreshing = false;
      this.hideIndicator();
    }, this.maxRefreshTime);

    try {
      await this.onRefresh();
    } finally {
      clearTimeout(timeout);
      this.refreshing = false;
      this.hideIndicator();
    }
  }

  private showIndicator(distance: number): void {
    if (!this.indicator) {
      this.indicator = document.createElement('div');
      this.indicator.className = 'pull-refresh-indicator';
      this.indicator.setAttribute('aria-live', 'polite');
      this.element.parentElement?.insertBefore(this.indicator, this.element);
    }
    const progress = Math.min(distance / 60, 1);
    this.indicator.style.height = `${Math.min(distance * 0.5, 40)}px`;
    this.indicator.style.opacity = `${progress}`;
    this.indicator.textContent = distance > 60 ? '↓ Release to refresh' : '↓ Pull to refresh';
  }

  private updateIndicator(state: 'refreshing'): void {
    if (this.indicator) {
      this.indicator.textContent = state === 'refreshing' ? '⟳ Refreshing...' : '';
      this.indicator.style.opacity = '1';
      this.indicator.style.height = '40px';
    }
  }

  private hideIndicator(): void {
    if (this.indicator) {
      this.indicator.remove();
      this.indicator = null;
    }
  }
}

// === Article navigation integration ===

export interface ArticleNavigatorOptions {
  /** Element to attach swipe detection to */
  element: HTMLElement;
  /** Get the list of article IDs in current view order */
  getArticleIds: () => string[];
  /** Get the currently displayed article ID */
  getCurrentArticleId: () => string | null;
  /** Navigate to an article by ID */
  navigateToArticle: (id: string) => void;
  /** Show a boundary message (e.g., "No more articles") */
  showBoundaryMessage?: (direction: 'start' | 'end') => void;
}

/**
 * High-level article navigation via swipe gestures.
 * Swipe left → next article
 * Swipe right → previous article
 * At boundaries, shows a brief "no more articles" message.
 */
export class ArticleSwipeNavigator {
  private swipeDetector: SwipeDetector;
  private getArticleIds: () => string[];
  private getCurrentArticleId: () => string | null;
  private navigateToArticle: (id: string) => void;
  private showBoundaryMessage?: (direction: 'start' | 'end') => void;

  constructor(options: ArticleNavigatorOptions) {
    this.getArticleIds = options.getArticleIds;
    this.getCurrentArticleId = options.getCurrentArticleId;
    this.navigateToArticle = options.navigateToArticle;
    this.showBoundaryMessage = options.showBoundaryMessage;

    this.swipeDetector = new SwipeDetector({
      element: options.element,
      onSwipeLeft: () => this.navigateNext(),
      onSwipeRight: () => this.navigatePrev(),
    });
  }

  attach(): void {
    this.swipeDetector.attach();
  }

  detach(): void {
    this.swipeDetector.detach();
  }

  private navigateNext(): void {
    const ids = this.getArticleIds();
    const currentId = this.getCurrentArticleId();
    if (!currentId || ids.length === 0) return;

    const currentIndex = ids.indexOf(currentId);
    if (currentIndex === -1) return;

    if (currentIndex < ids.length - 1) {
      this.navigateToArticle(ids[currentIndex + 1]);
    } else {
      // At the last article
      this.showBoundaryMessage?.('end');
    }
  }

  private navigatePrev(): void {
    const ids = this.getArticleIds();
    const currentId = this.getCurrentArticleId();
    if (!currentId || ids.length === 0) return;

    const currentIndex = ids.indexOf(currentId);
    if (currentIndex === -1) return;

    if (currentIndex > 0) {
      this.navigateToArticle(ids[currentIndex - 1]);
    } else {
      // At the first article
      this.showBoundaryMessage?.('start');
    }
  }
}
