import type { Context } from 'hono';
import type { Env } from '../types';
import {
  listSubscriptions,
  addSubscription,
  deleteSubscription,
  moveSubscription,
} from '../services/subscription-manager';
import { validateUrl, probeUrl } from '../utils/url-validator';
import { validationError } from '../utils/errors';

/**
 * GET /api/subscriptions
 *
 * Returns all subscriptions ordered by creation date.
 */
export async function handleListSubscriptions(c: Context<{ Bindings: Env }>) {
  const db = c.env.DB;
  const subscriptions = await listSubscriptions(db);
  return c.json({ subscriptions });
}

/**
 * POST /api/subscriptions
 *
 * Accepts { url: string, categoryId?: string } in the request body.
 * Validates URL format, probes the feed, then persists the subscription.
 */
export async function handleAddSubscription(c: Context<{ Bindings: Env }>) {
  const db = c.env.DB;
  const body = await c.req.json<{ url?: string; categoryId?: string }>();

  if (!body.url || typeof body.url !== 'string') {
    throw validationError('url is required and must be a string');
  }

  // Synchronous format validation
  const formatResult = validateUrl(body.url);
  if (!formatResult.valid) {
    throw validationError(formatResult.message);
  }

  // Async feed probe
  const probeResult = await probeUrl(body.url);
  if (!probeResult.valid) {
    throw validationError(probeResult.message, { reason: probeResult.reason });
  }

  const subscription = await addSubscription(
    db,
    body.url,
    probeResult.title,
    body.categoryId ?? 'default'
  );

  return c.json({ subscription }, 201);
}

/**
 * DELETE /api/subscriptions/:id
 *
 * Deletes a subscription by its ID.
 */
export async function handleDeleteSubscription(c: Context<{ Bindings: Env }>) {
  const db = c.env.DB;
  const id = c.req.param('id')!;

  await deleteSubscription(db, id);
  return c.json({ success: true });
}

/**
 * PUT /api/subscriptions/:id/category
 *
 * Moves a subscription to a different category.
 * Accepts { categoryId: string } in the request body.
 */
export async function handleMoveSubscription(c: Context<{ Bindings: Env }>) {
  const db = c.env.DB;
  const id = c.req.param('id')!;
  const body = await c.req.json<{ categoryId?: string }>();

  if (!body.categoryId || typeof body.categoryId !== 'string') {
    throw validationError('categoryId is required and must be a string');
  }

  const subscription = await moveSubscription(db, id, body.categoryId);
  return c.json({ subscription });
}
