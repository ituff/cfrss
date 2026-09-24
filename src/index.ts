import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './types';
import { handleScheduled } from './scheduled';
import { authMiddleware } from './middleware/auth';
import { cpuMonitorMiddleware } from './middleware/cpu-monitor';
import { deviceMiddleware } from './middleware/device';
import { errorHandler } from './middleware/errorHandler';
import { handleGetTheme, handleSetTheme, handleGetLanguage, handleSetLanguage } from './handlers/config';
import { handleChangePassword, handleResetPassword, handleGetPasswordStatus } from './handlers/auth';
import { handleListCategories, handleCreateCategory, handleRenameCategory, handleDeleteCategory } from './handlers/categories';
import {
  handleListSubscriptions,
  handleAddSubscription,
  handleDeleteSubscription,
  handleMoveSubscription,
  handleEnableSubscription,
  handleUpdateSubscription,
} from './handlers/subscriptions';
import { handleImportOPML, handleExportOPML } from './handlers/opml';
import { handleListArticles, handleGetArticle, handleRefreshFeeds, handleUpdateReadState } from './handlers/articles';
import {
  handleListBookmarks,
  handleGetBookmarkState,
  handleAddBookmark,
  handleRemoveBookmark,
} from './handlers/bookmarks';
import { handleGetGitHubConfig, handleSetGitHubConfig, handleTestGitHubConfig } from './handlers/github-config';
import {
  handleGetTTSConfig,
  handleSetTTSConfig,
  handleTestTTSConfig,
  handleTTSSynthesis,
} from './handlers/tts-config';
import { handleSummarizeArticle, handleTranslateArticle, handleGetDailyDigest, handleGenerateDailyDigest } from './handlers/llm';
import {
  handleListLLMConfigs,
  handleCreateLLMConfig,
  handleUpdateLLMConfig,
  handleDeleteLLMConfig,
  handleTestLLMConfig,
  handleGetLLMAssignments,
  handleSetLLMAssignments,
} from './handlers/llm-config';

export type { Env };

const app = new Hono<{ Bindings: Env }>();

// Global error handler
app.onError(errorHandler);

// Middleware
// X-Device-Id must be allowed through CORS or per-device settings break for
// cross-origin callers.
app.use('*', cors({ allowHeaders: ['Content-Type', 'Authorization', 'X-Device-Id'] }));
app.use('*', cpuMonitorMiddleware());
app.use('*', authMiddleware());
// Resolve X-Device-Id into c.get('deviceId') for per-device settings
app.use('*', deviceMiddleware());

// --- Subscription Management ---
app.get('/api/subscriptions', handleListSubscriptions);
app.post('/api/subscriptions', handleAddSubscription);
app.delete('/api/subscriptions/:id', handleDeleteSubscription);
app.put('/api/subscriptions/:id/category', handleMoveSubscription);
app.put('/api/subscriptions/:id/enable', handleEnableSubscription);
app.put('/api/subscriptions/:id', handleUpdateSubscription);

// --- Category Management ---
app.get('/api/categories', handleListCategories);
app.post('/api/categories', handleCreateCategory);
app.put('/api/categories/:id', handleRenameCategory);
app.delete('/api/categories/:id', handleDeleteCategory);

// --- OPML Import/Export ---
app.post('/api/opml/import', handleImportOPML);
app.get('/api/opml/export', handleExportOPML);

// --- Articles ---
app.get('/api/articles', handleListArticles);
app.get('/api/articles/:id', handleGetArticle);
app.post('/api/articles/refresh', handleRefreshFeeds);
app.put('/api/articles/:id/read', handleUpdateReadState);

// --- Bookmarks (收藏) ---
app.get('/api/bookmarks', handleListBookmarks);
app.get('/api/articles/:id/bookmark', handleGetBookmarkState);
app.put('/api/articles/:id/bookmark', handleAddBookmark);
app.delete('/api/articles/:id/bookmark', handleRemoveBookmark);

// --- LLM Features ---
app.post('/api/llm/summarize', handleSummarizeArticle);
app.post('/api/llm/translate', handleTranslateArticle);
app.get('/api/llm/digest', handleGetDailyDigest);
app.post('/api/llm/digest/generate', handleGenerateDailyDigest);

// --- Config Management ---
app.get('/api/config/theme', handleGetTheme);
app.put('/api/config/theme', handleSetTheme);
app.get('/api/config/language', handleGetLanguage);
app.put('/api/config/language', handleSetLanguage);
app.get('/api/config/llm/assignments', handleGetLLMAssignments);
app.put('/api/config/llm/assignments', handleSetLLMAssignments);
app.get('/api/config/llm', handleListLLMConfigs);
app.post('/api/config/llm', handleCreateLLMConfig);
app.put('/api/config/llm/:id', handleUpdateLLMConfig);
app.delete('/api/config/llm/:id', handleDeleteLLMConfig);
app.post('/api/config/llm/:id/test', handleTestLLMConfig);
app.get('/api/config/github', handleGetGitHubConfig);
app.put('/api/config/github', handleSetGitHubConfig);
app.post('/api/config/github/test', handleTestGitHubConfig);
app.get('/api/config/tts', handleGetTTSConfig);
app.put('/api/config/tts', handleSetTTSConfig);
app.post('/api/config/tts/test', handleTestTTSConfig);
app.post('/api/tts/synthesis', handleTTSSynthesis);

// --- Auth / Password ---
app.get('/api/auth/password/status', handleGetPasswordStatus);
app.put('/api/auth/password', handleChangePassword);
app.post('/api/auth/password/reset', handleResetPassword);

// --- Static SPA Serving ---
// Static assets (public/ directory) and SPA fallback (index.html) are handled
// by Cloudflare Workers Assets configured in wrangler.toml:
//   [assets]
//   directory = "./public"
//   not_found_handling = "single-page-application"
//   run_worker_first = ["/api/*"]
//
// Non-API routes that don't match a static file are automatically served index.html.

// fetch: HTTP 路由（Hono app）；scheduled: 每小时定时刷新（见 src/scheduled.ts 与 wrangler.toml [triggers]）
export default {
  fetch: app.fetch,
  scheduled: handleScheduled,
};
