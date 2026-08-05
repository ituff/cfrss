/**
 * GitHub Config API handlers.
 *
 * GET  /api/config/github      → handleGetGitHubConfig
 * PUT  /api/config/github      → handleSetGitHubConfig
 * POST /api/config/github/test → handleTestGitHubConfig
 *
 * Config is stored as key-value pairs in the D1 `config` table:
 *   github_repo_owner, github_repo_name, github_token_encrypted, github_branch, github_content_path
 */

import type { Context } from 'hono';
import type { Env } from '../types';
import { getConfig, setConfig } from '../services/config-store';
import { encrypt, decrypt } from '../utils/crypto';
import { validationError, upstreamError } from '../utils/errors';

// Config keys used in D1
const KEYS = {
  repoOwner: 'github_repo_owner',
  repoName: 'github_repo_name',
  token: 'github_token_encrypted',
  branch: 'github_branch',
  contentPath: 'github_content_path',
} as const;

/**
 * Masks a token string, showing only the last 4 characters.
 * Returns asterisks if the token is too short.
 */
function maskToken(token: string): string {
  if (token.length <= 4) {
    return '****';
  }
  return '*'.repeat(token.length - 4) + token.slice(-4);
}

/**
 * GET /api/config/github
 *
 * Returns the stored GitHub configuration with the token masked.
 * Returns null fields if not yet configured.
 */
export async function handleGetGitHubConfig(c: Context<{ Bindings: Env }>) {
  const db = c.env.DB;
  const encryptionKey = c.env.ENCRYPTION_KEY;

  const [repoOwner, repoName, tokenEncrypted, branch, contentPath] = await Promise.all([
    getConfig(db, KEYS.repoOwner),
    getConfig(db, KEYS.repoName),
    getConfig(db, KEYS.token),
    getConfig(db, KEYS.branch),
    getConfig(db, KEYS.contentPath),
  ]);

  let maskedToken: string | null = null;
  if (tokenEncrypted) {
    try {
      const plainToken = await decrypt(tokenEncrypted, encryptionKey);
      maskedToken = maskToken(plainToken);
    } catch {
      // If decryption fails, indicate token is set but unreadable
      maskedToken = '****';
    }
  }

  return c.json({
    repoOwner: repoOwner ?? null,
    repoName: repoName ?? null,
    token: maskedToken,
    branch: branch ?? 'main',
    contentPath: contentPath ?? 'articles',
  });
}

/**
 * PUT /api/config/github
 *
 * Accepts { repoOwner, repoName, token, branch?, contentPath? } in the request body.
 * Encrypts the token and stores all values in the config table.
 * Returns 400 if required fields are missing.
 */
export async function handleSetGitHubConfig(c: Context<{ Bindings: Env }>) {
  const db = c.env.DB;
  const encryptionKey = c.env.ENCRYPTION_KEY;

  const body = await c.req.json<{
    repoOwner?: string;
    repoName?: string;
    token?: string;
    branch?: string;
    contentPath?: string;
  }>();

  // Validate required fields
  if (!body.repoOwner || typeof body.repoOwner !== 'string' || !body.repoOwner.trim()) {
    const err = validationError('repoOwner is required and must be a non-empty string.');
    return c.json(err.toJSON(), 400 as const);
  }

  if (!body.repoName || typeof body.repoName !== 'string' || !body.repoName.trim()) {
    const err = validationError('repoName is required and must be a non-empty string.');
    return c.json(err.toJSON(), 400 as const);
  }

  if (!body.token || typeof body.token !== 'string' || !body.token.trim()) {
    const err = validationError('token is required and must be a non-empty string.');
    return c.json(err.toJSON(), 400 as const);
  }

  const repoOwner = body.repoOwner.trim();
  const repoName = body.repoName.trim();
  const token = body.token.trim();
  const branch = (body.branch && body.branch.trim()) || 'main';
  const contentPath = (body.contentPath && body.contentPath.trim()) || 'articles';

  // Encrypt the token before storage
  const encryptedToken = await encrypt(token, encryptionKey);

  // Store all config values
  await Promise.all([
    setConfig(db, KEYS.repoOwner, repoOwner),
    setConfig(db, KEYS.repoName, repoName),
    setConfig(db, KEYS.token, encryptedToken),
    setConfig(db, KEYS.branch, branch),
    setConfig(db, KEYS.contentPath, contentPath),
  ]);

  return c.json({
    success: true,
    repoOwner,
    repoName,
    token: maskToken(token),
    branch,
    contentPath,
  });
}

/**
 * POST /api/config/github/test
 *
 * Tests the stored GitHub configuration by making an API call to
 * GET /repos/{owner}/{repo} using the stored token.
 * Returns { success: true/false, message: string }.
 */
export async function handleTestGitHubConfig(c: Context<{ Bindings: Env }>) {
  const db = c.env.DB;
  const encryptionKey = c.env.ENCRYPTION_KEY;

  // Read stored config
  const [repoOwner, repoName, tokenEncrypted] = await Promise.all([
    getConfig(db, KEYS.repoOwner),
    getConfig(db, KEYS.repoName),
    getConfig(db, KEYS.token),
  ]);

  if (!repoOwner || !repoName || !tokenEncrypted) {
    return c.json({
      success: false,
      message: 'GitHub configuration is incomplete. Please save configuration first.',
    }, 400 as const);
  }

  let token: string;
  try {
    token = await decrypt(tokenEncrypted, encryptionKey);
  } catch {
    return c.json({
      success: false,
      message: 'Failed to decrypt stored token. Please re-save configuration.',
    }, 500 as const);
  }

  // Test GitHub API access by fetching repository info
  try {
    const response = await fetch(`https://api.github.com/repos/${repoOwner}/${repoName}`, {
      method: 'GET',
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'CFRSS-Reader',
      },
    });

    if (response.ok) {
      const repo = (await response.json()) as { permissions?: { push?: boolean } };
      const hasPush = repo.permissions?.push === true;

      if (hasPush) {
        return c.json({
          success: true,
          message: 'Connection successful. Token has read/write access to the repository.',
        });
      } else {
        return c.json({
          success: false,
          message: 'Token can access the repository but lacks write (push) permission. Please use a token with repo or contents:write scope.',
        });
      }
    }

    if (response.status === 401) {
      return c.json({
        success: false,
        message: 'Authentication failed. The token is invalid or expired.',
      });
    }

    if (response.status === 403) {
      return c.json({
        success: false,
        message: 'Access forbidden. The token does not have sufficient permissions for this repository.',
      });
    }

    if (response.status === 404) {
      return c.json({
        success: false,
        message: `Repository "${repoOwner}/${repoName}" not found. Check the owner/name or ensure the token has access to this repository.`,
      });
    }

    return c.json({
      success: false,
      message: `GitHub API returned unexpected status ${response.status}: ${response.statusText}`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({
      success: false,
      message: `Failed to connect to GitHub API: ${message}`,
    });
  }
}
