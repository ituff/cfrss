/**
 * TTS (Read-Aloud) Config API handlers.
 *
 * GET  /api/config/tts        → handleGetTTSConfig
 * PUT  /api/config/tts        → handleSetTTSConfig
 * POST /api/config/tts/test   → handleTestTTSConfig
 * POST /api/tts/synthesis     → handleTTSSynthesis
 *
 * Config is stored as key-value pairs in the D1 `config` table:
 *   tts_url (plain), tts_token_encrypted (encrypted)
 *
 * The selected voice (`tts_voice`) lives in `device_settings` instead, so each
 * device can pick its own voice while sharing the service credentials.
 *
 * The synthesis endpoint proxies a self-hosted read-aloud Worker
 * (upstream: https://github.com/yy4382/read-aloud — see docs/guides/read-aloud.md;
 * GET /api/synthesis?text=...&voiceName=...&token=...),
 * so the API key never leaves the server and browser requests are
 * already covered by the app's auth middleware.
 */

import type { Context } from 'hono';
import type { Env } from '../types';
import { getConfig, setConfig } from '../services/config-store';
import { getDeviceSetting, setDeviceSetting } from '../services/device-store';
import type { DeviceContext } from '../middleware/device';
import { encrypt, decrypt } from '../utils/crypto';
import { validationError, upstreamError } from '../utils/errors';

const KEYS = {
  url: 'tts_url',
  token: 'tts_token_encrypted',
  voice: 'tts_voice',
} as const;

/** Default endpoint placeholder — users configure their own read-aloud deployment. */
export const DEFAULT_TTS_URL = 'https://tts.example.com';

/**
 * Sentinel stored for `tts_voice` meaning "pick a voice per paragraph
 * from the text's script" (the historical behaviour). An empty string
 * is treated the same way.
 */
export const AUTO_VOICE = 'auto';

/** Voice used when nothing is configured and auto-detection has no match. */
const FALLBACK_VOICE = 'en-US-AriaNeural';

/** Longest accepted voice name — Edge voice ids are far shorter. */
const MAX_VOICE_LENGTH = 100;

/** Audio format requested from the read-aloud Worker (mp3). */
const AUDIO_FORMAT = 'audio-24khz-48kbitrate-mono-mp3';

/** Max characters per synthesis request — Edge TTS degrades beyond this. */
const MAX_TEXT_LENGTH = 5000;

function maskToken(token: string): string {
  if (token.length <= 4) {
    return '****';
  }
  return '*'.repeat(token.length - 4) + token.slice(-4);
}

/**
 * Load the stored TTS config, applying defaults. Token is decrypted.
 *
 * `voice` resolves per device (device override → global value), because the
 * right voice is a property of the listening device — an e-reader with an
 * English-only engine and an iPad shouldn't have to agree. `url` and `token`
 * stay global: they are the service credentials, not a per-device preference.
 */
async function loadTTSConfig(
  db: Env['DB'],
  encryptionKey: string,
  deviceId: string | null = null
): Promise<{ url: string; token: string | null; voice: string }> {
  const [url, tokenEncrypted, voice] = await Promise.all([
    getConfig(db, KEYS.url),
    getConfig(db, KEYS.token),
    getDeviceSetting(db, deviceId, KEYS.voice),
  ]);

  let token: string | null = null;
  if (tokenEncrypted) {
    try {
      token = await decrypt(tokenEncrypted, encryptionKey);
    } catch {
      token = null;
    }
  }

  return {
    url: url || DEFAULT_TTS_URL,
    token,
    voice: voice?.trim() || AUTO_VOICE,
  };
}

/**
 * Build the read-aloud synthesis URL with query params.
 */
function buildSynthesisUrl(
  baseUrl: string,
  text: string,
  voiceName: string,
  token: string | null,
  rate?: string
): string {
  const url = new URL('/api/synthesis', baseUrl.endsWith('/') ? baseUrl : baseUrl + '/');
  url.searchParams.set('text', text);
  url.searchParams.set('voiceName', voiceName);
  url.searchParams.set('format', AUDIO_FORMAT);
  if (rate) {
    url.searchParams.set('rate', rate);
  }
  if (token) {
    url.searchParams.set('token', token);
  }
  return url.toString();
}

/**
 * GET /api/config/tts
 *
 * Returns the stored TTS configuration with the token masked.
 * `voice` is either a concrete voice id or the 'auto' sentinel, resolved for
 * the calling device.
 */
export async function handleGetTTSConfig(c: Context<DeviceContext>) {
  const db = c.env.DB;
  const encryptionKey = c.env.ENCRYPTION_KEY;

  const { url, token, voice } = await loadTTSConfig(db, encryptionKey, c.get('deviceId'));

  return c.json({
    url,
    voice,
    hasToken: token !== null,
    token: token ? maskToken(token) : null,
  });
}

/**
 * PUT /api/config/tts
 *
 * Accepts { url?, token?, voice? }. The token is only updated when a
 * non-empty value is provided (the masked value is never sent back to
 * the client). `voice` may be a voice id or 'auto' to restore
 * per-paragraph script detection.
 *
 * `url`/`token` are written globally; `voice` is written for the calling
 * device only.
 */
export async function handleSetTTSConfig(c: Context<DeviceContext>) {
  const db = c.env.DB;
  const encryptionKey = c.env.ENCRYPTION_KEY;

  const body = await c.req.json<{ url?: string; token?: string; voice?: string }>();

  const url = (body.url ?? '').trim() || DEFAULT_TTS_URL;
  if (!/^https?:\/\//.test(url)) {
    const err = validationError('url must start with http:// or https://.');
    return c.json(err.toJSON(), 400 as const);
  }

  if (body.token !== undefined && typeof body.token !== 'string') {
    const err = validationError('token must be a string.');
    return c.json(err.toJSON(), 400 as const);
  }

  if (body.voice !== undefined && typeof body.voice !== 'string') {
    const err = validationError('voice must be a string.');
    return c.json(err.toJSON(), 400 as const);
  }

  const voice = (body.voice ?? '').trim() || AUTO_VOICE;
  if (voice.length > MAX_VOICE_LENGTH) {
    const err = validationError(`voice must not exceed ${MAX_VOICE_LENGTH} characters.`);
    return c.json(err.toJSON(), 400 as const);
  }
  // Voice ids are alphanumeric with dashes/underscores/dots (e.g.
  // en-US-AriaNeural). Reject anything else so the value can be passed
  // to the upstream service without escaping concerns.
  if (voice !== AUTO_VOICE && !/^[A-Za-z0-9._-]+$/.test(voice)) {
    const err = validationError('voice contains unsupported characters.');
    return c.json(err.toJSON(), 400 as const);
  }

  const saves: Promise<void>[] = [
    setConfig(db, KEYS.url, url),
    setDeviceSetting(db, c.get('deviceId'), KEYS.voice, voice),
  ];
  if (body.token && body.token.trim()) {
    const encrypted = await encrypt(body.token.trim(), encryptionKey);
    saves.push(setConfig(db, KEYS.token, encrypted));
  }
  await Promise.all(saves);

  return c.json({ success: true, url, voice });
}

/**
 * POST /api/config/tts/test
 *
 * Synthesizes a short sample sentence through the stored configuration
 * to verify the service is reachable and the token is accepted.
 * Uses the configured voice when one is set, so the sample matches
 * what read-aloud will actually sound like.
 */
export async function handleTestTTSConfig(c: Context<DeviceContext>) {
  const db = c.env.DB;
  const encryptionKey = c.env.ENCRYPTION_KEY;

  const { url, token, voice } = await loadTTSConfig(db, encryptionKey, c.get('deviceId'));
  const voiceName = voice === AUTO_VOICE ? 'zh-CN-XiaoxiaoNeural' : voice;

  try {
    const synthesisUrl = buildSynthesisUrl(
      url,
      '你好，这是一条朗读测试语音。',
      voiceName,
      token
    );
    const response = await fetch(synthesisUrl, {
      headers: { 'User-Agent': 'CFRSS-Reader' },
    });

    if (response.ok) {
      const contentType = response.headers.get('content-type') ?? '';
      if (contentType.includes('audio') || contentType.includes('octet-stream')) {
        return c.json({ success: true, message: 'TTS service is working.' });
      }
      return c.json({
        success: false,
        message: `Unexpected content type from TTS service: ${contentType || 'none'}`,
      });
    }

    if (response.status === 401) {
      return c.json({ success: false, message: 'Unauthorized: token is invalid or missing.' });
    }

    return c.json({
      success: false,
      message: `TTS service returned ${response.status}.`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ success: false, message: `Failed to reach TTS service: ${message}` });
  }
}

/**
 * POST /api/tts/synthesis
 *
 * Proxies one text paragraph to the read-aloud Worker and streams the
 * audio back. Request body: { text: string, voiceName?: string, rate?: string }.
 */
export async function handleTTSSynthesis(c: Context<DeviceContext>) {
  const db = c.env.DB;
  const encryptionKey = c.env.ENCRYPTION_KEY;

  const body = await c.req.json<{ text?: string; voiceName?: string; rate?: string }>();

  if (!body.text || typeof body.text !== 'string' || !body.text.trim()) {
    const err = validationError('text is required and must be a non-empty string.');
    return c.json(err.toJSON(), 400 as const);
  }
  if (body.text.length > MAX_TEXT_LENGTH) {
    const err = validationError(`text exceeds the maximum length of ${MAX_TEXT_LENGTH} characters.`);
    return c.json(err.toJSON(), 400 as const);
  }

  const { url, token, voice: configuredVoice } = await loadTTSConfig(db, encryptionKey, c.get('deviceId'));
  // Precedence: explicit per-request voice → configured voice → fallback.
  // 'auto' is resolved client-side (per paragraph, by script), so a
  // request bearing 'auto' is treated as "no explicit voice".
  const requested = typeof body.voiceName === 'string' ? body.voiceName.trim() : '';
  const voiceName =
    requested && requested !== AUTO_VOICE
      ? requested
      : configuredVoice !== AUTO_VOICE
        ? configuredVoice
        : FALLBACK_VOICE;
  const rate = typeof body.rate === 'string' && body.rate.trim() ? body.rate.trim() : undefined;

  let upstream: Response;
  try {
    upstream = await fetch(buildSynthesisUrl(url, body.text, voiceName, token, rate), {
      headers: { 'User-Agent': 'CFRSS-Reader' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw upstreamError(`Failed to reach TTS service: ${message}`);
  }

  if (!upstream.ok || !upstream.body) {
    const detail = upstream.status === 401 ? 'Unauthorized: check the TTS API key.' : `TTS service returned ${upstream.status}.`;
    throw upstreamError(detail);
  }

  return new Response(upstream.body, {
    headers: {
      'Content-Type': upstream.headers.get('content-type') ?? 'audio/mpeg',
      'Cache-Control': 'no-store',
    },
  });
}
