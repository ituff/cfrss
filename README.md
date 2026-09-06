# CFRSS — Cloudflare RSS Reader

基于 Cloudflare Workers + Hono + D1 的单用户 RSS 阅读器，Folo 风格界面，支持 PWA 离线阅读、LLM 智能辅助（总结 / 翻译 / 朗读 / 每日摘要）、GitHub 仓库文章存储。

**线上地址**：https://rss.maowoo.top

## 功能特性

- **Folo 风格四栏界面**：图标导航栏 / 订阅分组树（未读数、可折叠）/ 文章卡片预览列表（缩略图、无限滚动）/ 阅读面板（自适应宽度）
- **订阅与分组管理**：OPML 导入导出、分类增删改、订阅增删改（标题 / RSS 地址）、移动分组
- **订阅源健康机制**：连续失败 5 次自动标记异常并跳过刷新，成功一次自动恢复
- **LLM 智能辅助**：文章总结、翻译（OpenAI 兼容接口，SSE 流式）、每日摘要、网页朗读
- **PWA 离线阅读**：Service Worker 缓存最新 25 篇文章，离线可读，联网自动更新
- **响应式布局**：桌面四栏 + 移动单栏，触屏手势（滑动翻页、下拉刷新）
- **中英双语**、深浅色主题
- **正文持久化**：文章全文以 JSON 存入用户自己的 GitHub 仓库

## 技术栈

| 层 | 技术 |
|---|---|
| 运行时 | Cloudflare Workers（免费额度） |
| 后端 | Hono 4.x |
| 数据库 | Cloudflare D1（SQLite） |
| 内容存储 | GitHub REST API |
| 前端 | Vanilla TypeScript SPA（esbuild 打包） |
| 测试 | Vitest + fast-check（属性测试） |

## 开发

```bash
npm install        # 安装依赖
npm run dev        # 本地开发（wrangler dev）
npm test           # 运行测试（404 个用例）
npm run deploy     # 构建前端并部署到 Cloudflare
npx tsc --noEmit   # 类型检查
```

## 部署要求

1. `wrangler login` 登录 Cloudflare
2. 创建 D1 数据库：`npx wrangler d1 create cfrss-db`，将 `database_id` 填入 `wrangler.toml`
3. 应用迁移：`npx wrangler d1 migrations apply cfrss-db --remote`
4. 配置 secrets：
   ```bash
   npx wrangler secret put AUTH_TOKEN       # 登录令牌（同时是 API Bearer token）
   npx wrangler secret put ENCRYPTION_KEY   # API Key 加密密钥（任意随机字符串）
   ```
5. `npm run deploy` 部署（自动构建前端 + 上传）

## 首次使用

1. 打开网站，输入 AUTH_TOKEN 登录
2. 设置 → GitHub Config：配置存储仓库（owner / repo / PAT，需 Contents 读写权限）
3. 设置 → LLM Config：添加 OpenAI 兼容的 API 配置并分配给 总结 / 翻译 功能
4. 订阅页：添加订阅源或导入 OPML，刷新抓取文章

## 架构速览

```
src/
├── index.ts          # Hono 入口：中间件 + 全部 API 路由
├── middleware/       # auth（Bearer token）、cpu-monitor、errorHandler
├── handlers/         # 路由处理器（订阅/分类/文章/OPML/LLM/配置）
├── services/         # 业务层（抓取/GitHub存储/LLM代理/每日摘要/订阅管理）
├── utils/            # crypto(AES-GCM)、errors、url-validator
└── client/           # 前端 SPA（feed-tree / article-pane / main-view / LoginGate…）
public/               # 静态资源（index.html / sw.js / styles.css）
migrations/           # D1 迁移
test/                 # 单元 + 属性测试
```

详细的架构设计、编码约定与进度见 [agent.md](agent.md)。
