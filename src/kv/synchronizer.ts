/**
 * Policy Synchronization Engine (v2.0.0)
 *
 * Implements the synchronization algorithm defined in .spec/kv-sync-algorithm.spec.md v2.0.0
 * Detects and applies changes to policy registry based on GitHub repository state.
 *
 * Breaking changes from v1.x:
 * - Primary key: title → policyName
 * - Change detection: fileNo → sha
 * - Source: Preview API → GitHub repository
 */

import type { ApiPolicy, PolicyEntry, SyncResult, QueueEntry } from './types';
import type { KVManager } from './manager';

export class PolicySynchronizer {
  constructor(private kvManager: KVManager) {}

  /**
   * Main synchronization flow (v2.0.0)
   *
   * 1. Fetch current policies from GitHub
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
    for (const [policyName, apiPolicy] of currentMap) {
      const existing = kvRegistry.get(policyName);

      if (!existing) {
        // ADD: New policy
        toAdd.push(this.createPolicyEntry(apiPolicy));
        console.log(`[Sync] ADD: "${policyName}" (sha: ${apiPolicy.sha.substring(0, 7)})`);
      } else if (existing.sha !== apiPolicy.sha) {
        // UPDATE: sha changed (content modified)
        const updated = this.createPolicyEntry(apiPolicy);
        toUpdate.push(updated);
        console.log(
          `[Sync] UPDATE: "${policyName}" (sha: ${existing.sha.substring(0, 7)} → ${apiPolicy.sha.substring(0, 7)})`
        );
      } else {
        // NO-OP: No changes
        console.log(`[Sync] SKIP: "${policyName}" (no changes)`);
      }
    }

    // Scan for deletions
    for (const [policyName] of kvRegistry) {
      if (!currentMap.has(policyName)) {
        // DELETE: Removed from GitHub
        toDelete.push(policyName);
        console.log(`[Sync] DELETE: "${policyName}"`);
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
        await this.kvManager.deletePoliciesByNames(toDelete);
        console.log(`[Persist] Deleted ${toDelete.length} policies from KV`);

        // Clean up queue entries
        for (const policyName of toDelete) {
          await this.kvManager.dequeueByName(policyName);
        }
        console.log(`[Persist] Cleaned up ${toDelete.length} queue entries`);
      }
    } catch (error) {
      console.error('[Persist] Error persisting changes:', error);
      throw error;
    }
  }

  /**
   * Helper: Build a Map<policyName, ApiPolicy> for efficient lookups
   *
   * v2.0.0: Changed from Map<title, ...> to Map<policyName, ...>
   */
  private buildPolicyMap(policies: ApiPolicy[]): Map<string, ApiPolicy> {
    const map = new Map<string, ApiPolicy>();

    for (const policy of policies) {
      if (!policy.policyName || !policy.policyName.trim()) {
        console.warn('[Sync] Skipping policy with empty policyName');
        continue;
      }

      if (map.has(policy.policyName)) {
        console.warn(`[Sync] Duplicate policyName detected: "${policy.policyName}". Using first occurrence.`);
        continue;
      }

      map.set(policy.policyName, policy);
    }

    return map;
  }

  /**
   * Helper: Create a PolicyEntry from ApiPolicy
   */
  private createPolicyEntry(apiPolicy: ApiPolicy): PolicyEntry {
    return {
      policyName: apiPolicy.policyName,
      title: apiPolicy.title,
      status: 'active',
      lastUpdated: new Date().toISOString(),
      sha: apiPolicy.sha,
      path: apiPolicy.path
    };
  }

  /**
   * Helper: Create a QueueEntry for processing
   */
  private createQueueEntry(policy: PolicyEntry, operation: 'add' | 'update'): QueueEntry {
    return {
      policyName: policy.policyName,
      sha: policy.sha,
      operation,
      retryCount: 0,
      createdAt: new Date().toISOString(),
      errorMessage: null
    };
  }

  /**
   * Validate API policy data (v2.0.0)
   *
   * v2.0.0: Validate policyName and sha instead of fileNo
   */
  validateApiPolicy(policy: ApiPolicy): boolean {
    // Validate policyName
    if (!policy.policyName || typeof policy.policyName !== 'string' || !policy.policyName.trim()) {
      console.warn('[Validation] Invalid policyName:', policy.policyName);
      return false;
    }

    // Validate title
    if (!policy.title || typeof policy.title !== 'string' || !policy.title.trim()) {
      console.warn('[Validation] Invalid title:', policy.title);
      return false;
    }

    // Validate sha (Git SHA is 40 hex characters)
    if (!policy.sha || typeof policy.sha !== 'string' || !/^[0-9a-f]{40}$/i.test(policy.sha)) {
      console.warn('[Validation] Invalid sha:', policy.sha);
      return false;
    }

    // Validate path
    if (!policy.path || typeof policy.path !== 'string') {
      console.warn('[Validation] Invalid path:', policy.path);
      return false;
    }

    // Validate content
    if (!policy.content || typeof policy.content !== 'string') {
      console.warn('[Validation] Invalid content (empty or not string)');
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
