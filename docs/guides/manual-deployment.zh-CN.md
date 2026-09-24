# 手动部署

> [文档索引](../README.md) · [English](manual-deployment.md) · **中文**

手动部署 CFRSS 大约需要十分钟。

**你需要：** 一个 Cloudflare 账号（免费版就够）、Node.js 18 或更高版本，以及 git。

> 不想碰命令行？[README](../../README.zh-CN.md) 顶部的 **Deploy to Cloudflare**
> 按钮会帮你做完下面所有事情。

---

## 1. 取代码

```bash
git clone https://github.com/ituff/cfrss.git
cd cfrss
npm install
```

## 2. 登录 Cloudflare

```bash
npx wrangler login
```

会弹出浏览器窗口，授权后回到终端。

## 3. 创建数据库

```bash
npx wrangler d1 create cfrss-db
```

命令会输出一个 `database_id`，把它填进 `wrangler.toml`：

```toml
[[d1_databases]]
binding = "DB"
database_name = "cfrss-db"
database_id = "把这里换成你的 id"
migrations_dir = "migrations"
```

> **关于不让 id 进版本库。** 本仓库提交的是占位符，真实 id 在本地注入：把
> `D1_DATABASE_ID=<id>` 写进 `.dev.vars`（该文件已被 gitignore），再执行
> `bash scripts/set-d1-id.sh`。仓库里的 pre-commit 钩子会拒绝提交真实 id。
> 只有你打算公开自己的 fork 时才需要这么做，否则直接改 `wrangler.toml` 就行。

## 4. 设置两个密钥

```bash
npx wrangler secret put AUTH_TOKEN
npx wrangler secret put ENCRYPTION_KEY
```

| 密钥 | 说明 |
| --- | --- |
| `AUTH_TOKEN` | 你将来用来登录的密码。请选一个足够长且随机的字符串。 |
| `ENCRYPTION_KEY` | 任意随机字符串，可以用 `openssl rand -hex 32` 生成。 |

⚠️ **`ENCRYPTION_KEY` 用来加密你之后保存的 API Key**（LLM、GitHub、朗读）。
一旦更换，已保存的密钥就再也解不开，只能重新填一遍。选定之后请妥善保管。

## 5. 部署

```bash
npm run deploy
```

这条命令按顺序做三件事：

1. 用 esbuild 打包前端；
2. 把 D1 迁移应用到线上数据库；
3. 上传 Worker。

## 6. 验证

打开 wrangler 最后输出的网址，应该能看到登录界面。

| 现象 | 可能原因 |
| --- | --- |
| 页面能打开，但登录一直失败 | 输入的密码和 `AUTH_TOKEN` 不一致。 |
| 能登录，但列表空白、刷新报错 | 迁移没跑。用 `npx wrangler d1 migrations list DB --remote` 检查。 |
| `wrangler deploy` 报数据库相关的错 | `wrangler.toml` 里的 `database_id` 还是占位符。 |

## 可选 —— 自定义域名

在 `wrangler.toml` 里加一段路由，再部署一次：

```toml
routes = [
  { pattern = "rss.example.com", custom_domain = true }
]
```

域名必须和 Worker 在同一个 Cloudflare 账号下。如果你对 `*.workers.dev` 的地址
没意见，把整个 `routes` 段删掉即可。

## 可选 —— 每小时自动抓取

定时抓取已经在 `wrangler.toml` 里配好了：

```toml
[triggers]
crons = ["0 * * * *"]
```

不需要额外操作。`CRON_MAX_FEEDS` 控制单次运行最多刷新几个订阅源（默认 10），
其余的在后续小时里按最旧优先轮转。

## 接下来

- **[配置 LLM](llm-configuration.zh-CN.md)** —— 总结、翻译、每日摘要
- **[配置朗读服务](read-aloud.zh-CN.md)** —— 文字转语音
