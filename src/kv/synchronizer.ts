/**
 * Policy Synchronization Engine
 *
 * Implements the synchronization algorithm defined in .spec/kv-sync-algorithm.spec.md
 * Detects and applies changes to policy registry based on current API state.
 */

import type { ApiPolicy, PolicyEntry, SyncResult, QueueEntry } from './types';
import type { KVManager } from './manager';

export class PolicySynchronizer {
  constructor(private kvManager: KVManager) {}

  /**
   * Main synchronization flow
   *
   * 1. Fetch current policies from API
   * 2. Load existing policies from KV
   * 3. Detect changes (ADD, UPDATE, DELETE)
   * 4. Persist changes and return results
   */
  async synchronize(currentPolicies: ApiPolicy[]): Promise<SyncResult> {
    console.log(`[Sync] Starting synchronization with ${currentPolicies.length} current policies`);

    // Phase 1: Build current state maps
    const currentMap = this.buildPolicyMap(currentPolicies);
    const kvRegistry = await this.kvManager.getAllPolicies();

    console.log(`[Sync] Loaded ${kvRegistry.size} policies from KV registry`);

    // Phase 2: Detect changes
    const toAdd: PolicyEntry[] = [];
    const toUpdate: PolicyEntry[] = [];
    const toDelete: string[] = [];

    // Scan for additions and updates
    for (const [title, apiPolicy] of currentMap) {
      const existing = kvRegistry.get(title);

      if (!existing) {
        // ADD: New policy
        toAdd.push(this.createPolicyEntry(apiPolicy));
        console.log(`[Sync] ADD: "${title}" (fileNo: ${apiPolicy.fileNo})`);
      } else if (existing.fileNo !== apiPolicy.fileNo) {
        // UPDATE: fileNo changed
        const updated = this.createPolicyEntry(apiPolicy);
        toUpdate.push(updated);
        console.log(
          `[Sync] UPDATE: "${title}" (fileNo: ${existing.fileNo} → ${apiPolicy.fileNo})`
        );
      } else {
        // NO-OP: No changes
        console.log(`[Sync] SKIP: "${title}" (no changes)`);
      }
    }

    // Scan for deletions
    for (const [title] of kvRegistry) {
      if (!currentMap.has(title)) {
        // DELETE: Removed from API
        toDelete.push(title);
        console.log(`[Sync] DELETE: "${title}"`);
      }
    }

    // Phase 3: Persist changes
    await this.persistChanges(toAdd, toUpdate, toDelete);

    // Phase 4: Return results
    const result: SyncResult = {
      toAdd,
      toUpdate,
      toDelete,
      stats: {
        totalScanned: currentMap.size,
        added: toAdd.length,
        updated: toUpdate.length,
        deleted: toDelete.length
      }
    };

    console.log(
      `[Sync] Completed: Added=${toAdd.length}, Updated=${toUpdate.length}, Deleted=${toDelete.length}`
    );

    return result;
  }

  /**
   * Persist changes to KV and queue
   */
  private async persistChanges(
    toAdd: PolicyEntry[],
    toUpdate: PolicyEntry[],
    toDelete: string[]
  ): Promise<void> {
    try {
      // Write new entries
      if (toAdd.length > 0) {
        await this.kvManager.setPolicyEntries(toAdd);
        console.log(`[Persist] Wrote ${toAdd.length} new policies to KV`);

        // Enqueue for processing
        const queueEntries = toAdd.map(policy => this.createQueueEntry(policy, 'add'));
        await this.kvManager.enqueueMultiple(queueEntries);
        console.log(`[Persist] Enqueued ${toAdd.length} policies for processing`);
      }

      // Update existing entries
      if (toUpdate.length > 0) {
        await this.kvManager.setPolicyEntries(toUpdate);
        console.log(`[Persist] Updated ${toUpdate.length} policies in KV`);

        // Enqueue for processing
        const queueEntries = toUpdate.map(policy => this.createQueueEntry(policy, 'update'));
        await this.kvManager.enqueueMultiple(queueEntries);
        console.log(`[Persist] Enqueued ${toUpdate.length} policies for processing`);
      }

      // Delete removed entries
      if (toDelete.length > 0) {
        await this.kvManager.deletePoliciesByTitles(toDelete);
        console.log(`[Persist] Deleted ${toDelete.length} policies from KV`);

        // Clean up queue entries
        for (const title of toDelete) {
          await this.kvManager.dequeueByTitle(title);
        }
        console.log(`[Persist] Cleaned up ${toDelete.length} queue entries`);
      }
    } catch (error) {
      console.error('[Persist] Error persisting changes:', error);
      throw error;
    }
  }

  /**
   * Helper: Build a Map<title, ApiPolicy> for efficient lookups
   */
  private buildPolicyMap(policies: ApiPolicy[]): Map<string, ApiPolicy> {
    const map = new Map<string, ApiPolicy>();

    for (const policy of policies) {
      if (!policy.title || !policy.title.trim()) {
        console.warn('[Sync] Skipping policy with empty title');
        continue;
      }

      if (map.has(policy.title)) {
        console.warn(`[Sync] Duplicate title detected: "${policy.title}". Using first occurrence.`);
        continue;
      }

      map.set(policy.title, policy);
    }

    return map;
  }

  /**
   * Helper: Create a PolicyEntry from ApiPolicy
   */
  private createPolicyEntry(apiPolicy: ApiPolicy): PolicyEntry {
    return {
      title: apiPolicy.title,
      fileNo: apiPolicy.fileNo,
      status: 'active',
      lastUpdated: new Date().toISOString(),
      previewUrl: apiPolicy.previewUrl,
      downloadUrl: apiPolicy.downloadUrl
    };
  }

  /**
   * Helper: Create a QueueEntry for processing
   */
  private createQueueEntry(policy: PolicyEntry, operation: 'add' | 'update'): QueueEntry {
    return {
      title: policy.title,
      fileNo: policy.fileNo,
      operation,
      retryCount: 0,
      createdAt: new Date().toISOString(),
      errorMessage: null
    };
  }

  /**
   * Validate API policy data
   */
  validateApiPolicy(policy: ApiPolicy): boolean {
    if (!policy.title || typeof policy.title !== 'string' || !policy.title.trim()) {
      console.warn('[Validation] Invalid title:', policy.title);
      return false;
    }

    if (!policy.fileNo || typeof policy.fileNo !== 'string' || !/^\d+$/.test(policy.fileNo)) {
      console.warn('[Validation] Invalid fileNo:', policy.fileNo);
      return false;
    }

    if (!policy.previewUrl || typeof policy.previewUrl !== 'string') {
      console.warn('[Validation] Invalid previewUrl:', policy.previewUrl);
      return false;
    }

    if (!policy.downloadUrl || typeof policy.downloadUrl !== 'string') {
      console.warn('[Validation] Invalid downloadUrl:', policy.downloadUrl);
      return false;
    }

    return true;
  }

  /**
   * Validate and filter API policies
   */
  validateAndFilterPolicies(policies: ApiPolicy[]): ApiPolicy[] {
    return policies.filter(policy => this.validateApiPolicy(policy));
  }
}
