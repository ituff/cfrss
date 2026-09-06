import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './types';
import { authMiddleware } from './middleware/auth';
import { cpuMonitorMiddleware } from './middleware/cpu-monitor';
import { errorHandler } from './middleware/errorHandler';
import { handleGetTheme, handleSetTheme, handleGetLanguage, handleSetLanguage } from './handlers/config';
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
import { handleListArticles, handleGetArticle, handleRefreshFeeds } from './handlers/articles';
import { handleGetGitHubConfig, handleSetGitHubConfig, handleTestGitHubConfig } from './handlers/github-config';
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
app.use('*', cors());
app.use('*', cpuMonitorMiddleware());
app.use('*', authMiddleware());

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

// --- Static SPA Serving ---
// Static assets (public/ directory) and SPA fallback (index.html) are handled
// by Cloudflare Workers Assets configured in wrangler.toml:
//   [assets]
//   directory = "./public"
//   not_found_handling = "single-page-application"
//   run_worker_first = ["/api/*"]
//
// Non-API routes that don't match a static file are automatically served index.html.

export default app;
