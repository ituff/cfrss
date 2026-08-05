import type { Context } from 'hono';
import type { Env } from '../types';
import { listCategories, createCategory, renameCategory, deleteCategory } from '../services/subscription-manager';
import { validationError } from '../utils/errors';

/**
 * GET /api/categories
 *
 * Returns all categories ordered by sort_order.
 */
export async function handleListCategories(c: Context<{ Bindings: Env }>) {
  const db = c.env.DB;
  const categories = await listCategories(db);
  return c.json({ categories });
}

/**
 * POST /api/categories
 *
 * Creates a new category. Expects { name: string } in request body.
 * Returns 201 with the created category.
 */
export async function handleCreateCategory(c: Context<{ Bindings: Env }>) {
  const db = c.env.DB;
  const body = await c.req.json<{ name?: unknown }>();

  if (!body.name || typeof body.name !== 'string') {
    throw validationError('Missing or invalid "name" field. Must be a non-empty string.');
  }

  const category = await createCategory(db, body.name);
  return c.json({ category }, 201);
}

/**
 * PUT /api/categories/:id
 *
 * Renames an existing category. Expects { name: string } in request body.
 */
export async function handleRenameCategory(c: Context<{ Bindings: Env }>) {
  const db = c.env.DB;
  const id = c.req.param('id')!;
  const body = await c.req.json<{ name?: unknown }>();

  if (!body.name || typeof body.name !== 'string') {
    throw validationError('Missing or invalid "name" field. Must be a non-empty string.');
  }

  const category = await renameCategory(db, id, body.name);
  return c.json({ category });
}

/**
 * DELETE /api/categories/:id
 *
 * Deletes a category and moves its subscriptions to 'default'.
 */
export async function handleDeleteCategory(c: Context<{ Bindings: Env }>) {
  const db = c.env.DB;
  const id = c.req.param('id')!;

  await deleteCategory(db, id);
  return c.json({ success: true });
}
