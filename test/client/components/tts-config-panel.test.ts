/**
 * TTSConfigPanel — unit tests.
 * The Workers test pool has no DOM, so a minimal DOM stub is installed
 * before importing the component (same approach as settings-dropdowns.test.ts).
 * Covers: config load + masked token hint, URL validation, save flow,
 * and the connection test flow.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// --- Minimal DOM stub ---------------------------------------------------

class StubEl {
  tagName: string;
  className = '';
  id = '';
  type = '';
  value = '';
  textContent = '';
  htmlFor = '';
  label = '';
  disabled = false;
  autocomplete = '';
  /** Minimal stand-in for CSSStyleDeclaration — components set inline styles on buttons */
  style: Record<string, string> = {};
  children: StubEl[] = [];
  attrs: Record<string, string> = {};
  listeners: Record<string, ((e: unknown) => void)[]> = {};

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
  }

  set innerHTML(v: string) {
    this._innerHTML = v;
    if (v === '') this.children = [];
  }
  get innerHTML(): string {
    return this._innerHTML ?? '';
  }
  private _innerHTML = '';

  appendChild(child: StubEl): StubEl {
    this.children.push(child);
    child.parent = this;
    return child;
  }
  remove(): void {
    this.parent?.children.splice(this.parent.children.indexOf(this), 1);
  }
  parent: StubEl | null = null;

  setAttribute(k: string, v: string): void {
    this.attrs[k] = v;
    if (k === 'id') this.id = v;
  }
  getAttribute(k: string): string | null {
    return this.attrs[k] ?? null;
  }
  addEventListener(type: string, fn: (e: unknown) => void): void {
    (this.listeners[type] ??= []).push(fn);
  }
  dispatch(type: string, event: unknown = {}): void {
    for (const fn of this.listeners[type] ?? []) fn(event);
  }
  find(pred: (el: StubEl) => boolean): StubEl | null {
    if (pred(this)) return this;
    for (const c of this.children) {
      const hit = c.find(pred);
      if (hit) return hit;
    }
    return null;
  }
  findAll(pred: (el: StubEl) => boolean): StubEl[] {
    const out: StubEl[] = [];
    if (pred(this)) out.push(this);
    for (const c of this.children) out.push(...c.findAll(pred));
    return out;
  }
}

let fetchCalls: Array<{ url: string; method: string; body: unknown }> = [];
let ttsConfig: Record<string, unknown> = {};

const doc = {
  createElement: (tag: string) => new StubEl(tag),
  querySelector: () => null,
};

function installDom(): void {
  const stubFetch = (url: string, init?: { method?: string; body?: string }) => {
    const method = init?.method ?? 'GET';
    fetchCalls.push({ url, method, body: init?.body ? JSON.parse(init.body) : undefined });
    if (url === '/api/config/tts' && method === 'GET') {
      return Promise.resolve({ ok: true, json: async () => ttsConfig });
    }
    return Promise.resolve({ ok: true, json: async () => ({ success: true }) });
  };

  (globalThis as unknown as { document: typeof doc }).document = doc;
  (globalThis as unknown as { window: unknown }).window = { fetch: stubFetch };
  (globalThis as unknown as { fetch: typeof stubFetch }).fetch = stubFetch;
  (globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  };
}

/** Import the panel with the UI language pinned to Chinese (matches assertions). */
async function loadPanel(): Promise<typeof import('../../../src/client/components/settings/TTSConfigPanel')['TTSConfigPanel']> {
  const i18n = await import('../../../src/client/services/i18n');
  i18n.initI18n('zh');
  const mod = await import('../../../src/client/components/settings/TTSConfigPanel');
  return mod.TTSConfigPanel;
}

async function flush(): Promise<void> {
  // The panel loads its config asynchronously in the constructor
  // (fetch → res.json() → render); wait a macrotask for it to settle.
  await new Promise((resolve) => setTimeout(resolve, 5));
}

describe('TTSConfigPanel', () => {
  beforeEach(() => {
    vi.resetModules();
    fetchCalls = [];
    ttsConfig = { url: 'https://tts.example.com', hasToken: true, token: '****abcd' };
    installDom();
  });

  it('loads the stored config and renders URL + masked token hint', async () => {
    const TTSConfigPanel = await loadPanel();
    const el = new TTSConfigPanel().getElement() as unknown as StubEl;
    await flush();

    const labels = el.findAll((e) => e.className.includes('tts-config-panel__label'))
      .map((l) => l.textContent);
    expect(labels).toContain('服务地址');
    expect(labels).toContain('API KEY');

    const urlInput = el.findAll((e) => e.type === 'url')[0];
    expect(urlInput.value).toBe('https://tts.example.com');

    // token input stays empty; the hint indicates a saved key
    const tokenInput = el.findAll((e) => e.type === 'password')[0];
    expect(tokenInput.value).toBe('');
    // Several hints exist now (voice + token) — pick the token one.
    const hints = el.findAll((e) => e.className.includes('tts-config-panel__hint'))
      .map((h) => h.textContent);
    expect(hints.some((h) => h.includes('已保存'))).toBe(true);
  });

  it('rejects a URL without protocol and does not call the API', async () => {
    const TTSConfigPanel = await loadPanel();
    const panel = new TTSConfigPanel();
    const el = panel.getElement() as unknown as StubEl;
    await flush();
    fetchCalls = [];

    const urlInput = el.findAll((e) => e.type === 'url')[0];
    urlInput.value = 'tts.example.com';
    urlInput.dispatch('input', { target: { value: 'tts.example.com' } });

    const form = el.find((e) => e.tagName === 'FORM')!;
    form.dispatch('submit', { preventDefault: () => undefined });
    await flush();

    const errorEl = el.find((e) => e.className.includes('tts-config-panel__error'));
    expect(errorEl).not.toBeNull();
    expect(errorEl!.textContent).toContain('http');
    expect(fetchCalls.find((c) => c.method === 'PUT')).toBeUndefined();
  });

  it('saves a valid url plus a new token via PUT', async () => {
    const TTSConfigPanel = await loadPanel();
    const panel = new TTSConfigPanel();
    const el = panel.getElement() as unknown as StubEl;
    await flush();
    fetchCalls = [];

    const inputs = el.findAll((e) => e.type === 'url' || e.type === 'password');
    const urlInput = inputs.find((e) => e.type === 'url')!;
    const tokenInput = inputs.find((e) => e.type === 'password')!;
    urlInput.dispatch('input', { target: { value: 'https://tts2.example.com' } });
    tokenInput.dispatch('input', { target: { value: 'tok-new-123456' } });

    const form = el.find((e) => e.tagName === 'FORM')!;
    form.dispatch('submit', { preventDefault: () => undefined });
    await flush();

    const put = fetchCalls.find((c) => c.method === 'PUT');
    expect(put).toBeDefined();
    expect(put!.url).toBe('/api/config/tts');
    expect(put!.body).toEqual({
      url: 'https://tts2.example.com',
      token: 'tok-new-123456',
      voice: 'auto',
    });

    // success status rendered and token input reset
    const successEl = el.find((e) => e.className.includes('tts-config-panel__success'));
    expect(successEl?.textContent).toContain('已保存');
    expect(tokenInput.value).toBe('');
  });

  it('test button calls the test endpoint and renders a localized result', async () => {
    const TTSConfigPanel = await loadPanel();
    const panel = new TTSConfigPanel();
    const el = panel.getElement() as unknown as StubEl;
    await flush();
    fetchCalls = [];

    const testBtn = el.findAll((e) => e.tagName === 'BUTTON')
      .find((b) => b.textContent === '测试')!;
    testBtn.dispatch('click');
    await flush();

    const post = fetchCalls.find((c) => c.url === '/api/config/tts/test');
    expect(post).toBeDefined();
    const result = el.find((e) => e.className.includes('tts-config-panel__test-result'));
    expect(result?.textContent).toContain('语音服务连接成功');
  });

  it('renders a voice select with an auto option and grouped voices', async () => {
    const TTSConfigPanel = await loadPanel();
    const el = new TTSConfigPanel().getElement() as unknown as StubEl;
    await flush();

    const select = el.find((e) => e.tagName === 'SELECT' && e.id === 'settings-tts-voice');
    expect(select).not.toBeNull();

    // "Auto" is the first option and the default selection
    const options = select!.findAll((e) => e.tagName === 'OPTION');
    expect(options[0].value).toBe('auto');
    expect(options[0].textContent).toBe('自动识别（按语言）');
    expect(select!.value).toBe('auto');

    // Curated voices are grouped by language family
    const groups = select!.findAll((e) => e.tagName === 'OPTGROUP');
    const groupLabels = groups.map((g) => g.label);
    expect(groupLabels).toContain('普通话（大陆）');
    expect(groupLabels).toContain('英语');
    expect(groupLabels).toContain('粤语（中国香港）');

    // The Chinese group exposes multiple voices including Xiaoxiao
    const zhGroup = groups.find((g) => g.label === '普通话（大陆）')!;
    const zhIds = zhGroup.findAll((e) => e.tagName === 'OPTION').map((o) => o.value);
    expect(zhIds).toContain('zh-CN-XiaoxiaoNeural');
    expect(zhIds).toContain('zh-CN-YunxiNeural');
    expect(zhIds.length).toBeGreaterThan(3);
  });

  it('reflects a stored voice selection in the dropdown', async () => {
    ttsConfig = {
      url: 'https://tts.example.com',
      voice: 'zh-CN-YunxiNeural',
      hasToken: true,
      token: '****abcd',
    };
    const TTSConfigPanel = await loadPanel();
    const el = new TTSConfigPanel().getElement() as unknown as StubEl;
    await flush();

    const select = el.find((e) => e.tagName === 'SELECT' && e.id === 'settings-tts-voice');
    expect(select!.value).toBe('zh-CN-YunxiNeural');
  });

  it('persists a manually chosen voice on save', async () => {
    const TTSConfigPanel = await loadPanel();
    const panel = new TTSConfigPanel();
    const el = panel.getElement() as unknown as StubEl;
    await flush();
    fetchCalls = [];

    const select = el.find((e) => e.tagName === 'SELECT' && e.id === 'settings-tts-voice')!;
    select.dispatch('change', { target: { value: 'zh-CN-YunjianNeural' } });

    const form = el.find((e) => e.tagName === 'FORM')!;
    form.dispatch('submit', { preventDefault: () => undefined });
    await flush();

    const put = fetchCalls.find((c) => c.method === 'PUT');
    expect(put).toBeDefined();
    expect(put!.body).toMatchObject({
      url: 'https://tts.example.com',
      voice: 'zh-CN-YunjianNeural',
    });
  });

  it('treats a missing stored voice as auto', async () => {
    ttsConfig = { url: 'https://tts.example.com', hasToken: false, token: null };
    const TTSConfigPanel = await loadPanel();
    const el = new TTSConfigPanel().getElement() as unknown as StubEl;
    await flush();

    const select = el.find((e) => e.tagName === 'SELECT' && e.id === 'settings-tts-voice');
    expect(select!.value).toBe('auto');
  });

  it('switches the hint text when a manual voice is chosen', async () => {
    const TTSConfigPanel = await loadPanel();
    const el = new TTSConfigPanel().getElement() as unknown as StubEl;
    await flush();

    const hintText = () => el.findAll((e) => e.className.includes('tts-config-panel__hint'))
      .map((h) => h.textContent)
      .find((text) => text.includes('音色') || text.includes('全文'))!;

    expect(hintText()).toContain('自动识别');

    const select = el.find((e) => e.tagName === 'SELECT' && e.id === 'settings-tts-voice')!;
    select.dispatch('change', { target: { value: 'zh-CN-YunxiNeural' } });
    await flush();

    expect(hintText()).toContain('全文');
    expect(hintText()).not.toContain('自动识别');
  });
});
