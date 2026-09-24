/**
 * TTSConfigPanel — Read-aloud (TTS) service configuration panel.
 * Configures the base URL of the self-hosted read-aloud Worker
 * (upstream: https://github.com/yy4382/read-aloud) and its API key (TOKEN).
 * Save persists to Config_Store, test synthesizes a short sample
 * through the server-side proxy.
 */

import { t, onLanguageChange } from '../../services/i18n.js';
import {
  AUTO_VOICE,
  VOICE_OPTIONS,
  isAutoVoice,
  type VoiceOption,
} from '../../services/tts-utils.js';

/** Default endpoint placeholder — users configure their own read-aloud deployment. */
const DEFAULT_TTS_URL = 'https://tts.example.com';

interface TTSConfigData {
  url: string;
  voice?: string;
  hasToken: boolean;
  token: string | null;
}

interface TestResult {
  success: boolean;
  message: string;
}

export class TTSConfigPanel {
  private element: HTMLElement;
  private url = DEFAULT_TTS_URL;
  private voice = AUTO_VOICE;
  private token = '';
  private hasToken = false;
  private maskedToken = '';
  private loading = false;
  private saving = false;
  private testing = false;
  private error: string | null = null;
  private successMessage: string | null = null;
  private testResult: TestResult | null = null;
  private unsubLang: (() => void) | null = null;

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'tts-config-panel';
    this.unsubLang = onLanguageChange(() => this.render());
    this.loadConfig();
  }

  /**
   * Get the rendered DOM element.
   */
  getElement(): HTMLElement {
    return this.element;
  }

  /**
   * Destroy and clean up listeners.
   */
  destroy(): void {
    if (this.unsubLang) {
      this.unsubLang();
      this.unsubLang = null;
    }
  }

  /**
   * Load existing TTS config from server.
   */
  private async loadConfig(): Promise<void> {
    this.loading = true;
    this.render();

    try {
      const res = await fetch('/api/config/tts');
      if (res.ok) {
        const data = await res.json() as TTSConfigData;
        if (data.url) {
          this.url = data.url;
        }
        this.voice = isAutoVoice(data.voice) ? AUTO_VOICE : (data.voice as string);
        this.hasToken = data.hasToken === true;
        this.maskedToken = data.token || '';
      }
    } catch {
      this.error = t('network_error');
    } finally {
      this.loading = false;
      this.render();
    }
  }

  /**
   * Save the TTS config.
   */
  private async saveConfig(): Promise<void> {
    if (!this.validateForm()) return;

    this.saving = true;
    this.error = null;
    this.successMessage = null;
    this.render();

    try {
      const body: Record<string, string> = {
        url: this.url.trim(),
        voice: this.voice,
      };
      // Only include the token if the user entered a new one
      if (this.token.trim()) {
        body.token = this.token.trim();
      }

      const res = await fetch('/api/config/tts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const resBody = await res.json().catch(() => null) as { message?: string } | null;
        throw new Error(resBody?.message || `Error: ${res.status}`);
      }

      // Reset token input after successful save
      this.token = '';
      this.hasToken = true;
      this.maskedToken = '••••••••';
      this.successMessage = t('tts_save_success');
    } catch (err) {
      this.error = err instanceof Error ? err.message : t('network_error');
    } finally {
      this.saving = false;
      this.render();
    }
  }

  /**
   * Test the TTS service (synthesizes a short sample server-side).
   */
  private async testConnection(): Promise<void> {
    this.testing = true;
    this.testResult = null;
    this.error = null;
    this.render();

    try {
      const res = await fetch('/api/config/tts/test', { method: 'POST' });
      const body = await res.json() as { success: boolean; message?: string };
      this.testResult = {
        success: body.success,
        message: body.success ? t('tts_test_success') : body.message || t('connection_failed'),
      };
    } catch {
      this.testResult = { success: false, message: t('network_error') };
    }

    this.testing = false;
    this.render();
  }

  /**
   * Validate the form.
   */
  private validateForm(): boolean {
    const url = this.url.trim();
    if (!/^https?:\/\//.test(url)) {
      this.error = t('validation_error') + ': ' + t('error_tts_url_protocol');
      this.render();
      return false;
    }
    return true;
  }

  /**
   * Human-readable label for a voice option, localized where a
   * translation exists (voice *names* like "Xiaoxiao" stay as-is —
   * they are proper nouns, and users pick by locale first).
   */
  private voiceLabel(option: VoiceOption): string {
    const localeKeys: Record<string, string> = {
      'zh-CN': 'tts_voice_zh_cn',
      'zh-HK': 'tts_voice_zh_hk',
      'zh-TW': 'tts_voice_zh_tw',
    };
    const localeKey = localeKeys[option.lang];
    if (localeKey) {
      // Show the localized locale plus the bare voice name, e.g.
      // "普通话（大陆） · Xiaoxiao"
      const bare = option.id.replace(/^[a-z]{2}-[A-Z]{2}-/, '').replace(/Neural$/, '');
      return `${t(localeKey)} · ${bare}`;
    }
    return option.id.replace(/^[a-z]{2}-[A-Z]{2}-/, '').replace(/Neural$/, '') + ` (${option.lang})`;
  }

  /**
   * Build the voice <select>, grouping options by language family.
   */
  private buildVoiceField(): HTMLElement {
    const group = document.createElement('div');
    group.className = 'tts-config-panel__field';

    const label = document.createElement('label');
    label.className = 'tts-config-panel__label';
    label.textContent = t('field_tts_voice');
    label.setAttribute('for', 'settings-tts-voice');
    group.appendChild(label);

    const select = document.createElement('select');
    select.className = 'tts-config-panel__select';
    select.id = 'settings-tts-voice';
    select.disabled = this.saving;

    // "Auto" first — it is the default and the recommended setting.
    const autoOption = document.createElement('option');
    autoOption.value = AUTO_VOICE;
    autoOption.textContent = t('tts_voice_auto');
    select.appendChild(autoOption);

    // Group the curated voices: Chinese variants first (most used),
    // then English, then the rest.
    const groups: Array<{ labelKey: string; match: (o: VoiceOption) => boolean }> = [
      { labelKey: 'tts_voice_zh_cn', match: (o) => o.lang === 'zh-CN' },
      { labelKey: 'tts_voice_zh_hk', match: (o) => o.lang === 'zh-HK' },
      { labelKey: 'tts_voice_zh_tw', match: (o) => o.lang === 'zh-TW' },
      { labelKey: 'tts_voice_en', match: (o) => o.lang.startsWith('en') },
      {
        labelKey: 'tts_voice_other',
        match: (o) => !o.lang.startsWith('zh') && !o.lang.startsWith('en'),
      },
    ];

    for (const { labelKey, match } of groups) {
      const members = VOICE_OPTIONS.filter(match);
      if (members.length === 0) continue;

      const optgroup = document.createElement('optgroup');
      optgroup.label = t(labelKey);
      for (const option of members) {
        const el = document.createElement('option');
        el.value = option.id;
        el.textContent = this.voiceLabel(option);
        optgroup.appendChild(el);
      }
      select.appendChild(optgroup);
    }

    select.value = this.voice;
    select.addEventListener('change', (e) => {
      this.voice = (e.target as HTMLSelectElement).value;
      // The hint text depends on auto vs manual, so re-render.
      this.render();
    });
    group.appendChild(select);

    const hint = document.createElement('span');
    hint.className = 'tts-config-panel__hint';
    // Explain what the current choice actually does.
    hint.textContent = isAutoVoice(this.voice)
      ? t('tts_voice_auto_hint')
      : t('tts_voice_manual_hint');
    group.appendChild(hint);

    return group;
  }

  /**
   * Render the panel.
   */
  private render(): void {
    this.element.innerHTML = '';

    // Title
    const title = document.createElement('h3');
    title.className = 'tts-config-panel__title';
    title.textContent = t('tts_config');
    this.element.appendChild(title);

    // Error display
    if (this.error) {
      const errorEl = document.createElement('div');
      errorEl.className = 'tts-config-panel__error';
      errorEl.setAttribute('role', 'alert');
      errorEl.textContent = this.error;
      this.element.appendChild(errorEl);
    }

    // Success display
    if (this.successMessage) {
      const successEl = document.createElement('div');
      successEl.className = 'tts-config-panel__success';
      successEl.setAttribute('role', 'status');
      successEl.textContent = this.successMessage;
      this.element.appendChild(successEl);
    }

    // Loading
    if (this.loading) {
      const loadingEl = document.createElement('div');
      loadingEl.className = 'tts-config-panel__loading';
      loadingEl.setAttribute('aria-live', 'polite');
      loadingEl.textContent = t('loading');
      this.element.appendChild(loadingEl);
      return;
    }

    // Form
    const form = document.createElement('form');
    form.className = 'tts-config-panel__form';
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.saveConfig();
    });

    // URL field
    const urlGroup = document.createElement('div');
    urlGroup.className = 'tts-config-panel__field';

    const urlLabel = document.createElement('label');
    urlLabel.className = 'tts-config-panel__label';
    urlLabel.textContent = t('field_tts_url');
    urlGroup.appendChild(urlLabel);

    const urlInput = document.createElement('input');
    urlInput.className = 'tts-config-panel__input';
    urlInput.type = 'url';
    urlInput.placeholder = DEFAULT_TTS_URL;
    urlInput.value = this.url;
    urlInput.disabled = this.saving;
    urlInput.addEventListener('input', (e) => {
      this.url = (e.target as HTMLInputElement).value;
    });
    urlGroup.appendChild(urlInput);
    form.appendChild(urlGroup);

    // Voice field
    form.appendChild(this.buildVoiceField());

    // Token field
    const tokenGroup = document.createElement('div');
    tokenGroup.className = 'tts-config-panel__field';

    const tokenLabel = document.createElement('label');
    tokenLabel.className = 'tts-config-panel__label';
    tokenLabel.textContent = t('field_tts_token');
    tokenGroup.appendChild(tokenLabel);

    const tokenInput = document.createElement('input');
    tokenInput.className = 'tts-config-panel__input';
    tokenInput.type = 'password';
    tokenInput.placeholder = this.hasToken ? this.maskedToken : '';
    tokenInput.value = this.token;
    tokenInput.disabled = this.saving;
    tokenInput.autocomplete = 'off';
    tokenInput.addEventListener('input', (e) => {
      this.token = (e.target as HTMLInputElement).value;
    });
    tokenGroup.appendChild(tokenInput);

    // Hint under the token input
    const hint = document.createElement('span');
    hint.className = 'tts-config-panel__hint';
    hint.textContent = this.hasToken
      ? t('tts_token_saved_hint')
      : t('field_api_key') + ' (TOKEN)';
    tokenGroup.appendChild(hint);

    form.appendChild(tokenGroup);

    // Buttons
    const btnGroup = document.createElement('div');
    btnGroup.className = 'tts-config-panel__btn-group';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn btn--primary';
    saveBtn.type = 'submit';
    saveBtn.style.minWidth = '44px';
    saveBtn.style.minHeight = '44px';
    saveBtn.disabled = this.saving;
    saveBtn.textContent = this.saving ? t('loading') : t('save');
    btnGroup.appendChild(saveBtn);

    const testBtn = document.createElement('button');
    testBtn.className = 'btn btn--secondary';
    testBtn.type = 'button';
    testBtn.style.minWidth = '44px';
    testBtn.style.minHeight = '44px';
    testBtn.disabled = this.testing;
    testBtn.textContent = this.testing ? t('loading') : t('test');
    testBtn.addEventListener('click', () => this.testConnection());
    btnGroup.appendChild(testBtn);

    form.appendChild(btnGroup);
    this.element.appendChild(form);

    // Test result
    if (this.testResult) {
      const resultEl = document.createElement('div');
      resultEl.className = `tts-config-panel__test-result tts-config-panel__test-result--${this.testResult.success ? 'success' : 'error'}`;
      resultEl.setAttribute('role', 'status');
      resultEl.textContent = this.testResult.message;
      this.element.appendChild(resultEl);
    }
  }
}
