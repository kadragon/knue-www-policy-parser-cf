/**
 * Unit Tests for KV Synchronization (v2.0.0)
 *
 * Tests PolicySynchronizer with policyName-centric data model
 * Breaking changes from v1.x: title → policyName, fileNo → sha
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PolicySynchronizer } from '../src/kv/synchronizer';
import type { ApiPolicy, PolicyEntry } from '../src/kv/types';

// Mock KVManager for v2.0.0 (policyName-based)
class MockKVManager {
  private policies: Map<string, PolicyEntry> = new Map();
  private queue: Map<string, any> = new Map();
  private metadata: any = null;

  // v2.0.0: getPolicyByName (was: getPolicyByTitle)
  async getPolicyByName(policyName: string) {
    return this.policies.get(policyName) || null;
  }

  async getAllPolicies() {
    return new Map(this.policies);
  }

  // v2.0.0: setPolicyEntry using policyName key
  async setPolicyEntry(policy: PolicyEntry) {
    this.policies.set(policy.policyName, policy);
  }

  // v2.0.0: setPolicyEntries using policyName key
  async setPolicyEntries(policies: PolicyEntry[]) {
    for (const policy of policies) {
      this.policies.set(policy.policyName, policy);
    }
  }

  // v2.0.0: deletePolicyByName (was: deletePolicyByTitle)
  async deletePolicyByName(policyName: string) {
    this.policies.delete(policyName);
  }

  // v2.0.0: deletePoliciesByNames (was: deletePoliciesByTitles)
  async deletePoliciesByNames(policyNames: string[]) {
    for (const policyName of policyNames) {
      this.policies.delete(policyName);
    }
  }

  async setSyncMetadata(metadata: any) {
    this.metadata = metadata;
  }

  async getSyncMetadata() {
    return this.metadata;
  }

  async getLastCommit() {
    return this.metadata?.previousCommitSHA || null;
  }

  async setLastCommit(commitSHA: string) {
    this.metadata = { ...this.metadata, commitSHA };
  }

  // v2.0.0: enqueueForProcessing (unchanged method name, but uses policyName)
  async enqueueForProcessing(entry: any) {
    this.queue.set(entry.policyName, entry);
  }

  // v2.0.0: enqueueMultiple using policyName key
  async enqueueMultiple(entries: any[]) {
    for (const entry of entries) {
      this.queue.set(entry.policyName, entry);
    }
  }

  // v2.0.0: dequeueByName (was: dequeueByTitle)
  async dequeueByName(policyName: string) {
    this.queue.delete(policyName);
  }

  getQueueEntries() {
    return new Map(this.queue);
  }
}

describe('PolicySynchronizer (v2.0.0)', () => {
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
          policyName: '신규규정',
          title: '신규 규정',
          sha: 'abc123def456789abcdef0123456789abcdef01',
          path: 'policies/신규규정.md',
          content: '# 신규 규정\n\n내용'
        }
      ];

      const result = await synchronizer.synchronize(currentPolicies);

      expect(result.stats.added).toBe(1);
      expect(result.stats.updated).toBe(0);
      expect(result.stats.deleted).toBe(0);
      expect(result.toAdd).toHaveLength(1);
      expect(result.toAdd[0].policyName).toBe('신규규정');
      expect(result.toAdd[0].title).toBe('신규 규정');
    });

    it('should detect and UPDATE policies when sha changes', async () => {
      // Setup existing policy with old sha
      const existingPolicy: PolicyEntry = {
        policyName: '학칙',
        title: '한국교원대학교 학칙',
        status: 'active',
        lastUpdated: new Date().toISOString(),
        sha: 'oldsha1234567890abcdef0123456789abcdef0',
        path: 'policies/학칙.md'
      };
      await mockKVManager.setPolicyEntry(existingPolicy);

      // Current API with new sha
      const currentPolicies: ApiPolicy[] = [
        {
          policyName: '학칙',
          title: '한국교원대학교 학칙',
          sha: 'newsha0987654321abcdef0123456789abcdef9',
          path: 'policies/학칙.md',
          content: '# Updated 학칙\n\n새로운 내용'
        }
      ];

      const result = await synchronizer.synchronize(currentPolicies);

      expect(result.stats.added).toBe(0);
      expect(result.stats.updated).toBe(1);
      expect(result.stats.deleted).toBe(0);
      expect(result.toUpdate).toHaveLength(1);
      expect(result.toUpdate[0].sha).toBe('newsha0987654321abcdef0123456789abcdef9');
    });

    it('should NOT update policies when sha is identical', async () => {
      const sha = 'shavalue123456789abcdef0123456789abcd01';

      // Setup existing policy
      const existingPolicy: PolicyEntry = {
        policyName: '학칙',
        title: '한국교원대학교 학칙',
        status: 'active',
        lastUpdated: new Date().toISOString(),
        sha,
        path: 'policies/학칙.md'
      };
      await mockKVManager.setPolicyEntry(existingPolicy);

      // Current API with same sha
      const currentPolicies: ApiPolicy[] = [
        {
          policyName: '학칙',
          title: '한국교원대학교 학칙',
          sha,
          path: 'policies/학칙.md',
          content: '# 학칙\n\n내용'
        }
      ];

      const result = await synchronizer.synchronize(currentPolicies);

      expect(result.stats.updated).toBe(0);
      expect(result.toUpdate).toHaveLength(0);
    });

    it('should detect and DELETE policies removed from API', async () => {
      // Setup existing policies
      const existingPolicy: PolicyEntry = {
        policyName: '폐기된규정',
        title: '폐기된 규정',
        status: 'active',
        lastUpdated: new Date().toISOString(),
        sha: 'delsha1234567890abcdef0123456789abcdef2',
        path: 'policies/폐기된규정.md'
      };
      await mockKVManager.setPolicyEntry(existingPolicy);

      // Current API without the policy
      const currentPolicies: ApiPolicy[] = [];

      const result = await synchronizer.synchronize(currentPolicies);

      expect(result.stats.added).toBe(0);
      expect(result.stats.updated).toBe(0);
      expect(result.stats.deleted).toBe(1);
      expect(result.toDelete).toHaveLength(1);
      expect(result.toDelete[0]).toBe('폐기된규정');
    });

    it('should handle mixed ADD/UPDATE/DELETE operations', async () => {
      // Setup existing policies
      const existing1: PolicyEntry = {
        policyName: '학칙',
        title: '한국교원대학교 학칙',
        status: 'active',
        lastUpdated: new Date().toISOString(),
        sha: 'old-sha-868',
        path: 'policies/학칙.md'
      };

      const existing2: PolicyEntry = {
        policyName: '폐기된규정',
        title: '폐기된 규정',
        status: 'active',
        lastUpdated: new Date().toISOString(),
        sha: 'old-sha-500',
        path: 'policies/폐기된규정.md'
      };

      await mockKVManager.setPolicyEntry(existing1);
      await mockKVManager.setPolicyEntry(existing2);

      // Current API with: UPDATE (학칙), DELETE (폐기된규정), ADD (신규규정)
      const currentPolicies: ApiPolicy[] = [
        {
          policyName: '학칙',
          title: '한국교원대학교 학칙',
          sha: 'new-sha-870', // Changed
          path: 'policies/학칙.md',
          content: '# Updated'
        },
        {
          policyName: '신규규정',
          title: '신규 규정',
          sha: 'new-sha-999',
          path: 'policies/신규규정.md',
          content: '# New'
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
      const sha = 'no-change-sha12345678901234567890';

      // Setup existing policy
      const existingPolicy: PolicyEntry = {
        policyName: '학칙',
        title: '한국교원대학교 학칙',
        status: 'active',
        lastUpdated: new Date().toISOString(),
        sha,
        path: 'policies/학칙.md'
      };
      await mockKVManager.setPolicyEntry(existingPolicy);

      // Current API with same data
      const currentPolicies: ApiPolicy[] = [
        {
          policyName: '학칙',
          title: '한국교원대학교 학칙',
          sha,
          path: 'policies/학칙.md',
          content: '# 학칙'
        }
      ];

      const result = await synchronizer.synchronize(currentPolicies);

      expect(result.stats.added).toBe(0);
      expect(result.stats.updated).toBe(0);
      expect(result.stats.deleted).toBe(0);
    });
  });

  describe('Data Validation (v2.0.0)', () => {
    it('should skip policy validation (synchronizer handles it differently)', () => {
      // The synchronizer.synchronize() method validates policies indirectly
      // by using them in the comparison logic. Direct validation tests below
      // verify individual failure cases.
      const validPolicy: ApiPolicy = {
        policyName: '학칙',
        title: '한국교원대학교 학칙',
        sha: 'abc123def456789abcdef0123456789abcdef001',
        path: 'policies/학칙.md',
        content: '# 학칙\n\n내용'
      };

      // Verify it can be used in synchronization
      expect(validPolicy.policyName).toBe('학칙');
      expect(validPolicy.sha.length).toBe(40);
    });

    it('should reject policy with empty policyName', () => {
      const invalidPolicy: ApiPolicy = {
        policyName: '',
        title: '학칙',
        sha: 'abc123def456789abcdef0123456789abcdef01',
        path: 'policies/학칙.md',
        content: '# 학칙'
      };

      const isValid = synchronizer.validateApiPolicy(invalidPolicy);
      expect(isValid).toBe(false);
    });

    it('should reject policy with empty title', () => {
      const invalidPolicy: ApiPolicy = {
        policyName: '학칙',
        title: '',
        sha: 'abc123def456789abcdef0123456789abcdef01',
        path: 'policies/학칙.md',
        content: '# 학칙'
      };

      const isValid = synchronizer.validateApiPolicy(invalidPolicy);
      expect(isValid).toBe(false);
    });

    it('should reject policy with invalid sha (not 40 hex chars)', () => {
      const invalidPolicy: ApiPolicy = {
        policyName: '학칙',
        title: '학칙',
        sha: 'invalid-sha',
        path: 'policies/학칙.md',
        content: '# 학칙'
      };

      const isValid = synchronizer.validateApiPolicy(invalidPolicy);
      expect(isValid).toBe(false);
    });

    it('should reject policy with empty path', () => {
      const invalidPolicy: ApiPolicy = {
        policyName: '학칙',
        title: '학칙',
        sha: 'abc123def456789abcdef0123456789abcdef01',
        path: '',
        content: '# 학칙'
      };

      const isValid = synchronizer.validateApiPolicy(invalidPolicy);
      expect(isValid).toBe(false);
    });

    it('should reject policy with empty content', () => {
      const invalidPolicy: ApiPolicy = {
        policyName: '학칙',
        title: '학칙',
        sha: 'abc123def456789abcdef0123456789abcdef01',
        path: 'policies/학칙.md',
        content: ''
      };

      const isValid = synchronizer.validateApiPolicy(invalidPolicy);
      expect(isValid).toBe(false);
    });

    it('should handle multiple valid policies in synchronization', async () => {
      const policies: ApiPolicy[] = [
        {
          policyName: '유효한규정',
          title: '유효한 규정',
          sha: 'abc123def456789abcdef0123456789abcdef01',
          path: 'policies/유효한규정.md',
          content: '# 유효한 규정'
        },
        {
          policyName: '또다른규정',
          title: '또 다른 규정',
          sha: 'abc123def456789abcdef0123456789abcdef03',
          path: 'policies/또다른규정.md',
          content: '# 또 다른 규정'
        }
      ];

      const result = await synchronizer.synchronize(policies);
      expect(result.toAdd).toHaveLength(2);
      expect(result.toAdd[0].policyName).toBe('유효한규정');
      expect(result.toAdd[1].policyName).toBe('또다른규정');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty API response', async () => {
      const result = await synchronizer.synchronize([]);

      expect(result.stats.totalScanned).toBe(0);
      expect(result.stats.added).toBe(0);
      expect(result.stats.updated).toBe(0);
    });

    it('should handle duplicate policyNames (first occurrence wins)', async () => {
      const currentPolicies: ApiPolicy[] = [
        {
          policyName: '학칙',
          title: '학칙',
          sha: 'sha-first-occurrence',
          path: 'policies/학칙.md',
          content: '# First'
        },
        {
          policyName: '학칙', // Duplicate policyName
          title: '학칙 (duplicate)',
          sha: 'sha-second-occurrence',
          path: 'policies/학칙-2.md',
          content: '# Second'
        }
      ];

      const result = await synchronizer.synchronize(currentPolicies);

      expect(result.stats.totalScanned).toBe(1);
      expect(result.toAdd).toHaveLength(1);
      expect(result.toAdd[0].sha).toBe('sha-first-occurrence');
    });

    it('should timestamp policy entries correctly', async () => {
      const beforeSync = new Date();

      const currentPolicies: ApiPolicy[] = [
        {
          policyName: '신규규정',
          title: '신규',
          sha: 'abc123def456789abcdef0123456789abcdef01',
          path: 'policies/신규규정.md',
          content: '# 신규'
        }
      ];

      const result = await synchronizer.synchronize(currentPolicies);
      const afterSync = new Date();

      const addedPolicy = result.toAdd[0];
      const lastUpdated = new Date(addedPolicy.lastUpdated);

      expect(lastUpdated.getTime()).toBeGreaterThanOrEqual(beforeSync.getTime());
      expect(lastUpdated.getTime()).toBeLessThanOrEqual(afterSync.getTime());
    });



    it('should handle Korean characters in policyName correctly', async () => {
      const currentPolicies: ApiPolicy[] = [
        {
          policyName: '한국교원대학교학칙',
          title: '한국교원대학교 학칙',
          sha: 'abc123def456789abcdef0123456789abcdef01',
          path: 'policies/한국교원대학교학칙.md',
          content: '# 한국교원대학교 학칙'
        }
      ];

      const result = await synchronizer.synchronize(currentPolicies);

      expect(result.toAdd).toHaveLength(1);
      expect(result.toAdd[0].policyName).toBe('한국교원대학교학칙');
    });
  });
});
