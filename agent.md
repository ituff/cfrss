# CFRSS — Cloudflare RSS Reader（项目说明 / Agent Guide）

> 本文档供 AI 代理与开发者快速了解项目现状、架构与约定。生成日期：2026-09-05。

## 1. 项目概述

**CFRSS** 是一个基于 Cloudflare Workers 的单用户网页版 RSS 阅读器，使用 Hono 框架处理路由，配置存储于 Cloudflare D1（SQLite），RSS 文章正文通过 GitHub REST API 持久化到用户自己的仓库。支持 PWA 离线阅读、响应式布局（桌面双栏 / 移动单栏）、LLM 智能辅助（文章总结、翻译、每日摘要、朗读）以及中英文双语界面。

- **版本**：0.1.0（private）
- **许可**：见 `LICENSE`
- **规格文档**：`.kiro/specs/cloudflare-rss-reader/`（requirements.md / design.md / tasks.md，采用 EARS 需求格式 + 属性测试验证）

## 2. 技术栈

| 层 | 技术 |
|---|---|
| 运行时 | Cloudflare Workers（免费额度：10ms CPU/请求） |
| 后端框架 | Hono 4.x（原生 Workers 路由） |
| 数据库 | Cloudflare D1（SQLite），迁移文件在 `migrations/` |
| 内容存储 | GitHub REST API（文章 JSON 存至 `{contentPath}/{YYYY}/{MM}/{article-id}.json`） |
| 前端 | Vanilla TypeScript SPA（无框架，组件工厂函数模式），静态资源由 Workers Assets 提供 |
| 离线 | Service Worker（`public/sw.js`）+ Cache API，缓存最新 25 篇文章 |
| LLM | OpenAI 兼容接口，SSE 流式响应，API Key 以 AES-GCM 加密存于 D1 |
| TTS | 外部 Cloudflare Worker 部署的 read-aloud 服务 |
| 测试 | Vitest + @cloudflare/vitest-pool-workers（miniflare）+ fast-check（属性测试，numRuns≥100） |

## 3. 目录结构

```
（仓库根）
├── src/
│   ├── index.ts              # Hono 入口：中间件（CORS → CPU监控 → Auth）+ 全部 API 路由 + scheduled 定时入口
│   ├── scheduled.ts          # 每小时 cron 处理器（最旧优先分批，复用 feed-refresh 共享管线）
│   ├── types/index.ts        # 核心类型：Subscription, Article, LLMConfig, Env 等
│   ├── middleware/           # auth（单用户 token）、cpu-monitor（8ms 阈值早退）、errorHandler
│   ├── handlers/             # 路由处理器：articles, categories, config, github-config,
│   │                         #   llm, llm-config, opml, subscriptions
│   ├── services/             # 业务层：config-store(D1 KV), content-fetcher(RSS/Atom解析),
│   │                         #   feed-refresh(共享刷新管线), content-store(GitHub),
│   │                         #   daily-digest, llm-proxy(SSE), llm-service, opml, subscription-manager
│   ├── utils/                # crypto(AES-GCM), errors(APIError+状态码映射), language, url-validator
│   └── client/               # 前端 SPA：main.ts, router.ts, state.ts, gestures.ts,
│                             #   components/(article/digest/llm/player/settings/subscription/布局),
│                             #   services/(api, i18n, pwa, theme, tts)
├── public/                   # 静态资源：index.html, manifest.json, sw.js, css/
├── migrations/0001_initial_schema.sql  # D1 表：categories, subscriptions, articles,
│                                      #   llm_configs, llm_assignments, config, daily_digests, llm_cache
├── test/                     # 27 个测试文件（单元 + fast-check 属性测试）
├── .kiro/specs/cloudflare-rss-reader/  # 规格：requirements / design / tasks（含进度勾选）
├── wrangler.toml             # Workers 配置：cron(0 * * * *)、CRON_MAX_FEEDS、D1 绑定 DB、assets SPA fallback、run_worker_first=/api/*
└── vitest.config.ts          # workers pool 测试环境
```

## 4. 常用命令

```bash
npm run dev      # wrangler dev 本地开发（miniflare，含本地 D1）
npm test         # vitest run 全量测试（约 20s，411 个用例）
npm run deploy   # wrangler deploy 部署到 Cloudflare
npx tsc --noEmit # 类型检查（当前 0 错误）
npx wrangler d1 migrations apply cfrss-db --local   # 应用 D1 迁移（本地）
npx wrangler d1 migrations apply cfrss-db --remote  # 应用 D1 迁移（线上）
```

## 5. 当前进度（截至 2026-09-05）

### 已完成 ✅

`.kiro/specs/.../tasks.md` 中 **17 个任务组、全部子任务已勾选完成**，包括：

1. **基础设施**：Hono 项目骨架、D1 迁移、auth/错误处理/CPU 监控中间件、vitest 测试框架
2. **配置与加密**：config-store（D1 KV）、AES-GCM API Key 加密、主题/语言配置 API
3. **订阅管理**：分类 CRUD（含删除级联迁移至 default）、订阅源 CRUD、URL 校验（10s 探测）、去重
4. **OPML**：解析/导出（5MB 限制）、导入去重与计数汇总、往返保真属性测试
5. **内容抓取**：RSS 2.0 / Atom 1.0 解析、并行刷新（15s/feed 超时、单源失败不阻塞）
6. **GitHub 存储**：文章 JSON 上传（3 次重试）、PAT 校验、配置 API
7. **LLM**：配置 CRUD（上限 10 个）、SSE 流式代理（30s 超时、3 次重试）、总结/翻译（llm_cache 缓存幂等）、每日摘要（24h 内未读 ≤20 篇）
8. **前端 SPA**：响应式布局（1024px 断点、300ms 过渡、切换保留当前文章）、触屏手势（滑动 >50px 翻页、下拉 >60px 刷新）、订阅/文章/LLM UI 组件、朗读播放器、设置面板、i18n（zh/en）
9. **PWA**：Service Worker 缓存策略（最新 25 篇）、manifest、版本更新提示
10. **集成**：全部路由已接入 `src/index.ts`，前端 API client 完成

**验证状态**：
- TypeScript 编译：`tsc --noEmit` 通过，0 错误
- 测试：**27 个测试文件、411 个用例全部通过**（含 19 个 fast-check 属性测试，覆盖规格中的 Property 1–22）
- 本地 D1 状态存在（`.wrangler/state/`），说明已跑过本地迁移与开发调试

### 2026-09-07 增量：每小时定时抓取（cron）✅

- 新增 `[triggers] crons = ["0 * * * *"]`（`wrangler.toml`）+ `src/scheduled.ts`（`handleScheduled`），`index.ts` 改为 `{ fetch: app.fetch, scheduled: handleScheduled }` 导出
- 手动刷新端点的抓取/健康计数/去重/GitHub 持久化逻辑抽取为共享服务 `src/services/feed-refresh.ts`（`refreshSubscriptionsAndStore`），`loadGitHubConfig` 迁至 `content-store.ts`，HTTP 端点与 cron 共用同一条管线
- cron 行为：每次运行最多刷新 `CRON_MAX_FEEDS`（vars，默认 10）个订阅，按 `last_fetched_at` 最旧优先（NULL 最先）轮转；跳过 disabled 订阅；新文章入库 `is_read = 0`（未读）
- 新增测试：`test/scheduled.test.ts`（4 用例）、`test/services/feed-refresh.test.ts`（3 用例，固化手动刷新端点契约）
- 同日将仓库从 `cfrss/` 子目录提升至工作区根目录（git 历史保留），根目录遗留的原型实现归档至 `new-design/`（已 gitignore，不进版本库）

### Git 状态

- 分支 `main`，远程 `origin` = github.com/ituff/cfrss（本地提交未推送）。提交历史：配置与依赖 → 后端功能 → 前端 UI → 文档（2026-09-06 整理）

### 部署状态（2026-09-05 已部署）✅

- **线上地址**：`https://rss.maowoo.top`（自定义域名，workers.dev 入口已关闭——workers.dev 在大陆被墙）
- **D1 数据库**：`cfrss-db`（id `61cdf440-f09f-4f5c-a52d-25632704913a`，区域 EEUR），迁移已应用
- **Secrets**：`AUTH_TOKEN` 与 `ENCRYPTION_KEY` 已配置；本地留档于 `.dev-secrets.env`（已 gitignore）
- **构建链**：wrangler 4.129.0 + @cloudflare/workers-types v5（wrangler 3 不支持 `run_worker_first` 数组）
- **已验证**：首页 200、API 鉴权 200、SPA 路由回退 200（从本地网络实测）

### 待办 / 未完成事项 ⚠️

1. 首次使用需在设置面板配置 GitHub 仓库（owner/repo/PAT）、LLM 配置，再导入订阅
2. `.gitignore` 的 `.kiro/` 修改及 wrangler 升级改动未提交；提交后规格文档将不进版本库
3. CI 已配置（GitHub Actions：tsc + vitest，.github/workflows/ci.yml）；lint（eslint/prettier）未配置
4. `README.md` 缺失

## 6. 关键设计约定（编码前必读）

- **单用户认证**：`src/middleware/auth.ts` 基于 token；Workers secret 存放 token 与 AES 加密密钥。前端通过 `src/client/components/LoginGate.ts` 登录门（token 存 localStorage，自动登录/401 清除），`api.ts` 的 `installFetchAuth()` 全局拦截 `/api/*` 请求注入 Bearer 头——**新增组件可直接用裸 fetch，勿绕过该拦截器**
- **错误处理**：统一抛 `APIError`（`src/utils/errors.ts`），`app.onError` 捕获并映射 HTTP 状态码（400/404/408/409/502/503）
- **CPU 限制**：免费版 10ms CPU，`cpu-monitor` 中间件在接近阈值时早退并返回截断标记。刷新接口（`POST /api/articles/refresh`）支持 `{ids, force}` 分批调用——前端 `refreshFeeds()` 自动按 8 个/批分批；feed 解析截断至 256KB、下载上限 5MB、只保留 24h 内文章；去重查询必须按 subscription_id 过滤（全表扫描会超 CPU，错误 1102）
- **订阅源健康机制**：`subscriptions` 表有 `fail_count`/`disabled` 字段——连续失败 5 次自动标记异常并跳过刷新，成功一次即自动恢复；`PUT /api/subscriptions/:id/enable` 手动恢复；订阅列表中异常源带 ⚠ 标记
- **定时刷新（cron）**：`scheduled.ts` 与手动刷新端点共用 `refreshSubscriptionsAndStore`——改刷新/入库逻辑只改这一处。免费版 10ms CPU 硬限制下单次批次由 `CRON_MAX_FEEDS` 控制（默认 10），按 `last_fetched_at` 最旧优先轮转；cron 与 HTTP 均无跨调用状态，依赖健康机制自愈
- **静态资源**：`wrangler.toml` 的 `[assets]` 处理 SPA fallback（非 `/api/*` 未命中静态文件 → `index.html`），Worker 只处理 `/api/*`
- **API Key 安全**：LLM/GitHub 的密钥先经 `src/utils/crypto.ts`（AES-GCM）加密再入 D1，永不回传明文
- **LLM 缓存**：总结/翻译结果入 `llm_cache`（键：article_id + function），每日摘要在调用 LLM 前先查 `daily_digests`
- **前端组件**：无框架，采用 TS 工厂函数 + DOM 操作模式（见 `src/client/components/`）；路由为客户端 hash 路由（支持 `?key=value` query）。桌面端为 Folo 风格四栏布局：`DesktopLayout`（图标导航栏）+ `main-view.ts`（`feed-tree.ts` 订阅分组树 + `article-pane.ts` 文章卡片列表 + ArticleView 阅读面板），MainView 在 home/articles/article-detail 路由间保持挂载；settings/subscriptions/digest 路由及移动端仍走 `route-view.ts`（RouteView）。订阅列表 API 带 `unreadCount`
- **Service Worker**：静态资源采用**网络优先 + 缓存回退**策略（`rss-app-v2`），保证部署后用户能拿到新版本；改动资源形态时需递增缓存版本号
- **i18n**：所有 UI 文案走 `src/client/services/i18n.ts` 键值表，新增文案必须同时提供 zh/en（属性测试 Property 14 校验完整性）
- **属性测试**：修改核心逻辑时保持对应 fast-check 属性测试通过（规格 Property 1–22，见 tasks.md 中 `*` 标记任务）

## 7. 规格 ↔ 代码对照速查

| 需求域 | 主要代码 | 主要测试 |
|---|---|---|
| 响应式/手势 | `src/client/components/*Layout.ts`, `gestures.ts` | `test/client/gestures.test.ts` |
| 主题/语言 | `handlers/config.ts`, `client/services/theme.ts`, `i18n.ts` | `config-store`, `language`, `theme` 测试 |
| 订阅/分类 | `services/subscription-manager.ts`, `utils/url-validator.ts` | `subscription-manager`, `url-validator` |
| OPML | `services/opml.ts` | `opml`, `opml-import` |
| 抓取 | `services/content-fetcher.ts` | `content-fetcher`, `refresh-feeds` |
| 定时抓取（cron） | `scheduled.ts`, `services/feed-refresh.ts`（与手动刷新共享管线） | `scheduled.test.ts`, `services/feed-refresh.test.ts` |
| 正文存储 | 刷新时 `storeArticle` 上传 GitHub（需 UA 头，否则 403）；详情接口 `getArticleContent` 回读 | `content-store` |
| GitHub 存储 | `services/content-store.ts` | `content-store` |
| LLM | `services/llm-service.ts`, `llm-proxy.ts`, `daily-digest.ts` | `llm-service`, `llm-proxy`, `daily-digest` |
| PWA 离线 | `public/sw.js`, `client/services/pwa.ts` | setup 及属性测试 Property 19 |
