/**
 * ListenPlayer — the read-aloud UI.
 *
 * Two surfaces over one session (see services/listen-mode.ts):
 *   1. a floating bar, visible while the full-screen view is closed
 *   2. a reader-style full-screen view: the current paragraph centred and
 *      enlarged, the neighbouring paragraphs dimmed
 *
 * Mounted once on `document.body` and never torn down by navigation — that is
 * the whole point of the feature, and it is also why it cannot live inside
 * `#app` (the app shell rebuilds its content on every route change).
 *
 * Rendering is incremental: the DOM is built once and every snapshot update
 * only writes the fields that changed. Re-rendering the whole subtree four
 * times a second would drop focus and restart CSS transitions.
 */

import { t, getLanguage, onLanguageChange } from '../../services/i18n.js';
import { getCurrentRoute, onRouteChange } from '../../router.js';
import { getCurrentArticleId } from '../../state.js';
import {
  subscribeListen,
  startListening,
  toggleListenPlayback,
  nextListenArticle,
  prevListenArticle,
  jumpToListenIndex,
  seekListenToRatio,
  cycleListenRate,
  setListenExpanded,
  stopListening,
  isListeningTo,
  getListenSnapshot,
  type ListenItem,
  type ListenSnapshot,
} from '../../services/listen-mode.js';
import { collectLeafBlocks } from '../../services/tts-utils.js';
import {
  iconPlay,
  iconPause,
  iconSkipBack,
  iconSkipForward,
  iconChevron,
  iconClose,
  iconList,
} from '../../icons.js';

/** Class applied to the paragraph currently being spoken. */
const HIGHLIGHT_CLASS = 'read-aloud-active-paragraph';

/** Root element id — also the idempotency guard for installListenPlayer(). */
const ROOT_ID = 'listen-player-root';
const VIEW_ID = 'listen-player-view';
const QUEUE_ID = 'listen-player-queue';

/** Ignore auto-scroll for this long after the user scrolled themselves. */
const USER_SCROLL_GRACE_MS = 3000;

interface Refs {
  root: HTMLElement;
  bar: HTMLElement;
  barTitle: HTMLElement;
  barMeta: HTMLElement;
  barFill: HTMLElement;
  barToggle: HTMLButtonElement;
  barExpand: HTMLButtonElement;
  view: HTMLElement;
  kicker: HTMLElement;
  viewTitle: HTMLElement;
  source: HTMLElement;
  queueToggle: HTMLButtonElement;
  paraPrev: HTMLElement;
  paraCurrent: HTMLElement;
  paraNext: HTMLElement;
  scrub: HTMLElement;
  scrubFill: HTMLElement;
  counter: HTMLElement;
  bigToggle: HTMLButtonElement;
  barRate: HTMLButtonElement;
  viewRate: HTMLButtonElement;
  queue: HTMLElement;
  queueList: HTMLElement;
  status: HTMLElement;
  viewChevron: HTMLElement;
  barChevron: HTMLElement;
}

class ListenPlayer {
  private refs: Refs | null = null;
  private unsubscribe: (() => void) | null = null;
  private unsubscribeLanguage: (() => void) | null = null;
  private unsubscribeRoute: (() => void) | null = null;

  /** Paragraph currently carrying the highlight (may be detached). */
  private highlighted: HTMLElement | null = null;

  /** Focus to restore when the view closes. */
  private returnFocus: HTMLElement | null = null;
  private wasExpanded = false;

  private queueKey = '';
  private queueIndex = -2;
  private queueOpen = false;
  private lastBlockKey = '';

  /** Paragraph nodes of the article body, cached per body element. */
  private blockCache: { body: HTMLElement; blocks: HTMLElement[] } | null = null;

  private dragging = false;
  private previewRatio = 0;
  private progress = 0;

  private lastUserScrollAt = 0;

  // -------------------------------------------------------------- lifecycle

  install(): void {
    if (this.refs || document.getElementById(ROOT_ID)) return;

    this.refs = this.build();
    document.body.appendChild(this.refs.root);
    // Labels need `this.refs` to exist, so they are applied after the
    // assignment above rather than inside build().
    this.applyStaticLabels();

    document.addEventListener('scroll', this.handleScroll, { capture: true, passive: true });
    document.addEventListener('keydown', this.handleKeydown);

    this.unsubscribe = subscribeListen((snapshot) => this.render(snapshot));
    this.unsubscribeLanguage = onLanguageChange(() => {
      this.applyStaticLabels();
      this.render(getListenSnapshot());
    });
    // Re-attach the paragraph highlight when the article view comes back.
    // The player itself must survive route changes — only the DOM it points
    // into does not.
    this.unsubscribeRoute = onRouteChange(() => this.render(getListenSnapshot()));
  }

  destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.unsubscribeLanguage?.();
    this.unsubscribeLanguage = null;
    this.unsubscribeRoute?.();
    this.unsubscribeRoute = null;

    document.removeEventListener('scroll', this.handleScroll, { capture: true });
    document.removeEventListener('keydown', this.handleKeydown);

    this.refs?.root.remove();
    this.refs = null;
    this.clearHighlight();
  }

  /** Start listening to an article (or bring the view back up for it). */
  async open(article: ListenItem): Promise<void> {
    this.install();

    if (isListeningTo(article.id)) {
      setListenExpanded(true);
      return;
    }

    await startListening(article);
  }

  /** Re-render from the current snapshot (used after the article DOM changes). */
  refresh(): void {
    if (this.refs) this.render(getListenSnapshot());
  }

  // ------------------------------------------------------------------- DOM

  private build(): Refs {
    const root = document.createElement('div');
    root.id = ROOT_ID;
    root.className = 'listen-player';
    root.dataset.status = 'idle';
    root.hidden = true;

    root.innerHTML = `
      <div class="listen-player__bar" role="region" aria-label="${escapeAttr(t('read_aloud_player_label'))}">
        <button class="listen-player__open" type="button" data-act="expand">
          <span class="listen-player__title"></span>
          <span class="listen-player__meta"></span>
        </button>
        <button class="listen-player__btn listen-player__btn--primary" type="button" data-act="toggle"></button>
        <button class="listen-player__btn" type="button" data-act="next"></button>
        <button class="listen-player__btn listen-player__rate" type="button" data-act="rate">1×</button>
        <button class="listen-player__btn" type="button" data-act="expand">
          <span class="listen-player__chev is-up">${iconChevron(18)}</span>
        </button>
        <span class="listen-player__bar-track" aria-hidden="true">
          <span class="listen-player__bar-fill"></span>
        </span>
      </div>

      <section class="listen-player__view" id="${VIEW_ID}" role="dialog" aria-modal="true"
               aria-labelledby="listen-player-title" tabindex="-1" hidden>
        <header class="listen-player__header">
          <button class="listen-player__btn" type="button" data-act="collapse">
            <span class="listen-player__chev is-down">${iconChevron(18)}</span>
          </button>
          <div class="listen-player__heading">
            <span class="listen-player__kicker"></span>
            <h2 class="listen-player__view-title" id="listen-player-title"></h2>
            <span class="listen-player__source"></span>
          </div>
          <button class="listen-player__btn" type="button" data-act="queue"
                  aria-controls="${QUEUE_ID}" aria-expanded="false">${iconList(18)}</button>
          <button class="listen-player__btn" type="button" data-act="stop">${iconClose(18)}</button>
        </header>

        <div class="listen-player__reader">
          <p class="listen-player__para listen-player__para--prev"></p>
          <p class="listen-player__para listen-player__para--current"></p>
          <p class="listen-player__para listen-player__para--next"></p>
        </div>

        <div class="listen-player__queue" id="${QUEUE_ID}" hidden>
          <p class="listen-player__queue-hint"></p>
          <div class="listen-player__queue-list"></div>
        </div>

        <div class="listen-player__scrub" role="slider" tabindex="0"
             aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
          <span class="listen-player__scrub-track">
            <span class="listen-player__scrub-fill"></span>
          </span>
        </div>

        <div class="listen-player__counter"></div>

        <div class="listen-player__controls">
          <button class="listen-player__btn" type="button" data-act="prev">${iconSkipBack(20)}</button>
          <button class="listen-player__btn listen-player__btn--primary listen-player__btn--lg"
                  type="button" data-act="toggle"></button>
          <button class="listen-player__btn" type="button" data-act="next">${iconSkipForward(20)}</button>
          <button class="listen-player__btn listen-player__rate" type="button" data-act="rate">1×</button>
        </div>

        <div class="listen-player__status" role="status" aria-live="polite"></div>
      </section>
    `;

    const q = <T extends HTMLElement>(selector: string): T => {
      const el = root.querySelector(selector);
      if (!el) throw new Error(`[ListenPlayer] missing ${selector}`);
      return el as T;
    };

    const refs: Refs = {
      root,
      bar: q('.listen-player__bar'),
      barTitle: q('.listen-player__bar .listen-player__title'),
      barMeta: q('.listen-player__bar .listen-player__meta'),
      barFill: q('.listen-player__bar-fill'),
      barToggle: q('.listen-player__bar .listen-player__btn--primary'),
      barExpand: q('.listen-player__bar .listen-player__open'),
      view: q('.listen-player__view'),
      kicker: q('.listen-player__kicker'),
      viewTitle: q('.listen-player__view-title'),
      source: q('.listen-player__source'),
      queueToggle: q('[data-act="queue"]'),
      paraPrev: q('.listen-player__para--prev'),
      paraCurrent: q('.listen-player__para--current'),
      paraNext: q('.listen-player__para--next'),
      scrub: q('.listen-player__scrub'),
      scrubFill: q('.listen-player__scrub-fill'),
      counter: q('.listen-player__counter'),
      bigToggle: q('.listen-player__controls .listen-player__btn--primary'),
      barRate: q('.listen-player__bar .listen-player__rate'),
      viewRate: q('.listen-player__controls .listen-player__rate'),
      queue: q('.listen-player__queue'),
      queueList: q('.listen-player__queue-list'),
      status: q('.listen-player__status'),
      viewChevron: q('.listen-player__view .listen-player__chev'),
      barChevron: q('.listen-player__bar .listen-player__chev'),
    };

    root.addEventListener('click', (event) => this.handleClick(event));
    this.bindScrub(refs);

    return refs;
  }

  /** Every label that is static for a given language. */
  private applyStaticLabels(): void {
    const refs = this.refs;
    if (!refs) return;

    refs.bar.setAttribute('aria-label', t('read_aloud_player_label'));
    refs.barExpand.setAttribute('aria-label', t('listen_expand'));
    refs.view.setAttribute('aria-label', t('read_aloud_player_label'));

    for (const button of Array.from(refs.root.querySelectorAll<HTMLButtonElement>('[data-act]'))) {
      const act = button.dataset.act;
      const label =
        act === 'toggle'
          ? this.snapshotPlaying
            ? t('pause')
            : t('play')
          : act === 'next'
            ? t('listen_next_article')
            : act === 'prev'
              ? t('listen_prev_article')
              : act === 'expand'
                ? t('listen_expand')
                : act === 'collapse'
                  ? t('listen_collapse')
                  : act === 'queue'
                    ? t('listen_queue')
                    : act === 'stop'
                      ? t('listen_stop')
                      : act === 'rate'
                        ? t('listen_speed')
                        : null;
      if (label) button.setAttribute('aria-label', label);
    }

    refs.barChevron.setAttribute('aria-hidden', 'true');
    refs.viewChevron.setAttribute('aria-hidden', 'true');
    refs.queueToggle.setAttribute('aria-expanded', this.queueOpen ? 'true' : 'false');
    refs.scrub.setAttribute('aria-label', t('listen_seek'));
    refs.queue.querySelector('.listen-player__queue-hint')!.textContent = t('listen_queue_hint');
    refs.queueToggle.title = t('listen_queue');

    // Force the data-driven labels to refresh on the next publish.
    this.queueKey = '';
    this.lastBlockKey = '';
  }

  private snapshotPlaying = false;

  // ---------------------------------------------------------------- events

  private handleClick(event: MouseEvent): void {
    const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-act]');
    if (!target) return;

    const queueIndex = target.dataset.queueIndex;

    switch (target.dataset.act) {
      case 'toggle':
        toggleListenPlayback();
        break;
      case 'next':
        nextListenArticle();
        break;
      case 'prev':
        prevListenArticle();
        break;
      case 'rate':
        cycleListenRate();
        break;
      case 'expand':
        setListenExpanded(true);
        break;
      case 'collapse':
        setListenExpanded(false);
        break;
      case 'stop':
        stopListening();
        break;
      case 'queue':
        this.setQueueOpen(!this.queueOpen);
        break;
      case 'queue-item':
        if (queueIndex !== undefined) {
          jumpToListenIndex(Number(queueIndex));
          this.setQueueOpen(false);
        }
        break;
      default:
        break;
    }
  }

  private setQueueOpen(open: boolean): void {
    this.queueOpen = open;
    if (!this.refs) return;
    this.refs.queue.hidden = !open;
    this.refs.queueToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {
      this.refs.queueList
        .querySelector<HTMLElement>('[aria-current="true"]')
        ?.scrollIntoView({ block: 'nearest' });
    }
  }

  private bindScrub(refs: Refs): void {
    const ratioFrom = (event: PointerEvent): number => {
      const rect = refs.scrub.getBoundingClientRect();
      if (rect.width === 0) return 0;
      return Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    };

    refs.scrub.addEventListener('pointerdown', (event) => {
      this.dragging = true;
      this.previewRatio = ratioFrom(event);
      refs.scrub.setPointerCapture?.(event.pointerId);
      this.renderScrub();
    });

    refs.scrub.addEventListener('pointermove', (event) => {
      if (!this.dragging) return;
      this.previewRatio = ratioFrom(event);
      this.renderScrub();
    });

    const finish = (event: PointerEvent): void => {
      if (!this.dragging) return;
      this.dragging = false;
      this.previewRatio = ratioFrom(event);
      // One seek per gesture: seeking on every pointermove would abort and
      // re-synthesize the target segment dozens of times per drag.
      seekListenToRatio(this.previewRatio);
      this.renderScrub();
    };

    refs.scrub.addEventListener('pointerup', finish);
    refs.scrub.addEventListener('pointercancel', finish);

    refs.scrub.addEventListener('keydown', (event) => {
      const step = 0.05;
      let next: number | null = null;

      switch (event.key) {
        case 'ArrowRight':
        case 'ArrowUp':
          next = this.progress + step;
          break;
        case 'ArrowLeft':
        case 'ArrowDown':
          next = this.progress - step;
          break;
        case 'PageUp':
          next = this.progress + step * 2;
          break;
        case 'PageDown':
          next = this.progress - step * 2;
          break;
        case 'Home':
          next = 0;
          break;
        case 'End':
          next = 1;
          break;
        default:
          return;
      }

      event.preventDefault();
      seekListenToRatio(Math.min(1, Math.max(0, next)));
    });
  }

  private handleKeydown = (event: KeyboardEvent): void => {
    const refs = this.refs;
    if (!refs || refs.view.hidden) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      setListenExpanded(false);
      return;
    }

    if (event.key === 'Tab') {
      this.trapFocus(event);
    }
  };

  /** Keep Tab inside the open view — it is declared `aria-modal`. */
  private trapFocus(event: KeyboardEvent): void {
    const refs = this.refs;
    if (!refs) return;

    const focusable = Array.from(
      refs.view.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    ).filter((el) => el.getClientRects().length > 0);

    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;

    if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    } else if (event.shiftKey && (active === first || active === refs.view)) {
      event.preventDefault();
      last.focus();
    }
  }

  private handleScroll = (): void => {
    this.lastUserScrollAt = Date.now();
  };

  // ---------------------------------------------------------------- render

  private render(snapshot: ListenSnapshot): void {
    const refs = this.refs;
    if (!refs) return;

    const active = snapshot.item !== null;
    this.snapshotPlaying = snapshot.status === 'playing';
    this.progress = snapshot.progress;

    refs.root.hidden = !active;
    refs.root.dataset.status = snapshot.status;
    document.body.classList.toggle('listen-active', active);

    if (!active) {
      // Focus must not be dropped on the floor when the session ends while
      // the view is open — the focused control is inside the hidden panel.
      const shouldRestore = this.wasExpanded;
      refs.bar.hidden = true;
      refs.view.hidden = true;
      this.wasExpanded = false;
      this.setQueueOpen(false);
      this.clearHighlight();
      this.restoreFocusIfNeeded(shouldRestore);
      return;
    }

    refs.bar.hidden = snapshot.expanded;
    refs.view.hidden = !snapshot.expanded;
    this.syncFocus(snapshot.expanded);

    // Bar
    refs.barTitle.textContent = snapshot.item?.title ?? '';
    refs.barMeta.textContent = this.describeStatus(snapshot);
    refs.barFill.style.width = `${(snapshot.progress * 100).toFixed(2)}%`;
    refs.barToggle.innerHTML = this.snapshotPlaying ? iconPause(20) : iconPlay(20);
    refs.barToggle.setAttribute('aria-label', this.snapshotPlaying ? t('pause') : t('play'));
    refs.bar.classList.toggle('is-loading', snapshot.status === 'loading');

    // Header
    refs.viewTitle.textContent = snapshot.item?.title ?? '';
    refs.source.textContent = this.describeSource(snapshot);
    refs.kicker.textContent = this.describeKicker(snapshot);

    // Reader
    const index = snapshot.blockIndex;
    const blockKey = `${snapshot.item?.id ?? ''}:${index}:${snapshot.blocks.length}:${getLanguage()}`;
    if (blockKey !== this.lastBlockKey) {
      this.lastBlockKey = blockKey;
      refs.paraPrev.textContent = snapshot.blocks[index - 1] ?? '';
      refs.paraCurrent.textContent = snapshot.blocks[index] ?? '';
      refs.paraNext.textContent = snapshot.blocks[index + 1] ?? '';
      refs.paraPrev.hidden = !refs.paraPrev.textContent;
      refs.paraNext.hidden = !refs.paraNext.textContent;
    }

    // Transport
    refs.bigToggle.innerHTML = this.snapshotPlaying ? iconPause(24) : iconPlay(24);
    refs.bigToggle.setAttribute('aria-label', this.snapshotPlaying ? t('pause') : t('play'));

    const rateLabel = `${formatRate(snapshot.rate)}×`;
    refs.barRate.textContent = rateLabel;
    refs.viewRate.textContent = rateLabel;
    refs.barRate.setAttribute('aria-label', `${t('listen_speed')} ${rateLabel}`);
    refs.viewRate.setAttribute('aria-label', `${t('listen_speed')} ${rateLabel}`);

    refs.counter.textContent = `${Math.min(index + 1, Math.max(1, snapshot.blocks.length))} / ${
      snapshot.blocks.length
    }`;

    this.renderScrub();
    this.renderQueue(snapshot);
    this.syncHighlight(snapshot);
  }

  private renderScrub(): void {
    const refs = this.refs;
    if (!refs) return;

    const ratio = this.dragging ? this.previewRatio : this.progress;
    const percent = `${(Math.min(1, Math.max(0, ratio)) * 100).toFixed(2)}%`;
    refs.scrubFill.style.width = percent;
    refs.scrub.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
    refs.scrub.setAttribute(
      'aria-valuetext',
      `${Math.round(ratio * 100)}% · ${refs.counter.textContent ?? ''}`
    );
  }

  private describeStatus(snapshot: ListenSnapshot): string {
    if (snapshot.errorKey) return t(snapshot.errorKey);
    if (snapshot.status === 'loading') return t('listen_loading');
    if (snapshot.atQueueEnd) return t('listen_queue_end');
    if (snapshot.finished && snapshot.status === 'idle') return t('listen_finished');
    const state = snapshot.status === 'playing' ? t('listen_now_reading') : t('listen_paused');
    return `${state} · ${this.positionLabel(snapshot)}`;
  }

  private describeKicker(snapshot: ListenSnapshot): string {
    if (snapshot.errorKey) return t(snapshot.errorKey);
    if (snapshot.status === 'loading') return t('listen_loading');
    if (snapshot.atQueueEnd) return t('listen_queue_end');
    if (snapshot.finished && snapshot.status === 'idle') return t('listen_finished');
    return snapshot.status === 'playing' ? t('listen_now_reading') : t('listen_paused');
  }

  private describeSource(snapshot: ListenSnapshot): string {
    const parts = [snapshot.item?.author ?? '', formatDate(snapshot.item?.publishedAt ?? '')];
    return parts.filter(Boolean).join(' · ');
  }

  private positionLabel(snapshot: ListenSnapshot): string {
    const total = Math.max(1, snapshot.blocks.length);
    return `${Math.min(snapshot.blockIndex + 1, total)}/${total}`;
  }

  private renderQueue(snapshot: ListenSnapshot): void {
    const refs = this.refs;
    if (!refs) return;

    const key = `${snapshot.item?.id ?? ''}|${snapshot.queue.length}|${snapshot.listened.join(',')}|${getLanguage()}`;
    if (key === this.queueKey) {
      // Cheap path: only the "current" marker can change between ticks.
      if (this.queueIndex !== snapshot.index) {
        this.queueIndex = snapshot.index;
        refs.queueList.querySelectorAll<HTMLElement>('[data-queue-index]').forEach((el, i) => {
          el.setAttribute('aria-current', i === snapshot.index ? 'true' : 'false');
        });
      }
      return;
    }
    this.queueKey = key;
    this.queueIndex = snapshot.index;

    const listened = new Set(snapshot.listened);

    refs.queueList.innerHTML = snapshot.queue
      .map((item, index) => {
        const current = index === snapshot.index;
        const done = !current && listened.has(item.id);
        const badge = current
          ? `<span class="listen-player__badge is-current">${escapeHtml(t('listen_now_reading'))}</span>`
          : done
            ? `<span class="listen-player__badge">${escapeHtml(t('listen_finished'))}</span>`
            : '';
        return `
          <button class="listen-player__queue-item" type="button"
                  data-act="queue-item" data-queue-index="${index}"
                  aria-current="${current ? 'true' : 'false'}">
            <span class="listen-player__queue-index">${index + 1}</span>
            <span class="listen-player__queue-main">
              <span class="listen-player__queue-title">${escapeHtml(item.title)}</span>
              <span class="listen-player__queue-meta">
                <span>${escapeHtml(item.author || '')}</span>
                <span>${escapeHtml(formatDate(item.publishedAt))}</span>
                ${badge}
              </span>
            </span>
          </button>`;
      })
      .join('');
  }

  // ------------------------------------------------------------ focus / a11y

  private syncFocus(expanded: boolean): void {
    const refs = this.refs;
    if (!refs) return;

    if (expanded && !this.wasExpanded) {
      const active = document.activeElement;
      this.returnFocus = active instanceof HTMLElement ? active : null;
      // Focus the dialog itself so its accessible name is announced, without
      // stealing focus into a control the user did not ask for.
      refs.view.focus({ preventScroll: true });
    } else if (!expanded && this.wasExpanded) {
      this.restoreFocusIfNeeded(true);
    }

    this.wasExpanded = expanded;
  }

  private restoreFocusIfNeeded(restore: boolean): void {
    if (!restore) {
      this.returnFocus = null;
      return;
    }
    const target = this.returnFocus;
    this.returnFocus = null;

    if (target?.isConnected) {
      target.focus({ preventScroll: true });
      return;
    }
    const fallback = document.querySelector<HTMLElement>('.action-read-aloud');
    fallback?.focus({ preventScroll: true });
  }

  // ------------------------------------------------------------- highlight

  private syncHighlight(snapshot: ListenSnapshot): void {
    const route = getCurrentRoute();
    const onArticle = route.path === 'article-detail' && getCurrentArticleId() === snapshot.item?.id;

    if (!onArticle) {
      this.clearHighlight();
      return;
    }

    const body = document.querySelector<HTMLElement>('.article-view-body');
    if (!body) return;

    // Re-resolved every time: the node is detached and replaced on navigation.
    // The walk is cached per body element — this runs on every progress tick.
    if (this.blockCache?.body !== body) {
      this.blockCache = { body, blocks: collectLeafBlocks(body) };
    }
    const target = this.blockCache.blocks[snapshot.blockIndex];
    if (!target) return;

    if (target.classList.contains(HIGHLIGHT_CLASS)) {
      this.highlighted = target;
      return;
    }

    this.clearHighlight();
    target.classList.add(HIGHLIGHT_CLASS);
    this.highlighted = target;

    const rect = target.getBoundingClientRect();
    const visible = rect.top >= 0 && rect.bottom <= window.innerHeight;
    const userIsReading = Date.now() - this.lastUserScrollAt < USER_SCROLL_GRACE_MS;

    if (!visible && !userIsReading) {
      const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      const eink = document.documentElement.dataset.theme === 'eink';
      target.scrollIntoView({
        behavior: reduced || eink ? 'auto' : 'smooth',
        block: 'center',
      });
    }
  }

  private clearHighlight(): void {
    if (!this.highlighted) return;
    // The tracked node may already be detached (article navigated away), so
    // sweep the document too — but only when we know something was marked.
    this.highlighted.classList.remove(HIGHLIGHT_CLASS);
    this.highlighted = null;
    document
      .querySelectorAll(`.${HIGHLIGHT_CLASS}`)
      .forEach((el) => el.classList.remove(HIGHLIGHT_CLASS));
  }
}

// === helpers ===

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/'/g, '&#39;');
}

function formatRate(rate: number): string {
  return String(rate);
}

function formatDate(iso: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(getLanguage() === 'zh' ? 'zh-CN' : 'en-US', {
    month: 'short',
    day: 'numeric',
  });
}

let instance: ListenPlayer | null = null;

/**
 * Mount the floating player. Idempotent — safe to call on every app start.
 * Must run after login, never at module scope (it needs `document.body`).
 */
export function installListenPlayer(): void {
  if (!instance) instance = new ListenPlayer();
  instance.install();
}

/** Open the full-screen view, starting a session for `article` if needed. */
export async function openListenView(article?: ListenItem): Promise<void> {
  if (!instance) installListenPlayer();

  if (article) {
    await instance!.open(article);
    return;
  }

  if (getListenSnapshot().item) setListenExpanded(true);
}

/** Close the full-screen view. Playback continues. */
export function closeListenView(): void {
  setListenExpanded(false);
}

/**
 * Re-sync the on-page highlight. Called by ArticleView once its body is in
 * the DOM: while paused there is no tick, so the player would otherwise not
 * notice that the article it is reading has just been rendered.
 */
export function refreshListenHighlight(): void {
  if (instance) instance.refresh();
}
