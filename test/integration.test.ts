/**
 * Integration Tests for Full Cron Workflow
 *
 * Tests the complete synchronization workflow from API fetch to KV update
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PolicySynchronizer } from '../src/kv/synchronizer';
import type { ApiPolicy, PolicyEntry, SyncResult } from '../src/kv/types';

// Mock KVManager
class IntegrationMockKVManager {
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
    // v2.0.0: Use policyName as the key instead of title
    this.policies.set(policy.policyName, policy);
  }

  async setPolicyEntries(policies: PolicyEntry[]) {
    for (const policy of policies) {
      // v2.0.0: Use policyName as the key instead of title
      this.policies.set(policy.policyName, policy);
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

  // v2.0.0: New method name using policyName
  async deletePoliciesByNames(policyNames: string[]) {
    for (const policyName of policyNames) {
      // Find and delete the policy by policyName
      for (const [key, policy] of this.policies.entries()) {
        if ((policy as any).policyName === policyName) {
          this.policies.delete(key);
          break;
        }
      }
    }
  }

  async setSyncMetadata(metadata: any) {
    this.metadata = metadata;
  }

  async getSyncMetadata() {
    return this.metadata;
  }

  async enqueueForProcessing(entry: any) {
    // v2.0.0: Use policyName as the key instead of title
    this.queue.set(entry.policyName, entry);
  }

  async enqueueMultiple(entries: any[]) {
    for (const entry of entries) {
      // v2.0.0: Use policyName as the key instead of title
      this.queue.set(entry.policyName, entry);
    }
  }

  async dequeueByTitle(title: string) {
    this.queue.delete(title);
  }

  // v2.0.0: New method name using policyName
  async dequeueByName(policyName: string) {
    // Find and delete the queue entry by policyName
    for (const [key, entry] of this.queue.entries()) {
      if ((entry as any).policyName === policyName) {
        this.queue.delete(key);
        break;
      }
    }
  }

  async getAllQueueEntries() {
    return new Map(this.queue);
  }

  // Inspection methods for testing
  getPoliciesSnapshot() {
    return new Map(this.policies);
  }

  getQueueSnapshot() {
    return new Map(this.queue);
  }

  getMetadataSnapshot() {
    return this.metadata;
  }
}

describe('Full Cron Workflow Integration', () => {
  let synchronizer: PolicySynchronizer;
  let kvManager: IntegrationMockKVManager;

  // Helper to create test ApiPolicy objects (v2.0.0 structure)
  const createTestPolicy = (i: number, title?: string, customFileNo?: string): ApiPolicy => {
    const policyName = `정책_${i + 1}`;
    const fileNo = customFileNo || `${1000 + i}`;
    return {
      policyName,
      title: title || `규정_${i + 1}`,
      sha: `sha_${fileNo}`,
      path: `policies/${policyName}.md`,
      content: `# ${title || `규정_${i + 1}`}\n\n정책 내용`,
      fileNo  // Optional for backward compatibility
    };
  };

  beforeEach(() => {
    kvManager = new IntegrationMockKVManager();
    synchronizer = new PolicySynchronizer(kvManager as any);
  });

  describe('Day 1: Initial Sync with 50 Policies', () => {
    it('should import 50 new policies on first run', async () => {
      // Simulate 50 policies from API (v2.0.0: GitHub-based structure)
      const apiPolicies: ApiPolicy[] = Array.from({ length: 50 }, (_, i) => createTestPolicy(i));

      const result = await synchronizer.synchronize(apiPolicies);

      // Verify results
      expect(result.stats.totalScanned).toBe(50);
      expect(result.stats.added).toBe(50);
      expect(result.stats.updated).toBe(0);
      expect(result.stats.deleted).toBe(0);

      // Verify KV state
      const policies = kvManager.getPoliciesSnapshot();
      expect(policies.size).toBe(50);

      // Verify queue state
      const queue = kvManager.getQueueSnapshot();
      expect(queue.size).toBe(50);

      // Verify all operations are 'add'
      for (const [_, entry] of queue) {
        expect(entry.operation).toBe('add');
      }

      // Note: Metadata recording happens in index.ts scheduled handler, not in synchronizer
    });
  });

  describe('Day 2: Add 2 New, Update 3, No Deletes', () => {
    it('should correctly detect changes on second run', async () => {
      // Day 1: Initial 50 policies
      const initialPolicies: ApiPolicy[] = Array.from({ length: 50 }, (_, i) => createTestPolicy(i));

      await synchronizer.synchronize(initialPolicies);

      // Day 2: 50 existing + 2 new + 3 updated
      const day2Policies: ApiPolicy[] = [
        // 45 unchanged
        ...Array.from({ length: 45 }, (_, i) => createTestPolicy(i)),
        // 3 updated fileNo (규정_46, 규정_47, 규정_48)
        createTestPolicy(45, '규정_46', '2000'),
        createTestPolicy(46, '규정_47', '2001'),
        createTestPolicy(47, '규정_48', '2002'),
        // 2 unchanged (규정_49, 규정_50)
        createTestPolicy(48, '규정_49', '1048'),
        createTestPolicy(49, '규정_50', '1049'),
        // 2 new policies
        {
          policyName: '신규정책_1',
          title: '신규규정_1',
          sha: 'sha_3000',
          path: 'policies/신규정책_1.md',
          content: '# 신규규정_1\n\n새로운 정책',
          fileNo: '3000'
        },
        {
          policyName: '신규정책_2',
          title: '신규규정_2',
          sha: 'sha_3001',
          path: 'policies/신규정책_2.md',
          content: '# 신규규정_2\n\n새로운 정책',
          fileNo: '3001'
        }
      ];

      const result = await synchronizer.synchronize(day2Policies);

      // Verify results
      expect(result.stats.totalScanned).toBe(52);
      expect(result.stats.added).toBe(2);
      expect(result.stats.updated).toBe(3);
      expect(result.stats.deleted).toBe(0);

      // Verify KV state
      const policies = kvManager.getPoliciesSnapshot();
      expect(policies.size).toBe(52);

      // Verify specific updates
      const updated46 = policies.get('규정_46');
      expect(updated46?.fileNo).toBe('2000');

      // Verify new policies exist
      const new1 = policies.get('신규규정_1');
      expect(new1).toBeDefined();
      expect(new1?.fileNo).toBe('3000');

      // Verify queue has correct operations
      // Queue contains entries from both syncs. First sync created 50, second sync updated/added 5
      // Updated entries overwrite existing queue entries, so we have:
      // - 45 unchanged (from first sync, not modified)
      // - 3 updated (규정_46, 47, 48 - overwritten with 'update' operation)
      // - 2 new (신규규정_1, 2)
      // Total: 45 + 3 + 2 = 50
      const queue = kvManager.getQueueSnapshot();
      expect(queue.size).toBeGreaterThanOrEqual(5); // At least the modified/new entries

      const adds = Array.from(queue.values()).filter(e => e.operation === 'add');
      const updates = Array.from(queue.values()).filter(e => e.operation === 'update');
      expect(adds.length).toBeGreaterThanOrEqual(2); // At least 2 new policies
      expect(updates.length).toBeGreaterThanOrEqual(3); // At least 3 updated policies
    });
  });

  describe('Day 3: Delete 5 Policies', () => {
    it('should correctly delete policies removed from API', async () => {
      // Day 1: Initial 10 policies
      const initialPolicies: ApiPolicy[] = Array.from({ length: 10 }, (_, i) => createTestPolicy(i));

      await synchronizer.synchronize(initialPolicies);

      // Day 3: Only 5 policies remain (규정_1 to 규정_5)
      const day3Policies: ApiPolicy[] = Array.from({ length: 5 }, (_, i) => createTestPolicy(i));

      const result = await synchronizer.synchronize(day3Policies);

      // Verify results
      expect(result.stats.deleted).toBe(5);
      expect(result.toDelete).toEqual([
        '규정_6',
        '규정_7',
        '규정_8',
        '규정_9',
        '규정_10'
      ]);

      // Verify KV state
      const policies = kvManager.getPoliciesSnapshot();
      expect(policies.size).toBe(5);

      // Verify deleted policies don't exist
      expect(policies.get('규정_6')).toBeUndefined();
      expect(policies.get('규정_10')).toBeUndefined();

      // Verify remaining policies exist
      expect(policies.get('규정_1')).toBeDefined();
      expect(policies.get('규정_5')).toBeDefined();
    });
  });

  describe('Data Consistency', () => {
    it('should maintain data consistency through multiple operations', async () => {
      // Run multiple sync cycles with same policies but changing fileNo
      const cycles = 3;

      for (let cycle = 0; cycle < cycles; cycle++) {
        const policies: ApiPolicy[] = Array.from({ length: 20 }, (_, i) =>
          createTestPolicy(i, undefined, `${2000 + i + cycle * 100}`)
        );

        const result = await synchronizer.synchronize(policies);
        if (cycle === 0) {
          expect(result.toAdd).toHaveLength(20);
        } else {
          expect(result.toUpdate).toHaveLength(20);
        }

        // Verify all policies have required fields
        const allPolicies = kvManager.getPoliciesSnapshot();
        for (const [_, policy] of allPolicies) {
          expect(policy.title).toBeDefined();
          expect(policy.fileNo).toBeDefined();
          expect(policy.status).toBe('active');
          expect(policy.lastUpdated).toBeDefined();
          expect(policy.previewUrl).toBeDefined();
          expect(policy.downloadUrl).toBeDefined();
        }
      }

      const finalPolicies = kvManager.getPoliciesSnapshot();
      expect(finalPolicies.size).toBe(20); // Same 20 policies updated 3 times
    });

    it('should idempotently handle repeated syncs', async () => {
      const policies: ApiPolicy[] = [
        {
          policyName: '학칙',
          title: '학칙',
          sha: 'sha_868',
          path: 'policies/학칙.md',
          content: '# 학칙\n\n정책 내용',
          fileNo: '868'
        }
      ];

      // Run sync twice with same data
      const result1 = await synchronizer.synchronize(policies);
      const result2 = await synchronizer.synchronize(policies);

      // First sync: 1 add
      expect(result1.stats.added).toBe(1);
      expect(result1.stats.updated).toBe(0);

      // Second sync: no changes
      expect(result2.stats.added).toBe(0);
      expect(result2.stats.updated).toBe(0);

      // KV state should be identical
      const allPolicies = kvManager.getPoliciesSnapshot();
      expect(allPolicies.size).toBe(1);
      expect(allPolicies.get('학칙')?.fileNo).toBe('868');
    });
  });

  describe('Edge Cases', () => {
    it('should handle Korean special characters in titles', async () => {
      const complexTitles = [
        '한국교원대학교 학칙 (개정)',
        '학사규정 (시행 2025)',
        '규정 №001 (특수문자: !@#$%)',
        '대학원 학칙 & 규정'
      ];

      const policies: ApiPolicy[] = complexTitles.map((title, i) => ({
        policyName: `정책_${i + 1}`,
        title,
        sha: `sha_${1000 + i}`,
        path: `policies/정책_${i + 1}.md`,
        content: `# ${title}\n\n정책 내용`,
        fileNo: `${1000 + i}`
      }));

      const result = await synchronizer.synchronize(policies);

      expect(result.stats.added).toBe(4);

      const stored = kvManager.getPoliciesSnapshot();
      for (const title of complexTitles) {
        const policy = stored.get(title);
        expect(policy).toBeDefined();
        expect(policy?.title).toBe(title);
      }
    });

    it('should handle large fileNo changes', async () => {
      const policies1: ApiPolicy[] = [
        {
          policyName: '학칙정책',
          title: '학칙',
          sha: 'sha_1',
          path: 'policies/학칙정책.md',
          content: '# 학칙\n\n정책 내용',
          fileNo: '1'
        }
      ];

      await synchronizer.synchronize(policies1);

      // Simulate major version jump (e.g., archive migration)
      const policies2: ApiPolicy[] = [
        {
          policyName: '학칙정책',
          title: '학칙',
          sha: 'sha_999999',
          path: 'policies/학칙정책.md',
          content: '# 학칙\n\n정책 내용',
          fileNo: '999999'
        }
      ];

      const result = await synchronizer.synchronize(policies2);

      expect(result.stats.updated).toBe(1);
      expect(result.toUpdate[0].fileNo).toBe('999999');
    });
  });

  describe('Metadata Tracking', () => {
    it('should record accurate sync results', async () => {
      const policies: ApiPolicy[] = Array.from({ length: 10 }, (_, i) => createTestPolicy(i));

      const result = await synchronizer.synchronize(policies);

      // Verify sync result (metadata recording happens in index.ts scheduled handler)
      expect(result.stats.totalScanned).toBe(10);
      expect(result.stats.added).toBe(10);
      expect(result.stats.updated).toBe(0);
      expect(result.stats.deleted).toBe(0);

      // Verify policies were queued for processing
      const queue = kvManager.getQueueSnapshot();
      expect(queue.size).toBe(10);
      for (const entry of queue.values()) {
        expect(entry.operation).toBe('add');
        expect(entry.retryCount).toBe(0);
        expect(entry.errorMessage).toBeNull();
      }
    });
  });
});
