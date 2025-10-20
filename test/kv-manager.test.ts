/**
 * Unit Tests for KV Manager
 *
 * Tests for KVManager CRUD operations
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { KVManager } from '../src/kv/manager';
import type { PolicyEntry, SyncMetadata, QueueEntry } from '../src/kv/types';

// Mock KVNamespace implementation
class MockKVNamespace {
  private store: Map<string, string> = new Map();

  async get(key: string, options?: any): Promise<string | null> {
    return this.store.get(key) || null;
  }

  async put(key: string, value: string, options?: any): Promise<void> {
    this.store.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async list(options?: any): Promise<any> {
    const prefix = options?.prefix || '';
    const limit = options?.limit || 1000;

    const filteredKeys = Array.from(this.store.keys())
      .filter(key => key.startsWith(prefix))
      .slice(0, limit);

    return {
      keys: filteredKeys.map(name => ({ name, metadata: null })),
      list_complete: true,
      cacheStatus: null
    };
  }

  // Required by interface but not used in tests
  async getWithMetadata(): Promise<any> {
    throw new Error('Not implemented');
  }

  async putWithMetadata(): Promise<void> {
    throw new Error('Not implemented');
  }
}

describe('KVManager', () => {
  let kvManager: KVManager;
  let mockKVNamespace: MockKVNamespace;

  beforeEach(() => {
    mockKVNamespace = new MockKVNamespace();
    kvManager = new KVManager(mockKVNamespace as any);
  });

  describe('Policy Entry Operations', () => {
    it('should set and get a policy entry', async () => {
      const policy: PolicyEntry = {
        policyName: '학칙',
        title: '한국교원대학교 학칙',
        status: 'active',
        lastUpdated: new Date().toISOString(),
        sha: 'abc123def456',
        path: 'policies/학칙.md',
        fileNo: '868'
      };

      await kvManager.setPolicyEntry(policy);
      const retrieved = await kvManager.getPolicyByName('학칙');

      expect(retrieved).toEqual(policy);
    });

    it('should return null for non-existent policy', async () => {
      const retrieved = await kvManager.getPolicyByName('존재하지않는규정');
      expect(retrieved).toBeNull();
    });

    it('should set multiple policy entries', async () => {
      const policies: PolicyEntry[] = [
        {
          policyName: '학칙',
          title: '한국교원대학교 학칙',
          status: 'active',
          lastUpdated: new Date().toISOString(),
          sha: 'abc123def456',
          path: 'policies/학칙.md',
          fileNo: '868'
        },
        {
          policyName: '규정1',
          title: '규정 1',
          status: 'active',
          lastUpdated: new Date().toISOString(),
          sha: 'def456ghi789',
          path: 'policies/규정1.md',
          fileNo: '869'
        }
      ];

      await kvManager.setPolicyEntries(policies);

      const retrieved1 = await kvManager.getPolicyByName('학칙');
      const retrieved2 = await kvManager.getPolicyByName('규정1');

      expect(retrieved1).toEqual(policies[0]);
      expect(retrieved2).toEqual(policies[1]);
    });

    it('should get all policies', async () => {
      const policies: PolicyEntry[] = [
        {
          policyName: '학칙',
          title: '한국교원대학교 학칙',
          status: 'active',
          lastUpdated: new Date().toISOString(),
          sha: 'abc123def456',
          path: 'policies/학칙.md',
          fileNo: '868'
        },
        {
          policyName: '규정1',
          title: '규정 1',
          status: 'active',
          lastUpdated: new Date().toISOString(),
          sha: 'def456ghi789',
          path: 'policies/규정1.md',
          fileNo: '869'
        }
      ];

      await kvManager.setPolicyEntries(policies);
      const allPolicies = await kvManager.getAllPolicies();

      expect(allPolicies.size).toBe(2);
      expect(allPolicies.get('학칙')).toEqual(policies[0]);
      expect(allPolicies.get('규정1')).toEqual(policies[1]);
    });

    it('should delete a policy entry', async () => {
      const policy: PolicyEntry = {
        policyName: '학칙',
        title: '한국교원대학교 학칙',
        status: 'active',
        lastUpdated: new Date().toISOString(),
        sha: 'abc123def456',
        path: 'policies/학칙.md',
        fileNo: '868'
      };

      await kvManager.setPolicyEntry(policy);
      await kvManager.deletePolicyByName('학칙');

      const retrieved = await kvManager.getPolicyByName('학칙');
      expect(retrieved).toBeNull();
    });

    it('should delete multiple policy entries', async () => {
      const policies: PolicyEntry[] = [
        {
          policyName: '학칙',
          title: '한국교원대학교 학칙',
          status: 'active',
          lastUpdated: new Date().toISOString(),
          sha: 'abc123def456',
          path: 'policies/학칙.md',
          fileNo: '868'
        },
        {
          policyName: '규정1',
          title: '규정 1',
          status: 'active',
          lastUpdated: new Date().toISOString(),
          sha: 'def456ghi789',
          path: 'policies/규정1.md',
          fileNo: '869'
        }
      ];

      await kvManager.setPolicyEntries(policies);
      await kvManager.deletePoliciesByNames(['학칙', '규정1']);

      const retrieved1 = await kvManager.getPolicyByName('학칙');
      const retrieved2 = await kvManager.getPolicyByName('규정1');

      expect(retrieved1).toBeNull();
      expect(retrieved2).toBeNull();
    });
  });

  describe('Sync Metadata Operations', () => {
    it('should set and get sync metadata', async () => {
      const metadata: SyncMetadata = {
        timestamp: new Date().toISOString(),
        totalProcessed: 45,
        added: 2,
        updated: 3,
        deleted: 1,
        status: 'success',
        errorCount: 0
      };

      await kvManager.setSyncMetadata(metadata);
      const retrieved = await kvManager.getSyncMetadata();

      expect(retrieved).toEqual(metadata);
    });

    it('should return null for non-existent metadata', async () => {
      const retrieved = await kvManager.getSyncMetadata();
      expect(retrieved).toBeNull();
    });
  });

  describe('Queue Entry Operations', () => {
    it('should enqueue a single entry', async () => {
      const entry: QueueEntry = {
        policyName: '학칙',
        sha: 'abc123def456',
        operation: 'add',
        retryCount: 0,
        createdAt: new Date().toISOString(),
        errorMessage: null,
        fileNo: '868'
      };

      await kvManager.enqueueForProcessing(entry);
      const allEntries = await kvManager.getAllQueueEntries();

      expect(allEntries.size).toBe(1);
      expect(allEntries.get('학칙')).toEqual(entry);
    });

    it('should enqueue multiple entries', async () => {
      const entries: QueueEntry[] = [
        {
          policyName: '학칙',
          sha: 'abc123def456',
          operation: 'add',
          retryCount: 0,
          createdAt: new Date().toISOString(),
          errorMessage: null,
          fileNo: '868'
        },
        {
          policyName: '규정1',
          sha: 'def456ghi789',
          operation: 'update',
          retryCount: 0,
          createdAt: new Date().toISOString(),
          errorMessage: null,
          fileNo: '869'
        }
      ];

      await kvManager.enqueueMultiple(entries);
      const allEntries = await kvManager.getAllQueueEntries();

      expect(allEntries.size).toBe(2);
      expect(allEntries.get('학칙')).toEqual(entries[0]);
      expect(allEntries.get('규정1')).toEqual(entries[1]);
    });

    it('should get queue entry by policyName', async () => {
      const entry: QueueEntry = {
        policyName: '학칙',
        sha: 'abc123def456',
        operation: 'add',
        retryCount: 0,
        createdAt: new Date().toISOString(),
        errorMessage: null,
        fileNo: '868'
      };

      await kvManager.enqueueForProcessing(entry);
      const retrieved = await kvManager.getQueueEntry('학칙');

      expect(retrieved).toEqual(entry);
    });

    it('should dequeue an entry', async () => {
      const entry: QueueEntry = {
        policyName: '학칙',
        sha: 'abc123def456',
        operation: 'add',
        retryCount: 0,
        createdAt: new Date().toISOString(),
        errorMessage: null,
        fileNo: '868'
      };

      await kvManager.enqueueForProcessing(entry);
      await kvManager.dequeueByName('학칙');

      const retrieved = await kvManager.getQueueEntry('학칙');
      expect(retrieved).toBeNull();
    });
  });

  describe('Data Persistence', () => {
    it('should preserve JSON structure in storage', async () => {
      const policy: PolicyEntry = {
        policyName: '복잡한제목',
        title: '복잡한 제목 (특수문자: 한글, 숫자)',
        status: 'active',
        lastUpdated: '2025-10-19T16:00:00Z',
        sha: 'abc123def456',
        path: 'policies/복잡한제목.md',
        fileNo: '12345',
        previewUrl: 'https://example.com/preview?param=value&other=123',
        downloadUrl: 'https://example.com/download?file=test.pdf'
      };

      await kvManager.setPolicyEntry(policy);
      const retrieved = await kvManager.getPolicyByName('복잡한제목');

      expect(retrieved?.fileNo).toBe('12345');
      expect(retrieved?.previewUrl).toContain('param=value');
    });

    it('should handle unicode characters', async () => {
      const policy: PolicyEntry = {
        policyName: '학칙',
        title: '한국교원대학교 학칙 (修正)',
        status: 'active',
        lastUpdated: new Date().toISOString(),
        sha: 'abc123def456',
        path: 'policies/학칙.md',
        fileNo: '868'
      };

      await kvManager.setPolicyEntry(policy);
      const retrieved = await kvManager.getPolicyByName('학칙');

      expect(retrieved).toEqual(policy);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid JSON gracefully', async () => {
      // Simulate corrupted data by directly manipulating mock store
      (mockKVNamespace as any).store.set('policy:corrupted', 'invalid json {');

      const retrieved = await kvManager.getPolicyByName('corrupted');
      expect(retrieved).toBeNull();
    });

    it('should return empty map when no policies exist', async () => {
      const allPolicies = await kvManager.getAllPolicies();
      expect(allPolicies.size).toBe(0);
    });
  });
});
