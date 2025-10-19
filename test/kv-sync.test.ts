/**
 * Unit Tests for KV Synchronization
 *
 * Tests for PolicySynchronizer and KVManager
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PolicySynchronizer } from '../src/kv/synchronizer';
import type { ApiPolicy, PolicyEntry } from '../src/kv/types';

// Mock KVManager for testing
class MockKVManager {
  private policies: Map<string, PolicyEntry> = new Map();
  private queue: Map<string, any> = new Map();
  private metadata: any = null;

  async getPolicyByTitle(title: string) {
    return this.policies.get(title) || null;
  }

  async getAllPolicies() {
    return new Map(this.policies);
  }

  async setPolicyEntry(policy: PolicyEntry) {
    this.policies.set(policy.title, policy);
  }

  async setPolicyEntries(policies: PolicyEntry[]) {
    for (const policy of policies) {
      this.policies.set(policy.title, policy);
    }
  }

  async deletePolicyByTitle(title: string) {
    this.policies.delete(title);
  }

  async deletePoliciesByTitles(titles: string[]) {
    for (const title of titles) {
      this.policies.delete(title);
    }
  }

  async setSyncMetadata(metadata: any) {
    this.metadata = metadata;
  }

  async getSyncMetadata() {
    return this.metadata;
  }

  async enqueueForProcessing(entry: any) {
    this.queue.set(entry.title, entry);
  }

  async enqueueMultiple(entries: any[]) {
    for (const entry of entries) {
      this.queue.set(entry.title, entry);
    }
  }

  async dequeueByTitle(title: string) {
    this.queue.delete(title);
  }

  getQueueEntries() {
    return new Map(this.queue);
  }
}

describe('PolicySynchronizer', () => {
  let synchronizer: PolicySynchronizer;
  let mockKVManager: MockKVManager;

  beforeEach(() => {
    mockKVManager = new MockKVManager();
    synchronizer = new PolicySynchronizer(mockKVManager as any);
  });

  describe('Synchronization Algorithm', () => {
    it('should detect and ADD new policies', async () => {
      const currentPolicies: ApiPolicy[] = [
        {
          title: '신규 규정',
          fileNo: '999',
          previewUrl: 'https://example.com/preview/999',
          downloadUrl: 'https://example.com/download/999'
        }
      ];

      const result = await synchronizer.synchronize(currentPolicies);

      expect(result.stats.added).toBe(1);
      expect(result.stats.updated).toBe(0);
      expect(result.stats.deleted).toBe(0);
      expect(result.toAdd).toHaveLength(1);
      expect(result.toAdd[0].title).toBe('신규 규정');
      expect(result.toAdd[0].fileNo).toBe('999');
    });

    it('should detect and UPDATE policies with changed fileNo', async () => {
      // Setup existing policy
      const existingPolicy: PolicyEntry = {
        title: '한국교원대학교 학칙',
        fileNo: '868',
        status: 'active',
        lastUpdated: new Date().toISOString(),
        previewUrl: 'https://example.com/preview/868',
        downloadUrl: 'https://example.com/download/868'
      };
      await mockKVManager.setPolicyEntry(existingPolicy);

      // Current API with changed fileNo
      const currentPolicies: ApiPolicy[] = [
        {
          title: '한국교원대학교 학칙',
          fileNo: '870',
          previewUrl: 'https://example.com/preview/870',
          downloadUrl: 'https://example.com/download/870'
        }
      ];

      const result = await synchronizer.synchronize(currentPolicies);

      expect(result.stats.added).toBe(0);
      expect(result.stats.updated).toBe(1);
      expect(result.stats.deleted).toBe(0);
      expect(result.toUpdate).toHaveLength(1);
      expect(result.toUpdate[0].fileNo).toBe('870');
    });

    it('should detect and DELETE policies removed from API', async () => {
      // Setup existing policies
      const existingPolicy: PolicyEntry = {
        title: '폐기된 규정',
        fileNo: '500',
        status: 'active',
        lastUpdated: new Date().toISOString(),
        previewUrl: 'https://example.com/preview/500',
        downloadUrl: 'https://example.com/download/500'
      };
      await mockKVManager.setPolicyEntry(existingPolicy);

      // Current API without the policy
      const currentPolicies: ApiPolicy[] = [];

      const result = await synchronizer.synchronize(currentPolicies);

      expect(result.stats.added).toBe(0);
      expect(result.stats.updated).toBe(0);
      expect(result.stats.deleted).toBe(1);
      expect(result.toDelete).toHaveLength(1);
      expect(result.toDelete[0]).toBe('폐기된 규정');
    });

    it('should handle mixed ADD/UPDATE/DELETE operations', async () => {
      // Setup existing policies
      const existing1: PolicyEntry = {
        title: '학칙',
        fileNo: '868',
        status: 'active',
        lastUpdated: new Date().toISOString(),
        previewUrl: 'https://example.com/preview/868',
        downloadUrl: 'https://example.com/download/868'
      };

      const existing2: PolicyEntry = {
        title: '폐기된규정',
        fileNo: '500',
        status: 'active',
        lastUpdated: new Date().toISOString(),
        previewUrl: 'https://example.com/preview/500',
        downloadUrl: 'https://example.com/download/500'
      };

      await mockKVManager.setPolicyEntry(existing1);
      await mockKVManager.setPolicyEntry(existing2);

      // Current API with: UPDATE (학칙), DELETE (폐기된규정), ADD (신규)
      const currentPolicies: ApiPolicy[] = [
        {
          title: '학칙',
          fileNo: '870', // Changed
          previewUrl: 'https://example.com/preview/870',
          downloadUrl: 'https://example.com/download/870'
        },
        {
          title: '신규규정',
          fileNo: '999',
          previewUrl: 'https://example.com/preview/999',
          downloadUrl: 'https://example.com/download/999'
        }
      ];

      const result = await synchronizer.synchronize(currentPolicies);

      expect(result.stats.added).toBe(1);
      expect(result.stats.updated).toBe(1);
      expect(result.stats.deleted).toBe(1);
      expect(result.toAdd).toHaveLength(1);
      expect(result.toUpdate).toHaveLength(1);
      expect(result.toDelete).toHaveLength(1);
    });

    it('should handle no changes scenario', async () => {
      // Setup existing policy
      const existingPolicy: PolicyEntry = {
        title: '학칙',
        fileNo: '868',
        status: 'active',
        lastUpdated: new Date().toISOString(),
        previewUrl: 'https://example.com/preview/868',
        downloadUrl: 'https://example.com/download/868'
      };
      await mockKVManager.setPolicyEntry(existingPolicy);

      // Current API with same data
      const currentPolicies: ApiPolicy[] = [
        {
          title: '학칙',
          fileNo: '868',
          previewUrl: 'https://example.com/preview/868',
          downloadUrl: 'https://example.com/download/868'
        }
      ];

      const result = await synchronizer.synchronize(currentPolicies);

      expect(result.stats.added).toBe(0);
      expect(result.stats.updated).toBe(0);
      expect(result.stats.deleted).toBe(0);
    });
  });

  describe('Data Validation', () => {
    it('should validate valid policy data', () => {
      const validPolicy: ApiPolicy = {
        title: '학칙',
        fileNo: '868',
        previewUrl: 'https://example.com/preview/868',
        downloadUrl: 'https://example.com/download/868'
      };

      const isValid = synchronizer.validateApiPolicy(validPolicy);
      expect(isValid).toBe(true);
    });

    it('should reject policy with empty title', () => {
      const invalidPolicy: ApiPolicy = {
        title: '',
        fileNo: '868',
        previewUrl: 'https://example.com/preview/868',
        downloadUrl: 'https://example.com/download/868'
      };

      const isValid = synchronizer.validateApiPolicy(invalidPolicy);
      expect(isValid).toBe(false);
    });

    it('should reject policy with invalid fileNo', () => {
      const invalidPolicy: ApiPolicy = {
        title: '학칙',
        fileNo: 'invalid',
        previewUrl: 'https://example.com/preview/868',
        downloadUrl: 'https://example.com/download/868'
      };

      const isValid = synchronizer.validateApiPolicy(invalidPolicy);
      expect(isValid).toBe(false);
    });

    it('should reject policy with missing URLs', () => {
      const invalidPolicy: ApiPolicy = {
        title: '학칙',
        fileNo: '868',
        previewUrl: '',
        downloadUrl: 'https://example.com/download/868'
      };

      const isValid = synchronizer.validateApiPolicy(invalidPolicy);
      expect(isValid).toBe(false);
    });

    it('should filter invalid policies', () => {
      const policies: ApiPolicy[] = [
        {
          title: '유효한규정',
          fileNo: '868',
          previewUrl: 'https://example.com/preview/868',
          downloadUrl: 'https://example.com/download/868'
        },
        {
          title: '',
          fileNo: '869',
          previewUrl: 'https://example.com/preview/869',
          downloadUrl: 'https://example.com/download/869'
        },
        {
          title: '또다른규정',
          fileNo: '870',
          previewUrl: 'https://example.com/preview/870',
          downloadUrl: 'https://example.com/download/870'
        }
      ];

      const filtered = synchronizer.validateAndFilterPolicies(policies);
      expect(filtered).toHaveLength(2);
      expect(filtered[0].title).toBe('유효한규정');
      expect(filtered[1].title).toBe('또다른규정');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty API response', async () => {
      const result = await synchronizer.synchronize([]);

      expect(result.stats.totalScanned).toBe(0);
      expect(result.stats.added).toBe(0);
      expect(result.stats.updated).toBe(0);
    });

    it('should handle duplicate titles (first occurrence wins)', async () => {
      const currentPolicies: ApiPolicy[] = [
        {
          title: '학칙',
          fileNo: '868',
          previewUrl: 'https://example.com/preview/868',
          downloadUrl: 'https://example.com/download/868'
        },
        {
          title: '학칙', // Duplicate
          fileNo: '869',
          previewUrl: 'https://example.com/preview/869',
          downloadUrl: 'https://example.com/download/869'
        }
      ];

      const result = await synchronizer.synchronize(currentPolicies);

      expect(result.stats.totalScanned).toBe(1); // Only first title counted
      expect(result.toAdd).toHaveLength(1);
      expect(result.toAdd[0].fileNo).toBe('868');
    });

    it('should timestamp policy entries correctly', async () => {
      const beforeSync = new Date();

      const currentPolicies: ApiPolicy[] = [
        {
          title: '신규규정',
          fileNo: '999',
          previewUrl: 'https://example.com/preview/999',
          downloadUrl: 'https://example.com/download/999'
        }
      ];

      const result = await synchronizer.synchronize(currentPolicies);
      const afterSync = new Date();

      const addedPolicy = result.toAdd[0];
      const lastUpdated = new Date(addedPolicy.lastUpdated);

      expect(lastUpdated.getTime()).toBeGreaterThanOrEqual(beforeSync.getTime());
      expect(lastUpdated.getTime()).toBeLessThanOrEqual(afterSync.getTime());
    });
  });
});
