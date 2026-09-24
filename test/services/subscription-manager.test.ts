import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import {
  listCategories,
  createCategory,
  renameCategory,
  deleteCategory,
  listSubscriptions,
  addSubscription,
  deleteSubscription,
  moveSubscription,
} from '../../src/services/subscription-manager';
import { AppError } from '../../src/utils/errors';
import { setupTestDatabase } from '../setup';

describe('Subscription Manager - Category CRUD', () => {
  let db: D1Database;

  beforeEach(async () => {
    db = env.DB;
    await setupTestDatabase(db);
  });

  describe('listCategories', () => {
    it('should return the default category initially', async () => {
      const categories = await listCategories(db);
      expect(categories).toHaveLength(1);
      expect(categories[0]).toEqual({ id: 'default', name: '未分类', order: 0 });
    });

    it('should return categories ordered by sort_order', async () => {
      await db.prepare("INSERT INTO categories (id, name, sort_order) VALUES ('cat-a', 'Alpha', 2)").run();
      await db.prepare("INSERT INTO categories (id, name, sort_order) VALUES ('cat-b', 'Beta', 1)").run();

      const categories = await listCategories(db);
      expect(categories).toHaveLength(3);
      expect(categories[0].id).toBe('default');
      expect(categories[1].id).toBe('cat-b');
      expect(categories[2].id).toBe('cat-a');
    });
  });

  describe('createCategory', () => {
    it('should create a category with a valid name', async () => {
      const category = await createCategory(db, 'Tech');
      expect(category.name).toBe('Tech');
      expect(category.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(category.order).toBeGreaterThan(0);
    });

    it('should create categories with incrementing sort_order', async () => {
      const cat1 = await createCategory(db, 'First');
      const cat2 = await createCategory(db, 'Second');
      expect(cat2.order).toBeGreaterThan(cat1.order);
    });

    it('should accept a 1-character name', async () => {
      const category = await createCategory(db, 'A');
      expect(category.name).toBe('A');
    });

    it('should accept a 50-character name', async () => {
      const name = 'A'.repeat(50);
      const category = await createCategory(db, name);
      expect(category.name).toBe(name);
    });

    it('should reject an empty name', async () => {
      await expect(createCategory(db, '')).rejects.toThrow(AppError);
      await expect(createCategory(db, '')).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
    });

    it('should reject a name longer than 50 characters', async () => {
      const name = 'A'.repeat(51);
      await expect(createCategory(db, name)).rejects.toThrow(AppError);
      await expect(createCategory(db, name)).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
    });
  });

  describe('renameCategory', () => {
    it('should rename an existing category', async () => {
      const cat = await createCategory(db, 'Old Name');
      const renamed = await renameCategory(db, cat.id, 'New Name');
      expect(renamed.name).toBe('New Name');
      expect(renamed.id).toBe(cat.id);
      expect(renamed.order).toBe(cat.order);
    });

    it('should persist the renamed value in the database', async () => {
      const cat = await createCategory(db, 'Original');
      await renameCategory(db, cat.id, 'Updated');

      const categories = await listCategories(db);
      const found = categories.find((c) => c.id === cat.id);
      expect(found?.name).toBe('Updated');
    });

    it('should reject renaming the default category', async () => {
      await expect(renameCategory(db, 'default', 'Something')).rejects.toThrow(AppError);
      await expect(renameCategory(db, 'default', 'Something')).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
    });

    it('should throw NOT_FOUND for non-existent category', async () => {
      await expect(renameCategory(db, 'non-existent-id', 'Name')).rejects.toThrow(AppError);
      await expect(renameCategory(db, 'non-existent-id', 'Name')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });

    it('should reject an invalid name on rename', async () => {
      const cat = await createCategory(db, 'Valid');
      await expect(renameCategory(db, cat.id, '')).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
      await expect(renameCategory(db, cat.id, 'X'.repeat(51))).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
    });
  });

  describe('deleteCategory', () => {
    it('should delete an existing category', async () => {
      const cat = await createCategory(db, 'ToDelete');
      await deleteCategory(db, cat.id);

      const categories = await listCategories(db);
      const found = categories.find((c) => c.id === cat.id);
      expect(found).toBeUndefined();
    });

    it('should move subscriptions to default on delete', async () => {
      const cat = await createCategory(db, 'Temporary');

      // Add subscriptions to the category
      await db
        .prepare("INSERT INTO subscriptions (id, url, title, category_id) VALUES ('sub-1', 'https://example.com/feed1', 'Feed 1', ?)")
        .bind(cat.id)
        .run();
      await db
        .prepare("INSERT INTO subscriptions (id, url, title, category_id) VALUES ('sub-2', 'https://example.com/feed2', 'Feed 2', ?)")
        .bind(cat.id)
        .run();

      await deleteCategory(db, cat.id);

      // Both subscriptions should now be in default category
      const sub1 = await db.prepare("SELECT category_id FROM subscriptions WHERE id = 'sub-1'").first<{ category_id: string }>();
      const sub2 = await db.prepare("SELECT category_id FROM subscriptions WHERE id = 'sub-2'").first<{ category_id: string }>();
      expect(sub1?.category_id).toBe('default');
      expect(sub2?.category_id).toBe('default');
    });

    it('should not affect subscriptions in other categories', async () => {
      const catA = await createCategory(db, 'Category A');
      const catB = await createCategory(db, 'Category B');

      await db
        .prepare("INSERT INTO subscriptions (id, url, title, category_id) VALUES ('sub-a', 'https://a.com/feed', 'Feed A', ?)")
        .bind(catA.id)
        .run();
      await db
        .prepare("INSERT INTO subscriptions (id, url, title, category_id) VALUES ('sub-b', 'https://b.com/feed', 'Feed B', ?)")
        .bind(catB.id)
        .run();

      await deleteCategory(db, catA.id);

      const subB = await db.prepare("SELECT category_id FROM subscriptions WHERE id = 'sub-b'").first<{ category_id: string }>();
      expect(subB?.category_id).toBe(catB.id);
    });

    it('should reject deleting the default category', async () => {
      await expect(deleteCategory(db, 'default')).rejects.toThrow(AppError);
      await expect(deleteCategory(db, 'default')).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
    });

    it('should throw NOT_FOUND for non-existent category', async () => {
      await expect(deleteCategory(db, 'does-not-exist')).rejects.toThrow(AppError);
      await expect(deleteCategory(db, 'does-not-exist')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });

    it('should preserve total subscription count after delete', async () => {
      const cat = await createCategory(db, 'Doomed');
      await db
        .prepare("INSERT INTO subscriptions (id, url, title, category_id) VALUES ('sub-x', 'https://x.com/feed', 'Feed X', ?)")
        .bind(cat.id)
        .run();

      const beforeCount = await db.prepare('SELECT COUNT(*) as count FROM subscriptions').first<{ count: number }>();

      await deleteCategory(db, cat.id);

      const afterCount = await db.prepare('SELECT COUNT(*) as count FROM subscriptions').first<{ count: number }>();
      expect(afterCount?.count).toBe(beforeCount?.count);
    });
  });
});


describe('Subscription Manager - Subscription CRUD', () => {
  let db: D1Database;

  beforeEach(async () => {
    db = env.DB;
    await setupTestDatabase(db);
    // Clear subscriptions from prior tests to ensure clean state
    await db.prepare('DELETE FROM subscriptions').run();
    // Clear non-default categories
    await db.prepare("DELETE FROM categories WHERE id != 'default'").run();
  });

  describe('listSubscriptions', () => {
    it('should return empty array when no subscriptions exist', async () => {
      const subscriptions = await listSubscriptions(db);
      expect(subscriptions).toHaveLength(0);
    });

    it('should return all subscriptions', async () => {
      await addSubscription(db, 'https://example.com/feed1', 'Feed 1');
      await addSubscription(db, 'https://example.com/feed2', 'Feed 2');

      const subscriptions = await listSubscriptions(db);
      expect(subscriptions).toHaveLength(2);
    });

    it('should map database fields to Subscription type correctly', async () => {
      const added = await addSubscription(db, 'https://example.com/rss', 'My Feed');

      const subscriptions = await listSubscriptions(db);
      expect(subscriptions[0]).toEqual({
        id: added.id,
        url: 'https://example.com/rss',
        title: 'My Feed',
        categoryId: 'default',
        createdAt: expect.any(String),
        lastFetchedAt: null,
        failCount: 0,
        disabled: false,
        unreadCount: 0,
      });
    });
  });

  describe('addSubscription', () => {
    it('should add a subscription with default category', async () => {
      const sub = await addSubscription(db, 'https://blog.example.com/feed', 'Example Blog');
      expect(sub.url).toBe('https://blog.example.com/feed');
      expect(sub.title).toBe('Example Blog');
      expect(sub.categoryId).toBe('default');
      expect(sub.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(sub.lastFetchedAt).toBeNull();
    });

    it('should add a subscription with a specified category', async () => {
      const cat = await createCategory(db, 'Tech');
      const sub = await addSubscription(db, 'https://tech.com/rss', 'Tech Feed', cat.id);
      expect(sub.categoryId).toBe(cat.id);
    });

    it('should reject duplicate URLs with CONFLICT error', async () => {
      await addSubscription(db, 'https://unique.com/feed', 'First');
      await expect(addSubscription(db, 'https://unique.com/feed', 'Second')).rejects.toThrow(AppError);
      await expect(addSubscription(db, 'https://unique.com/feed', 'Second')).rejects.toMatchObject({
        code: 'CONFLICT',
      });
    });

    it('should reject URLs without http:// or https://', async () => {
      await expect(addSubscription(db, 'ftp://example.com/feed', 'Bad')).rejects.toThrow(AppError);
      await expect(addSubscription(db, 'ftp://example.com/feed', 'Bad')).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
    });

    it('should reject URLs longer than 2048 characters', async () => {
      const longUrl = 'https://example.com/' + 'a'.repeat(2030);
      await expect(addSubscription(db, longUrl, 'Long')).rejects.toThrow(AppError);
      await expect(addSubscription(db, longUrl, 'Long')).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
    });

    it('should accept URLs with http://', async () => {
      const sub = await addSubscription(db, 'http://insecure.com/feed', 'HTTP Feed');
      expect(sub.url).toBe('http://insecure.com/feed');
    });

    it('should accept URLs exactly 2048 characters', async () => {
      const url = 'https://example.com/' + 'a'.repeat(2048 - 20);
      const sub = await addSubscription(db, url, 'Max Length');
      expect(sub.url).toBe(url);
    });
  });

  describe('deleteSubscription', () => {
    it('should delete an existing subscription', async () => {
      const sub = await addSubscription(db, 'https://delete-me.com/rss', 'Delete Me');
      await deleteSubscription(db, sub.id);

      const subscriptions = await listSubscriptions(db);
      expect(subscriptions).toHaveLength(0);
    });

    it('should throw NOT_FOUND for non-existent subscription', async () => {
      await expect(deleteSubscription(db, 'non-existent-id')).rejects.toThrow(AppError);
      await expect(deleteSubscription(db, 'non-existent-id')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });

    it('should only delete the specified subscription', async () => {
      const sub1 = await addSubscription(db, 'https://keep.com/feed', 'Keep');
      const sub2 = await addSubscription(db, 'https://remove.com/feed', 'Remove');
      await deleteSubscription(db, sub2.id);

      const subscriptions = await listSubscriptions(db);
      expect(subscriptions).toHaveLength(1);
      expect(subscriptions[0].id).toBe(sub1.id);
    });
  });

  describe('moveSubscription', () => {
    it('should move a subscription to a different category', async () => {
      const cat = await createCategory(db, 'News');
      const sub = await addSubscription(db, 'https://news.com/rss', 'News Feed');

      const moved = await moveSubscription(db, sub.id, cat.id);
      expect(moved.categoryId).toBe(cat.id);
      expect(moved.id).toBe(sub.id);
      expect(moved.url).toBe(sub.url);
    });

    it('should persist the move in the database', async () => {
      const cat = await createCategory(db, 'Science');
      const sub = await addSubscription(db, 'https://science.org/feed', 'Science');
      await moveSubscription(db, sub.id, cat.id);

      const subscriptions = await listSubscriptions(db);
      const found = subscriptions.find((s) => s.id === sub.id);
      expect(found?.categoryId).toBe(cat.id);
    });

    it('should throw NOT_FOUND for non-existent subscription', async () => {
      await expect(moveSubscription(db, 'bad-id', 'default')).rejects.toThrow(AppError);
      await expect(moveSubscription(db, 'bad-id', 'default')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });

    it('should throw NOT_FOUND for non-existent category', async () => {
      const sub = await addSubscription(db, 'https://orphan.com/rss', 'Orphan');
      await expect(moveSubscription(db, sub.id, 'no-such-category')).rejects.toThrow(AppError);
      await expect(moveSubscription(db, sub.id, 'no-such-category')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });

    it('should allow moving to the default category', async () => {
      const cat = await createCategory(db, 'Temp');
      const sub = await addSubscription(db, 'https://moveback.com/rss', 'Move Back', cat.id);

      const moved = await moveSubscription(db, sub.id, 'default');
      expect(moved.categoryId).toBe('default');
    });
  });
});
