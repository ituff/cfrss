/**
 * Auth handlers — change the access password.
 *
 * PUT /api/auth/password
 *   body: { currentPassword: string, newPassword: string }
 *
 * The current password is verified against the active credential, then the new
 * password is stored as a PBKDF2 hash in D1. `POST /api/auth/password/reset`
 * clears the custom password and restores the env AUTH_TOKEN.
 */

import type { Context } from 'hono';
import type { Env } from '../types';
import { AppError, validationError } from '../utils/errors';
import {
  hashPassword,
  verifyPassword,
  getStoredPasswordHash,
  setStoredPasswordHash,
  clearStoredPasswordHash,
  validateAuthToken,
  MIN_PASSWORD_LENGTH,
} from '../services/auth-service';

interface ChangePasswordBody {
  currentPassword?: unknown;
  newPassword?: unknown;
}

/**
 * PUT /api/auth/password
 *
 * Verifies the current password then persists the new one.
 * Returns 400 on validation failure, 401 when the current password is wrong.
 */
export async function handleChangePassword(c: Context<{ Bindings: Env }>) {
  const db = c.env.DB;
  const body = await c.req.json<ChangePasswordBody>().catch(() => ({}) as ChangePasswordBody);

  const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
  const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';

  if (!currentPassword) {
    const err = validationError('Current password is required.');
    return c.json(err.toJSON(), 400 as const);
  }

  if (!newPassword || newPassword.length < MIN_PASSWORD_LENGTH) {
    const err = validationError(`New password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    return c.json(err.toJSON(), 400 as const);
  }

  if (newPassword === currentPassword) {
    const err = validationError('New password must differ from the current password.');
    return c.json(err.toJSON(), 400 as const);
  }

  // Verify the caller knows the current credential
  const ok = await validateAuthToken(db, c.env.AUTH_TOKEN, currentPassword);
  if (!ok) {
    const err = new AppError('VALIDATION_ERROR', 'Current password is incorrect.', { retryable: false });
    return c.json(err.toJSON(), 401 as const);
  }

  const record = await hashPassword(newPassword);
  await setStoredPasswordHash(db, record);

  return c.json({ success: true });
}

/**
 * POST /api/auth/password/reset
 *
 * Clears the custom password so the env AUTH_TOKEN becomes valid again.
 * Intended as a recovery hatch; still requires the current credential.
 */
export async function handleResetPassword(c: Context<{ Bindings: Env }>) {
  const db = c.env.DB;
  const body = await c.req
    .json<{ currentPassword?: unknown }>()
    .catch(() => ({}) as { currentPassword?: unknown });

  const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
  if (!currentPassword) {
    const err = validationError('Current password is required.');
    return c.json(err.toJSON(), 400 as const);
  }

  const ok = await validateAuthToken(db, c.env.AUTH_TOKEN, currentPassword);
  if (!ok) {
    const err = new AppError('VALIDATION_ERROR', 'Current password is incorrect.', { retryable: false });
    return c.json(err.toJSON(), 401 as const);
  }

  await clearStoredPasswordHash(db);
  return c.json({ success: true });
}

/**
 * GET /api/auth/password/status
 *
 * Reports whether a custom password has been configured.
 * Never returns any secret material.
 */
export async function handleGetPasswordStatus(c: Context<{ Bindings: Env }>) {
  const stored = await getStoredPasswordHash(c.env.DB);
  return c.json({ hasCustomPassword: stored !== null, minLength: MIN_PASSWORD_LENGTH });
}

/** Re-exported for tests that need to check verification directly. */
export { verifyPassword };
