# Configure read-aloud

CFRSS does not contain a text-to-speech engine. It talks to a **read-aloud
service that you deploy yourself** — a small Worker that proxies Microsoft's
"Read aloud" (Edge TTS) voices.

Skip this page and everything else still works; you just won't have the 🔊 button.

---

## 1. Deploy the service

The upstream project is **[yy4382/read-aloud](https://github.com/yy4382/read-aloud)**.
It runs on Cloudflare Workers, Vercel, or Node.js in Docker.

**Cloudflare Workers (recommended):** open that repository and use its own
*Deploy to Cloudflare* button. Then, in the Cloudflare dashboard for the new
Worker, go to **Settings → Variables and Secrets** and add:

```
TOKEN=YOUR_TOKEN
```

**Or with Docker:**

```bash
docker run -d --name read-aloud -p 3000:3000 \
  -e TOKEN=YOUR_TOKEN yunfinibol/read-aloud:main
```

> **Set a `TOKEN`.** It works like a password: without it, anyone who finds your
> URL can use your service. CFRSS sends it as a query parameter, so it never
> needs to be shared with anyone but you.

Note the URL you end up with — `https://something.workers.dev`, or your own
domain if you attached one.

## 2. Point CFRSS at it

**Settings → Read-aloud**, three fields:

| Field | What to put |
| --- | --- |
| **Service URL** | Your deployment, e.g. `https://tts.example.com` (no trailing path) |
| **API key** | The same `TOKEN` you set in step 1 |
| **Voice** | `Auto detect`, or a specific voice |

Press **Test**. CFRSS synthesises a short sample through your service and plays
it back. If you hear speech, you're done.

## 3. Voices

The picker ships with 19 curated voices:

| Language | Voices |
| --- | --- |
| 普通话 | Xiaoxiao, Xiaoyi, Yunxi, Yunjian, Yunyang, plus Liaoning and Shaanxi accents |
| 粤语 / 台湾 | HiuMaan, HiuGaai, HsiaoChen, HsiaoYu |
| English | Aria, Jenny, Guy (US), Sonia (GB) |
| 其他 | Nanami (ja), SunHi (ko), Svetlana (ru) |

**Auto detect** is the default and usually the right choice: it picks a voice per
paragraph from the script of the text, so a Chinese article with English quotes
still sounds natural.

---

## How the request is made

CFRSS never hands your `TOKEN` to the browser. The browser asks **CFRSS** for
audio, and CFRSS appends the token and calls your service:

```
GET {Service URL}/api/synthesis
      ?text=<paragraph>
      &voiceName=<voice>
      &format=audio-24khz-48kbitrate-mono-mp3
      &token=<your TOKEN>
```

Because the token lives on the server, it is never exposed to the page, and the
synthesis endpoint is protected by the same login as the rest of the app.

**What is shared and what is per-device:**

| Setting | Scope | Why |
| --- | --- | --- |
| Service URL, API key | Shared | They are service credentials |
| Voice | Per device | An e-reader with an English-only engine and a phone shouldn't have to agree |

## How playback works

CFRSS splits the article into paragraphs and synthesises them **one at a time**,
prefetching the next while you listen. The paragraph currently being spoken is
highlighted and scrolled into view, so you can follow along or jump back.

Text is capped at 5,000 characters per request — Edge TTS degrades on very long
inputs, which is exactly why the article is split rather than sent whole.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| Test returns 401 / 403 | The API key doesn't match the service's `TOKEN`. |
| Test returns 404 | The Service URL is wrong, or includes a path. It should be the bare origin. |
| Test fails with a network error | The Worker can't reach the URL. Check it's public and spelled correctly. |
| Test works, but nothing plays | The browser blocked autoplay. Click play once manually. |
| Speech stops partway | A paragraph failed to synthesise. Press play again to resume from that paragraph. |
| Wrong language accent | Set the voice explicitly instead of `Auto detect`. |
