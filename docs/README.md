# Documentation

Guides for deploying and configuring CFRSS.

---

## Structure

```
docs/
├── README.md        # this index
├── images/          # images used by the READMEs (e.g. the WeChat QR code)
├── guides/          # user-facing guides, English + Simplified Chinese pairs
└── screenshots/     # interface screenshots used by the READMEs
```

## Naming

- **Guides** (`guides/`) are named after their topic, with no date: English as
  `<topic>.md`, Simplified Chinese as `<topic>.zh-CN.md`.
- Topic names use English kebab-case.

---

## Guides

Each guide has an English and a Simplified Chinese version.

| Topic | English | 中文 | What it covers |
|---|---|---|---|
| Manual deployment | [manual-deployment.md](guides/manual-deployment.md) | [manual-deployment.zh-CN.md](guides/manual-deployment.zh-CN.md) | Creating the database, setting secrets, deploying, verifying, and a troubleshooting table |
| LLM configuration | [llm-configuration.md](guides/llm-configuration.md) | [llm-configuration.zh-CN.md](guides/llm-configuration.zh-CN.md) | Adding OpenAI-compatible providers, assigning them to summary/translation, cache semantics, troubleshooting |
| Read-aloud | [read-aloud.md](guides/read-aloud.md) | [read-aloud.zh-CN.md](guides/read-aloud.zh-CN.md) | Deploying the read-aloud service, choosing a voice, the proxy chain, troubleshooting |

> These guides are also published to the [Wiki](https://github.com/ituff/cfrss/wiki)
> for easier browsing. The copies here are the source of truth.

---

## Related

- [`../README.md`](../README.md) — project introduction (English)
- [`../README.zh-CN.md`](../README.zh-CN.md) — project introduction (中文)
