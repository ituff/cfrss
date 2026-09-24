import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import {
  listLLMConfigs,
  createLLMConfig,
  updateLLMConfig,
  deleteLLMConfig,
  getLLMAssignments,
  setLLMAssignments,
  testLLMConnection,
} from '../../src/services/llm-service';
import { setupTestDatabase } from '../setup';
import { AppError } from '../../src/utils/errors';

const TEST_ENC_KEY = 'test-encryption-key-for-unit-tests';

describe('LLM Service', () => {
  let db: D1Database;

  beforeEach(async () => {
    db = env.DB;
    await setupTestDatabase(db);
    // Clean up LLM tables before each test to ensure isolation
    await db.prepare('DELETE FROM llm_assignments').run();
    await db.prepare('DELETE FROM llm_configs').run();
  });

  describe('createLLMConfig', () => {
    it('should create a new LLM config with encrypted API key', async () => {
      const result = await createLLMConfig(db, TEST_ENC_KEY, {
        name: 'OpenAI GPT-4',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-test-key-12345678',
        modelName: 'gpt-4',
      });

      expect(result.id).toBeDefined();
      expect(result.name).toBe('OpenAI GPT-4');
      expect(result.baseUrl).toBe('https://api.openai.com/v1');
      expect(result.apiKey).toBe('****5678');
      expect(result.modelName).toBe('gpt-4');
    });

    it('should store encrypted API key in database', async () => {
      const result = await createLLMConfig(db, TEST_ENC_KEY, {
        name: 'Test Config',
        baseUrl: 'https://api.example.com',
        apiKey: 'my-secret-key',
        modelName: 'model-1',
      });

      const row = await db
        .prepare('SELECT api_key_encrypted FROM llm_configs WHERE id = ?')
        .bind(result.id)
        .first<{ api_key_encrypted: string }>();

      expect(row).not.toBeNull();
      expect(row!.api_key_encrypted).not.toBe('my-secret-key');
      expect(row!.api_key_encrypted.length).toBeGreaterThan(0);
    });

    it('should reject non-HTTPS base URLs', async () => {
      await expect(
        createLLMConfig(db, TEST_ENC_KEY, {
          name: 'Bad URL',
          baseUrl: 'http://api.example.com',
          apiKey: 'sk-key',
          modelName: 'model',
        })
      ).rejects.toThrow('Base URL must use HTTPS');
    });

    it('should reject empty API key', async () => {
      await expect(
        createLLMConfig(db, TEST_ENC_KEY, {
          name: 'No Key',
          baseUrl: 'https://api.example.com',
          apiKey: '',
          modelName: 'model',
        })
      ).rejects.toThrow('API key must not be empty');
    });

    it('should reject empty name', async () => {
      await expect(
        createLLMConfig(db, TEST_ENC_KEY, {
          name: '',
          baseUrl: 'https://api.example.com',
          apiKey: 'sk-key',
          modelName: 'model',
        })
      ).rejects.toThrow('Name is required');
    });

    it('should reject duplicate names', async () => {
      await createLLMConfig(db, TEST_ENC_KEY, {
        name: 'Duplicate',
        baseUrl: 'https://api.example.com',
        apiKey: 'sk-key-1',
        modelName: 'model-1',
      });

      await expect(
        createLLMConfig(db, TEST_ENC_KEY, {
          name: 'Duplicate',
          baseUrl: 'https://api.other.com',
          apiKey: 'sk-key-2',
          modelName: 'model-2',
        })
      ).rejects.toThrow('already exists');
    });

    it('should enforce max 10 configs limit', async () => {
      // Create 10 configs
      for (let i = 0; i < 10; i++) {
        await createLLMConfig(db, TEST_ENC_KEY, {
          name: `Config ${i}`,
          baseUrl: 'https://api.example.com',
          apiKey: `sk-key-${i}`,
          modelName: 'model',
        });
      }

      // 11th should fail
      await expect(
        createLLMConfig(db, TEST_ENC_KEY, {
          name: 'Config 10',
          baseUrl: 'https://api.example.com',
          apiKey: 'sk-key-10',
          modelName: 'model',
        })
      ).rejects.toThrow('Maximum of 10');
    });

    it('should trim whitespace from inputs', async () => {
      const result = await createLLMConfig(db, TEST_ENC_KEY, {
        name: '  Trimmed Name  ',
        baseUrl: 'https://api.example.com  ',
        apiKey: 'sk-key',
        modelName: '  gpt-4  ',
      });

      expect(result.name).toBe('Trimmed Name');
      expect(result.baseUrl).toBe('https://api.example.com');
      expect(result.modelName).toBe('gpt-4');
    });
  });

  describe('listLLMConfigs', () => {
    it('should return empty array when no configs exist', async () => {
      const configs = await listLLMConfigs(db, TEST_ENC_KEY);
      expect(configs).toEqual([]);
    });

    it('should return all configs with masked API keys', async () => {
      await createLLMConfig(db, TEST_ENC_KEY, {
        name: 'Config A',
        baseUrl: 'https://api.a.com',
        apiKey: 'sk-key-aaaa',
        modelName: 'model-a',
      });
      await createLLMConfig(db, TEST_ENC_KEY, {
        name: 'Config B',
        baseUrl: 'https://api.b.com',
        apiKey: 'sk-key-bbbb',
        modelName: 'model-b',
      });

      const configs = await listLLMConfigs(db, TEST_ENC_KEY);
      expect(configs).toHaveLength(2);
      expect(configs[0].name).toBe('Config A');
      expect(configs[0].apiKey).toBe('****aaaa');
      expect(configs[1].name).toBe('Config B');
      expect(configs[1].apiKey).toBe('****bbbb');
    });
  });

  describe('updateLLMConfig', () => {
    it('should update config name', async () => {
      const created = await createLLMConfig(db, TEST_ENC_KEY, {
        name: 'Original',
        baseUrl: 'https://api.example.com',
        apiKey: 'sk-key-1234',
        modelName: 'gpt-4',
      });

      const updated = await updateLLMConfig(db, TEST_ENC_KEY, created.id, {
        name: 'Updated Name',
      });

      expect(updated.name).toBe('Updated Name');
      expect(updated.baseUrl).toBe('https://api.example.com');
      expect(updated.modelName).toBe('gpt-4');
    });

    it('should update API key and re-encrypt', async () => {
      const created = await createLLMConfig(db, TEST_ENC_KEY, {
        name: 'Test',
        baseUrl: 'https://api.example.com',
        apiKey: 'old-key-1234',
        modelName: 'gpt-4',
      });

      const updated = await updateLLMConfig(db, TEST_ENC_KEY, created.id, {
        apiKey: 'new-key-5678',
      });

      expect(updated.apiKey).toBe('****5678');
    });

    it('should throw NOT_FOUND for non-existent config', async () => {
      await expect(
        updateLLMConfig(db, TEST_ENC_KEY, 'non-existent-id', { name: 'X' })
      ).rejects.toThrow('not found');
    });

    it('should reject duplicate name on update', async () => {
      await createLLMConfig(db, TEST_ENC_KEY, {
        name: 'First',
        baseUrl: 'https://api.a.com',
        apiKey: 'sk-key-1',
        modelName: 'model',
      });
      const second = await createLLMConfig(db, TEST_ENC_KEY, {
        name: 'Second',
        baseUrl: 'https://api.b.com',
        apiKey: 'sk-key-2',
        modelName: 'model',
      });

      await expect(
        updateLLMConfig(db, TEST_ENC_KEY, second.id, { name: 'First' })
      ).rejects.toThrow('already exists');
    });

    it('should reject non-HTTPS base URL on update', async () => {
      const created = await createLLMConfig(db, TEST_ENC_KEY, {
        name: 'Test',
        baseUrl: 'https://api.example.com',
        apiKey: 'sk-key',
        modelName: 'model',
      });

      await expect(
        updateLLMConfig(db, TEST_ENC_KEY, created.id, { baseUrl: 'http://insecure.com' })
      ).rejects.toThrow('HTTPS');
    });

    it('should allow updating name to same value', async () => {
      const created = await createLLMConfig(db, TEST_ENC_KEY, {
        name: 'Same',
        baseUrl: 'https://api.example.com',
        apiKey: 'sk-key',
        modelName: 'model',
      });

      const updated = await updateLLMConfig(db, TEST_ENC_KEY, created.id, { name: 'Same' });
      expect(updated.name).toBe('Same');
    });
  });

  describe('deleteLLMConfig', () => {
    it('should delete an existing config', async () => {
      const created = await createLLMConfig(db, TEST_ENC_KEY, {
        name: 'To Delete',
        baseUrl: 'https://api.example.com',
        apiKey: 'sk-key',
        modelName: 'model',
      });

      await deleteLLMConfig(db, created.id);

      const configs = await listLLMConfigs(db, TEST_ENC_KEY);
      expect(configs).toHaveLength(0);
    });

    it('should throw NOT_FOUND for non-existent config', async () => {
      await expect(deleteLLMConfig(db, 'non-existent')).rejects.toThrow('not found');
    });

    it('should remove assignments when deleting an assigned config', async () => {
      const created = await createLLMConfig(db, TEST_ENC_KEY, {
        name: 'Assigned',
        baseUrl: 'https://api.example.com',
        apiKey: 'sk-key',
        modelName: 'model',
      });

      await setLLMAssignments(db, { summarize: created.id, translate: null });

      await deleteLLMConfig(db, created.id);

      const assignments = await getLLMAssignments(db);
      expect(assignments.summarize).toBeNull();
      expect(assignments.translate).toBeNull();
    });
  });

  describe('getLLMAssignments', () => {
    it('should return null assignments when none are set', async () => {
      const assignments = await getLLMAssignments(db);
      expect(assignments.summarize).toBeNull();
      expect(assignments.translate).toBeNull();
    });

    it('should return existing assignments', async () => {
      const config = await createLLMConfig(db, TEST_ENC_KEY, {
        name: 'Config',
        baseUrl: 'https://api.example.com',
        apiKey: 'sk-key',
        modelName: 'model',
      });

      await setLLMAssignments(db, { summarize: config.id, translate: config.id });

      const assignments = await getLLMAssignments(db);
      expect(assignments.summarize).toBe(config.id);
      expect(assignments.translate).toBe(config.id);
    });
  });

  describe('setLLMAssignments', () => {
    it('should set assignments for both functions', async () => {
      const config = await createLLMConfig(db, TEST_ENC_KEY, {
        name: 'Config',
        baseUrl: 'https://api.example.com',
        apiKey: 'sk-key',
        modelName: 'model',
      });

      await setLLMAssignments(db, { summarize: config.id, translate: config.id });

      const assignments = await getLLMAssignments(db);
      expect(assignments.summarize).toBe(config.id);
      expect(assignments.translate).toBe(config.id);
    });

    it('should allow partial assignments (one null)', async () => {
      const config = await createLLMConfig(db, TEST_ENC_KEY, {
        name: 'Config',
        baseUrl: 'https://api.example.com',
        apiKey: 'sk-key',
        modelName: 'model',
      });

      await setLLMAssignments(db, { summarize: config.id, translate: null });

      const assignments = await getLLMAssignments(db);
      expect(assignments.summarize).toBe(config.id);
      expect(assignments.translate).toBeNull();
    });

    it('should clear all assignments when both null', async () => {
      const config = await createLLMConfig(db, TEST_ENC_KEY, {
        name: 'Config',
        baseUrl: 'https://api.example.com',
        apiKey: 'sk-key',
        modelName: 'model',
      });

      await setLLMAssignments(db, { summarize: config.id, translate: config.id });
      await setLLMAssignments(db, { summarize: null, translate: null });

      const assignments = await getLLMAssignments(db);
      expect(assignments.summarize).toBeNull();
      expect(assignments.translate).toBeNull();
    });

    it('should throw NOT_FOUND for non-existent config ID', async () => {
      await expect(
        setLLMAssignments(db, { summarize: 'non-existent', translate: null })
      ).rejects.toThrow('not found');
    });

    it('should overwrite previous assignments', async () => {
      const configA = await createLLMConfig(db, TEST_ENC_KEY, {
        name: 'Config A',
        baseUrl: 'https://api.a.com',
        apiKey: 'sk-key-a',
        modelName: 'model-a',
      });
      const configB = await createLLMConfig(db, TEST_ENC_KEY, {
        name: 'Config B',
        baseUrl: 'https://api.b.com',
        apiKey: 'sk-key-b',
        modelName: 'model-b',
      });

      await setLLMAssignments(db, { summarize: configA.id, translate: configA.id });
      await setLLMAssignments(db, { summarize: configB.id, translate: configB.id });

      const assignments = await getLLMAssignments(db);
      expect(assignments.summarize).toBe(configB.id);
      expect(assignments.translate).toBe(configB.id);
    });
  });

  describe('testLLMConnection', () => {
    it('should return failure for unreachable endpoint', async () => {
      const result = await testLLMConnection({
        baseUrl: 'https://nonexistent.invalid',
        apiKey: 'sk-key',
        modelName: 'model',
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain('Connection failed');
    });
  });
});
