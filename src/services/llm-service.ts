/**
 * LLM Configuration Service - CRUD operations for LLM configs and function assignments.
 *
 * Handles:
 * - Creating, reading, updating, and deleting LLM configurations
 * - Encrypting API keys before storage, masking on read
 * - Managing function → LLM config assignments (summarize, translate)
 * - Validation (max 10 configs, HTTPS URLs, unique names)
 * - Testing LLM API connectivity
 */

import { encrypt, decrypt } from '../utils/crypto';
import { validationError, notFoundError, conflictError } from '../utils/errors';
import type { LLMConfig, LLMAssignment } from '../types';

const MAX_LLM_CONFIGS = 10;

// --- Input types ---

export interface CreateLLMConfigInput {
  name: string;
  baseUrl: string;
  apiKey: string;
  modelName: string;
}

export interface UpdateLLMConfigInput {
  name?: string;
  baseUrl?: string;
  apiKey?: string;
  modelName?: string;
}

// --- Helpers ---

/**
 * Masks an API key for safe display: shows only last 4 chars prefixed with '****'.
 */
function maskApiKey(apiKey: string): string {
  if (apiKey.length <= 4) {
    return '****';
  }
  return '****' + apiKey.slice(-4);
}

/**
 * Generates a random ID for new configs.
 */
function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Validates that a base URL uses HTTPS protocol.
 */
function validateBaseUrl(url: string): void {
  if (!url.startsWith('https://')) {
    throw validationError('Base URL must use HTTPS protocol (start with https://)');
  }
}

// --- CRUD Operations ---

/**
 * List all LLM configurations.
 * API keys are masked in the response (shows '****' + last 4 chars).
 */
export async function listLLMConfigs(db: D1Database, encKey: string): Promise<LLMConfig[]> {
  const rows = await db
    .prepare('SELECT id, name, base_url, api_key_encrypted, model_name, created_at FROM llm_configs ORDER BY created_at ASC')
    .all<{ id: string; name: string; base_url: string; api_key_encrypted: string; model_name: string; created_at: string }>();

  const configs: LLMConfig[] = [];
  for (const row of rows.results) {
    const decryptedKey = await decrypt(row.api_key_encrypted, encKey);
    configs.push({
      id: row.id,
      name: row.name,
      baseUrl: row.base_url,
      apiKey: maskApiKey(decryptedKey),
      modelName: row.model_name,
    });
  }

  return configs;
}

/**
 * Create a new LLM configuration.
 * Validates: max 10 configs, HTTPS base URL, non-empty API key, unique name.
 * Encrypts the API key before storage.
 */
export async function createLLMConfig(
  db: D1Database,
  encKey: string,
  data: CreateLLMConfigInput
): Promise<LLMConfig> {
  // Validate inputs
  if (!data.name || data.name.trim().length === 0) {
    throw validationError('Name is required');
  }
  if (!data.baseUrl || data.baseUrl.trim().length === 0) {
    throw validationError('Base URL is required');
  }
  validateBaseUrl(data.baseUrl);
  if (!data.apiKey || data.apiKey.trim().length === 0) {
    throw validationError('API key must not be empty');
  }
  if (!data.modelName || data.modelName.trim().length === 0) {
    throw validationError('Model name is required');
  }

  // Check max config limit
  const countRow = await db
    .prepare('SELECT COUNT(*) as count FROM llm_configs')
    .first<{ count: number }>();
  if (countRow && countRow.count >= MAX_LLM_CONFIGS) {
    throw validationError(`Maximum of ${MAX_LLM_CONFIGS} LLM configurations allowed`);
  }

  // Check name uniqueness
  const existing = await db
    .prepare('SELECT id FROM llm_configs WHERE name = ?')
    .bind(data.name.trim())
    .first();
  if (existing) {
    throw conflictError(`LLM config with name "${data.name.trim()}" already exists`);
  }

  // Encrypt API key
  const encryptedKey = await encrypt(data.apiKey, encKey);
  const id = generateId();

  await db
    .prepare('INSERT INTO llm_configs (id, name, base_url, api_key_encrypted, model_name) VALUES (?, ?, ?, ?, ?)')
    .bind(id, data.name.trim(), data.baseUrl.trim(), encryptedKey, data.modelName.trim())
    .run();

  return {
    id,
    name: data.name.trim(),
    baseUrl: data.baseUrl.trim(),
    apiKey: maskApiKey(data.apiKey),
    modelName: data.modelName.trim(),
  };
}

/**
 * Update an existing LLM configuration.
 * Only provided fields are updated. API key is re-encrypted if changed.
 */
export async function updateLLMConfig(
  db: D1Database,
  encKey: string,
  id: string,
  data: UpdateLLMConfigInput
): Promise<LLMConfig> {
  // Check config exists
  const existing = await db
    .prepare('SELECT id, name, base_url, api_key_encrypted, model_name FROM llm_configs WHERE id = ?')
    .bind(id)
    .first<{ id: string; name: string; base_url: string; api_key_encrypted: string; model_name: string }>();

  if (!existing) {
    throw notFoundError(`LLM config with id "${id}" not found`);
  }

  // Build updated values
  const updatedName = data.name !== undefined ? data.name.trim() : existing.name;
  const updatedBaseUrl = data.baseUrl !== undefined ? data.baseUrl.trim() : existing.base_url;
  const updatedModelName = data.modelName !== undefined ? data.modelName.trim() : existing.model_name;

  // Validate updated fields
  if (updatedName.length === 0) {
    throw validationError('Name cannot be empty');
  }
  if (updatedBaseUrl.length === 0) {
    throw validationError('Base URL cannot be empty');
  }
  validateBaseUrl(updatedBaseUrl);
  if (updatedModelName.length === 0) {
    throw validationError('Model name cannot be empty');
  }

  // Check name uniqueness (if name changed)
  if (data.name !== undefined && data.name.trim() !== existing.name) {
    const nameConflict = await db
      .prepare('SELECT id FROM llm_configs WHERE name = ? AND id != ?')
      .bind(updatedName, id)
      .first();
    if (nameConflict) {
      throw conflictError(`LLM config with name "${updatedName}" already exists`);
    }
  }

  // Handle API key
  let encryptedKey = existing.api_key_encrypted;
  let apiKeyForResponse: string;
  if (data.apiKey !== undefined) {
    if (data.apiKey.trim().length === 0) {
      throw validationError('API key must not be empty');
    }
    encryptedKey = await encrypt(data.apiKey, encKey);
    apiKeyForResponse = maskApiKey(data.apiKey);
  } else {
    const decryptedKey = await decrypt(existing.api_key_encrypted, encKey);
    apiKeyForResponse = maskApiKey(decryptedKey);
  }

  await db
    .prepare('UPDATE llm_configs SET name = ?, base_url = ?, api_key_encrypted = ?, model_name = ? WHERE id = ?')
    .bind(updatedName, updatedBaseUrl, encryptedKey, updatedModelName, id)
    .run();

  return {
    id,
    name: updatedName,
    baseUrl: updatedBaseUrl,
    apiKey: apiKeyForResponse,
    modelName: updatedModelName,
  };
}

/**
 * Delete an LLM configuration.
 * If the config is assigned to a function, the assignment is also removed.
 */
export async function deleteLLMConfig(db: D1Database, id: string): Promise<void> {
  // Check config exists
  const existing = await db
    .prepare('SELECT id FROM llm_configs WHERE id = ?')
    .bind(id)
    .first();

  if (!existing) {
    throw notFoundError(`LLM config with id "${id}" not found`);
  }

  // Remove any assignments referencing this config
  await db
    .prepare('DELETE FROM llm_assignments WHERE llm_config_id = ?')
    .bind(id)
    .run();

  // Delete the config
  await db
    .prepare('DELETE FROM llm_configs WHERE id = ?')
    .bind(id)
    .run();
}

// --- Assignment Operations ---

/**
 * Get current function → LLM config assignments.
 * Returns an object with summarize and translate fields (config ID or null).
 */
export async function getLLMAssignments(db: D1Database): Promise<LLMAssignment> {
  const rows = await db
    .prepare('SELECT function_name, llm_config_id FROM llm_assignments')
    .all<{ function_name: string; llm_config_id: string }>();

  const assignment: LLMAssignment = {
    summarize: null,
    translate: null,
  };

  for (const row of rows.results) {
    if (row.function_name === 'summarize') {
      assignment.summarize = row.llm_config_id;
    } else if (row.function_name === 'translate') {
      assignment.translate = row.llm_config_id;
    }
  }

  return assignment;
}

/**
 * Set function → LLM config assignments.
 * Validates that referenced config IDs exist.
 * Pass null to unassign a function.
 */
export async function setLLMAssignments(
  db: D1Database,
  assignments: LLMAssignment
): Promise<void> {
  // Validate that referenced config IDs exist
  const configIds = [assignments.summarize, assignments.translate].filter(
    (id): id is string => id !== null
  );

  for (const configId of configIds) {
    const exists = await db
      .prepare('SELECT id FROM llm_configs WHERE id = ?')
      .bind(configId)
      .first();
    if (!exists) {
      throw notFoundError(`LLM config with id "${configId}" not found`);
    }
  }

  // Clear existing assignments and insert new ones
  await db.prepare('DELETE FROM llm_assignments').run();

  if (assignments.summarize) {
    await db
      .prepare('INSERT INTO llm_assignments (function_name, llm_config_id) VALUES (?, ?)')
      .bind('summarize', assignments.summarize)
      .run();
  }

  if (assignments.translate) {
    await db
      .prepare('INSERT INTO llm_assignments (function_name, llm_config_id) VALUES (?, ?)')
      .bind('translate', assignments.translate)
      .run();
  }
}

// --- Connection Test ---

/**
 * Test connectivity to an LLM API endpoint.
 * Sends a minimal request to verify the base URL and API key work.
 */
export async function testLLMConnection(
  config: Pick<LLMConfig, 'baseUrl' | 'apiKey' | 'modelName'>
): Promise<{ success: boolean; message: string }> {
  try {
    const url = config.baseUrl.replace(/\/$/, '') + '/chat/completions';

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.modelName,
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 1,
      }),
    });

    if (response.ok) {
      return { success: true, message: 'Connection successful' };
    }

    const statusText = response.statusText || `HTTP ${response.status}`;
    return { success: false, message: `API returned error: ${statusText}` };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, message: `Connection failed: ${message}` };
  }
}
