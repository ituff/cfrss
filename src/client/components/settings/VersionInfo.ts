/**
 * VersionInfo — which Worker version is actually serving traffic, and when it
 * went live.
 *
 * Deliberately fetched from `GET /api/version` rather than read from the
 * bundle: the browser may be running a cached copy of the app, and the whole
 * point of this panel is to answer "is the server on the latest deploy?".
 *
 * The values come from Cloudflare's `version_metadata` binding, which is
 * absent under `wrangler dev` — so "unknown" is a normal state, not an error.
 */

import { t, getLanguage, onLanguageChange } from '../../services/i18n.js';
import { getServerVersion, type ServerVersion } from '../../services/api.js';

type LoadState = 'loading' | 'ready' | 'error';

export class VersionInfo {
  private element: HTMLElement;
  private unsubscribe: (() => void) | null = null;
  private state: LoadState = 'loading';
  private info: ServerVersion | null = null;
  private destroyed = false;

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'version-info';

    this.unsubscribe = onLanguageChange(() => this.render());
    this.render();
    void this.load();
  }

  getElement(): HTMLElement {
    return this.element;
  }

  destroy(): void {
    this.destroyed = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private async load(): Promise<void> {
    try {
      const info = await getServerVersion();
      if (this.destroyed) return;
      this.info = info;
      this.state = 'ready';
    } catch {
      if (this.destroyed) return;
      this.state = 'error';
    }
    this.render();
  }

  private render(): void {
    if (this.destroyed) return;

    this.element.replaceChildren();

    if (this.state === 'loading') {
      this.element.appendChild(this.hint(t('loading')));
      return;
    }

    if (this.state === 'error' || !this.info) {
      this.element.appendChild(this.hint(t('version_unavailable')));
      return;
    }

    const { version, tag, deployedAt } = this.info;

    const versionLabel = version
      ? tag
        ? `${tag} · ${version}`
        : version
      : t('version_unknown');

    this.element.appendChild(this.row(t('version_number'), versionLabel, true));
    this.element.appendChild(this.row(t('version_deployed_at'), this.formatDate(deployedAt)));
  }

  private row(key: string, value: string, mono = false): HTMLElement {
    const rowEl = document.createElement('div');
    rowEl.className = 'version-info__row';

    const keyEl = document.createElement('span');
    keyEl.className = 'version-info__key';
    keyEl.textContent = key;

    const valueEl = document.createElement('span');
    valueEl.className = mono
      ? 'version-info__value version-info__value--mono'
      : 'version-info__value';
    valueEl.textContent = value;

    rowEl.appendChild(keyEl);
    rowEl.appendChild(valueEl);
    return rowEl;
  }

  private hint(text: string): HTMLElement {
    const hint = document.createElement('p');
    hint.className = 'version-info__hint';
    hint.textContent = text;
    return hint;
  }

  /** Render the deploy time in the interface language. */
  private formatDate(iso: string | null): string {
    if (!iso) return t('version_unknown');

    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return t('version_unknown');

    return date.toLocaleString(getLanguage() === 'zh' ? 'zh-CN' : 'en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
}
