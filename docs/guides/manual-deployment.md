# Manual deployment

> [Documentation index](../README.md) · **English** · [中文](manual-deployment.zh-CN.md)

Deploying CFRSS by hand takes about ten minutes.

**You need:** a Cloudflare account (the free plan is enough), Node.js 18 or
newer, and git.

> Prefer not to touch a terminal? The **Deploy to Cloudflare** button on the
> [README](../../README.md) does all of this for you.

---

## 1. Get the code

```bash
git clone https://github.com/ituff/cfrss.git
cd cfrss
npm install
```

## 2. Sign in to Cloudflare

```bash
npx wrangler login
```

A browser window opens. Approve access, then come back to the terminal.

## 3. Create the database

```bash
npx wrangler d1 create cfrss-db
```

The command prints a `database_id`. Copy it into `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "cfrss-db"
database_id = "paste-the-id-here"
migrations_dir = "migrations"
```

> **Keeping the id out of git.** This repository commits a placeholder id and
> injects the real one locally instead: put `D1_DATABASE_ID=<id>` in `.dev.vars`
> (which is gitignored) and run `bash scripts/set-d1-id.sh`. A pre-commit hook
> refuses to commit a real id. You only need this if you plan to publish your
> fork — otherwise editing `wrangler.toml` directly is fine.

## 4. Set the two secrets

```bash
npx wrangler secret put AUTH_TOKEN
npx wrangler secret put ENCRYPTION_KEY
```

| Secret | What it is |
| --- | --- |
| `AUTH_TOKEN` | The password you will sign in with. Pick something long and random. |
| `ENCRYPTION_KEY` | Any random string — `openssl rand -hex 32` is a good way to make one. |

⚠️ **`ENCRYPTION_KEY` encrypts the API keys you save later** (LLM, GitHub, TTS).
If you change it, those saved keys become unreadable and you will have to enter
them again. Choose it once and keep it.

## 5. Deploy

```bash
npm run deploy
```

This does three things in order:

1. bundles the frontend with esbuild,
2. applies the D1 migrations to your remote database,
3. uploads the Worker.

## 6. Verify

Open the URL wrangler printed at the end. You should see the sign-in screen.

| Symptom | Likely cause |
| --- | --- |
| The page loads but sign-in always fails | The token you typed doesn't match `AUTH_TOKEN`. |
| Sign-in works, the list is empty, refresh fails | Migrations didn't run. Check with `npx wrangler d1 migrations list DB --remote`. |
| `wrangler deploy` complains about the database | The `database_id` in `wrangler.toml` is still the placeholder. |

## Optional — a custom domain

Add a route to `wrangler.toml` and deploy again:

```toml
routes = [
  { pattern = "rss.example.com", custom_domain = true }
]
```

The domain has to be in the same Cloudflare account. Delete the whole `routes`
block if you are happy with the `*.workers.dev` address.

## Optional — hourly refresh

The hourly refresh is already configured in `wrangler.toml`:

```toml
[triggers]
crons = ["0 * * * *"]
```

Nothing to do. `CRON_MAX_FEEDS` controls how many feeds one run may refresh
(default 10); the rest rotate in later hours, oldest first.

## Next steps

- **[Configure LLM](llm-configuration.md)** — summaries, translation, daily digest
- **[Configure read-aloud](read-aloud.md)** — text-to-speech
