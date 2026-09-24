# Configure LLM

Article summaries, full-text translation and the daily digest all call an
**OpenAI-compatible chat-completions endpoint**. CFRSS does not ship a model —
you bring your own provider, and the key stays yours.

If you skip this page entirely, CFRSS still works: you just don't get summaries,
translation or the digest.

---

## 1. Add a provider

**Settings → AI providers → Add**, then fill in four fields:

| Field | What to put |
| --- | --- |
| **Name** | Anything you'll recognise, e.g. `DeepSeek` |
| **Base URL** | The API root, **including** `/v1` where the provider uses it |
| **Model** | The exact model id |
| **API key** | The provider's key |

CFRSS calls `{Base URL}/chat/completions` with `Authorization: Bearer {API key}`.
That is the only thing you need to get right.

### Base URLs that work

| Provider | Base URL | Example model |
| --- | --- | --- |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` |
| Moonshot / Kimi | `https://api.moonshot.cn/v1` | `moonshot-v1-8k` |
| Zhipu GLM | `https://open.bigmodel.cn/api/paas/v4` | `glm-4-flash` |
| SiliconFlow | `https://api.siliconflow.cn/v1` | `Qwen/Qwen2.5-7B-Instruct` |
| OpenRouter | `https://openrouter.ai/api/v1` | `openai/gpt-4o-mini` |

> These are examples, not endorsements — check your provider's docs for the
> current base URL and model names. Anything that speaks the OpenAI
> chat-completions API works.

⚠️ **The endpoint has to be reachable from the public internet.** The request is
made from your Cloudflare Worker, not from your laptop, so a model running on
`http://localhost:11434` (Ollama, LM Studio, …) will not be reachable unless you
expose it through a tunnel or a public hostname.

## 2. Assign it

Still in **Settings → AI providers**, choose which provider handles each
function:

| Function | Used by |
| --- | --- |
| **Summaries** | The ✦ button in the article toolbar |
| **Translation** | The 🌐 button, and the daily digest |

You can point both at the same provider, or use a cheap fast model for summaries
and a stronger one for translation. Up to **10** providers can be stored.

## 3. Test it

Each provider row has a **Test** button. It sends a small request and reports
back whether the endpoint, the key and the model name are all correct. Use it
before you go looking for the problem somewhere else.

---

## What gets sent

When you press Summarize, CFRSS sends the **full article text** (HTML stripped)
to your provider, along with an instruction to produce a short structured
summary. Translation sends the article's HTML with an instruction to translate
the text while preserving every tag.

Requests carry `enable_thinking: false` so reasoning models don't spend tokens
before answering, and follow your **interface language** — a Chinese UI asks for
a Chinese summary.

Nothing is sent anywhere until you press a button. There is no background
summarisation.

## Caching

| Result | Cached where | Invalidated when |
| --- | --- | --- |
| Summary | Per article | Never — recomputed only if you clear it |
| Translation | Per article **and** target language | Never |
| Daily digest | Per calendar day | Regenerated on request |

The cache is what makes the second visit instant, and it is also why translating
the same article into a second language costs another call.

## Translation languages

Ten targets: 中文 · English · 日本語 · 한국어 · Français · Deutsch · Español ·
Русский · Português · Italiano.

Three display modes, cycled from the toolbar:

- **Dual-line** (default) — each paragraph followed by its translation
- **Side by side** — two columns
- **Translation only**

Your target language and display mode are remembered per device.

## Where the key lives

The API key is encrypted with `ENCRYPTION_KEY` before it is written to the
database, and the API never returns it in clear text — the settings page only
ever shows a masked value.

That means: **if you change `ENCRYPTION_KEY`, every stored key becomes
unreadable** and has to be entered again.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| Test fails immediately with a 4xx | Base URL or model name is wrong. Check whether your provider needs `/v1`. |
| Test fails with 401 / 403 | Wrong API key, or the key has no access to that model. |
| Test hangs, then times out | The endpoint isn't reachable from Cloudflare's network. |
| Summaries work, translation doesn't | The two functions are assigned to different providers — check both. |
| "Maximum of 10 LLM configurations allowed" | Delete an unused provider first. |
