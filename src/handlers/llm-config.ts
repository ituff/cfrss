/**
 * LLM Configuration Handlers - CRUD operations for LLM configs and assignments.
 *
 * Wraps the llm-service layer and handles HTTP request/response concerns:
 * - Parsing request bodies and path params
 * - Calling the appropriate service function
 * - Returning JSON responses
 */

import type { Context } from 'hono';
import type { Env } from '../types';
import {
  listLLMConfigs,
  createLLMConfig,
  updateLLMConfig,
  deleteLLMConfig,
  testLLMConnection,
  getLLMAssignments,
  setLLMAssignments,
} from '../services/llm-service';
import { decrypt } from '../utils/crypto';
import { validationError, notFoundError } from '../utils/errors';

/**
 * GET /api/config/llm
 * Lists all LLM configurations with masked API keys.
 */
export async function handleListLLMConfigs(c: Context<{ Bindings: Env }>) {
  const db = c.env.DB;
  const encKey = c.env.ENCRYPTION_KEY;
  const configs = await listLLMConfigs(db, encKey);
  return c.json({ configs });
}

/**
 * POST /api/config/llm
 * Creates a new LLM configuration.
 * Body: { name, baseUrl, apiKey, modelName }
 */
export async function handleCreateLLMConfig(c: Context<{ Bindings: Env }>) {
  const db = c.env.DB;
  const encKey = c.env.ENCRYPTION_KEY;
  const body = await c.req.json<{ name?: string; baseUrl?: string; apiKey?: string; modelName?: string }>();

  if (!body.name || !body.baseUrl || !body.apiKey || !body.modelName) {
    throw validationError('name, baseUrl, apiKey, and modelName are all required');
  }

  const config = await createLLMConfig(db, encKey, {
    name: body.name,
    baseUrl: body.baseUrl,
    apiKey: body.apiKey,
    modelName: body.modelName,
  });

  return c.json({ config }, 201);
}

/**
 * PUT /api/config/llm/:id
 * Updates an existing LLM configuration. Only provided fields are changed.
 * Body: { name?, baseUrl?, apiKey?, modelName? }
 */
export async function handleUpdateLLMConfig(c: Context<{ Bindings: Env }>) {
  const db = c.env.DB;
  const encKey = c.env.ENCRYPTION_KEY;
  const id = c.req.param('id')!;

  const body = await c.req.json<{ name?: string; baseUrl?: string; apiKey?: string; modelName?: string }>();

  const config = await updateLLMConfig(db, encKey, id, body);
  return c.json({ config });
}

/**
 * DELETE /api/config/llm/:id
 * Deletes an LLM configuration and any related assignments.
 */
export async function handleDeleteLLMConfig(c: Context<{ Bindings: Env }>) {
  const db = c.env.DB;
  const id = c.req.param('id')!;

  await deleteLLMConfig(db, id);
  return c.json({ success: true });
}

/**
 * POST /api/config/llm/:id/test
 * Tests connectivity to the LLM API for a given config.
 */
export async function handleTestLLMConfig(c: Context<{ Bindings: Env }>) {
  const db = c.env.DB;
  const encKey = c.env.ENCRYPTION_KEY;
  const id = c.req.param('id')!;

  // Fetch the config
  const row = await db
    .prepare('SELECT id, name, base_url, api_key_encrypted, model_name FROM llm_configs WHERE id = ?')
    .bind(id)
    .first<{ id: string; name: string; base_url: string; api_key_encrypted: string; model_name: string }>();

  if (!row) {
    throw notFoundError(`LLM config with id "${id}" not found`);
  }

  const apiKey = await decrypt(row.api_key_encrypted, encKey);

  const result = await testLLMConnection({
    baseUrl: row.base_url,
    apiKey,
    modelName: row.model_name,
  });

  return c.json(result);
}

/**
 * GET /api/config/llm/assignments
 * Returns the current function → LLM config assignments.
 */
export async function handleGetLLMAssignments(c: Context<{ Bindings: Env }>) {
  const db = c.env.DB;
  const assignments = await getLLMAssignments(db);
  return c.json({ assignments });
}

/**
 * PUT /api/config/llm/assignments
 * Sets the function → LLM config assignments.
 * Body: { summarize: string | null, translate: string | null }
 */
export async function handleSetLLMAssignments(c: Context<{ Bindings: Env }>) {
  const db = c.env.DB;
  const body = await c.req.json<{ summarize?: string | null; translate?: string | null }>();

  const assignments = {
    summarize: body.summarize ?? null,
    translate: body.translate ?? null,
  };

  await setLLMAssignments(db, assignments);
  return c.json({ success: true, assignments });
}
