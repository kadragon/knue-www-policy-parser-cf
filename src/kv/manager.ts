/**
 * KV Manager - CRUD Operations for Policy Registry (v2.0.0)
 *
 * Provides abstraction layer for Cloudflare KV operations.
 *
 * Breaking changes from v1.x:
 * - Primary key: title → policyName
 * - Added commit SHA tracking
 */

import type { PolicyEntry, SyncMetadata, QueueEntry } from './types';

const KEY_PREFIX = {
  POLICY: 'policy:',
  METADATA: 'metadata:sync:lastRun',
  LAST_COMMIT: 'metadata:sync:lastCommit',  // v2.0.0: New key for commit tracking
  QUEUE: 'queue:',
  DEAD_LETTER: 'dead-letter:'
};

const MAX_BATCH_SIZE = 50;

export class KVManager {
  constructor(private namespace: KVNamespace) {}

  /**
   * Read a policy entry by policyName
   *
   * v2.0.0: Changed from getPolicyByTitle to getPolicyByName
   */
  async getPolicyByName(policyName: string): Promise<PolicyEntry | null> {
    const key = `${KEY_PREFIX.POLICY}${policyName}`;
    const data = await this.namespace.get(key, { type: 'text' });

    if (!data) {
      return null;
    }

    try {
      return JSON.parse(data) as PolicyEntry;
    } catch (error) {
      console.error(`Failed to parse policy entry for policyName "${policyName}":`, error);
      return null;
    }
  }

  /**
   * Read all policy entries
   * Returns a Map<policyName, PolicyEntry> for efficient lookups
   *
   * v2.0.0: Changed from Map<title, ...> to Map<policyName, ...>
   */
  async getAllPolicies(): Promise<Map<string, PolicyEntry>> {
    const policies = new Map<string, PolicyEntry>();
    const listOptions = { prefix: KEY_PREFIX.POLICY, limit: 1000 };

    try {
      let cursor: string | undefined;
      let hasMore = true;

      while (hasMore) {
        const result = await this.namespace.list({
          ...listOptions,
          cursor
        } as Parameters<KVNamespace['list']>[0]);

        for (const key of result.keys) {
          const policyName = key.name.substring(KEY_PREFIX.POLICY.length);
          const data = await this.namespace.get(key.name, { type: 'text' });

          if (data) {
            try {
              const policy = JSON.parse(data) as PolicyEntry;
              policies.set(policyName, policy);
            } catch (error) {
              console.error(`Failed to parse policy for key "${key.name}":`, error);
            }
          }
        }

        cursor = (result as { cursor?: string }).cursor;
        hasMore = result.list_complete === false;
      }
    } catch (error) {
      console.error('Failed to list all policies:', error);
    }

    return policies;
  }

  /**
   * Create or update a policy entry
   *
   * v2.0.0: Uses policyName as key
   */
  async setPolicyEntry(policy: PolicyEntry): Promise<void> {
    const key = `${KEY_PREFIX.POLICY}${policy.policyName}`;
    const value = JSON.stringify(policy);

    try {
      await this.namespace.put(key, value);
    } catch (error) {
      console.error(`Failed to write policy entry for policyName "${policy.policyName}":`, error);
      throw error;
    }
  }

  /**
   * Batch write multiple policy entries
   *
   * v2.0.0: Uses policyName as key
   */
  async setPolicyEntries(policies: PolicyEntry[]): Promise<void> {
    if (policies.length === 0) {
      return;
    }

    const operations = policies.map(policy => ({
      policy,
      key: `${KEY_PREFIX.POLICY}${policy.policyName}`,
      value: JSON.stringify(policy)
    }));

    await this.runBatchedOperations(
      operations,
      MAX_BATCH_SIZE,
      async operation => {
        await this.namespace.put(operation.key, operation.value);
      },
      (operation, error, batchIndex) => {
        console.error(
          `Failed to write policy entry for policyName "${operation.policy.policyName}" (batch ${batchIndex}):`,
          error
        );
      },
      'write policy entries'
    );
  }

  /**
   * Delete a policy entry by policyName
   *
   * v2.0.0: Changed from deletePolicyByTitle to deletePolicyByName
   */
  async deletePolicyByName(policyName: string): Promise<void> {
    const key = `${KEY_PREFIX.POLICY}${policyName}`;

    try {
      await this.namespace.delete(key);
    } catch (error) {
      console.error(`Failed to delete policy entry for policyName "${policyName}":`, error);
      throw error;
    }
  }

  /**
   * Batch delete multiple policy entries
   *
   * v2.0.0: Changed from deletePoliciesByTitles to deletePoliciesByNames
   */
  async deletePoliciesByNames(policyNames: string[]): Promise<void> {
    if (policyNames.length === 0) {
      return;
    }

    const operations = policyNames.map(policyName => ({
      policyName,
      key: `${KEY_PREFIX.POLICY}${policyName}`
    }));

    await this.runBatchedOperations(
      operations,
      MAX_BATCH_SIZE,
      async operation => {
        await this.namespace.delete(operation.key);
      },
      (operation, error, batchIndex) => {
        console.error(
          `Failed to delete policy entry for policyName "${operation.policyName}" (batch ${batchIndex}):`,
          error
        );
      },
      'delete policy entries'
    );
  }

  /**
   * Get last sync metadata
   */
  async getSyncMetadata(): Promise<SyncMetadata | null> {
    const data = await this.namespace.get(KEY_PREFIX.METADATA, { type: 'text' });

    if (!data) {
      return null;
    }

    try {
      return JSON.parse(data) as SyncMetadata;
    } catch (error) {
      console.error('Failed to parse sync metadata:', error);
      return null;
    }
  }

  /**
   * Update sync metadata
   */
  async setSyncMetadata(metadata: SyncMetadata): Promise<void> {
    const value = JSON.stringify(metadata);

    try {
      await this.namespace.put(KEY_PREFIX.METADATA, value);
    } catch (error) {
      console.error('Failed to write sync metadata:', error);
      throw error;
    }
  }

  /**
   * Get last synced commit SHA (v2.0.0: NEW)
   */
  async getLastCommit(): Promise<string | null> {
    try {
      return await this.namespace.get(KEY_PREFIX.LAST_COMMIT, { type: 'text' });
    } catch (error) {
      console.error('Failed to get last commit SHA:', error);
      return null;
    }
  }

  /**
   * Set last synced commit SHA (v2.0.0: NEW)
   */
  async setLastCommit(commitSHA: string): Promise<void> {
    try {
      await this.namespace.put(KEY_PREFIX.LAST_COMMIT, commitSHA);
    } catch (error) {
      console.error('Failed to write last commit SHA:', error);
      throw error;
    }
  }

  /**
   * Add entry to processing queue
   *
   * v2.0.0: Uses policyName as key
   */
  async enqueueForProcessing(entry: QueueEntry): Promise<void> {
    const key = `${KEY_PREFIX.QUEUE}${entry.policyName}`;
    const value = JSON.stringify(entry);

    try {
      await this.namespace.put(key, value);
    } catch (error) {
      console.error(
        `Failed to enqueue policy "${entry.policyName}" for processing:`,
        error
      );
      throw error;
    }
  }

  /**
   * Batch enqueue multiple entries
   *
   * v2.0.0: Uses policyName as key
   */
  async enqueueMultiple(entries: QueueEntry[]): Promise<void> {
    if (entries.length === 0) {
      return;
    }

    const operations = entries.map(entry => ({
      entry,
      key: `${KEY_PREFIX.QUEUE}${entry.policyName}`,
      value: JSON.stringify(entry)
    }));

    await this.runBatchedOperations(
      operations,
      MAX_BATCH_SIZE,
      async operation => {
        await this.namespace.put(operation.key, operation.value);
      },
      (operation, error, batchIndex) => {
        console.error(
          `Failed to enqueue policy "${operation.entry.policyName}" for processing (batch ${batchIndex}):`,
          error
        );
      },
      'enqueue policies for processing'
    );
  }

  /**
   * Get entry from queue
   *
   * v2.0.0: Uses policyName as key
   */
  async getQueueEntry(policyName: string): Promise<QueueEntry | null> {
    const key = `${KEY_PREFIX.QUEUE}${policyName}`;
    const data = await this.namespace.get(key, { type: 'text' });

    if (!data) {
      return null;
    }

    try {
      return JSON.parse(data) as QueueEntry;
    } catch (error) {
      console.error(`Failed to parse queue entry for policyName "${policyName}":`, error);
      return null;
    }
  }

  /**
   * Remove entry from queue
   *
   * v2.0.0: Changed from dequeueByTitle to dequeueByName
   */
  async dequeueByName(policyName: string): Promise<void> {
    const key = `${KEY_PREFIX.QUEUE}${policyName}`;

    try {
      await this.namespace.delete(key);
    } catch (error) {
      console.error(`Failed to dequeue policy "${policyName}":`, error);
      throw error;
    }
  }

  /**
   * Move entry to dead-letter queue (for failed items)
   *
   * v2.0.0: Uses policyName as key
   */
  async moveToDeadLetter(entry: QueueEntry, reason: string): Promise<void> {
    const key = `${KEY_PREFIX.DEAD_LETTER}${entry.policyName}`;
    const deadLetterEntry = {
      ...entry,
      errorMessage: reason,
      movedAt: new Date().toISOString()
    };
    const value = JSON.stringify(deadLetterEntry);

    try {
      await this.namespace.put(key, value);
      // Remove from active queue
      await this.dequeueByName(entry.policyName);
    } catch (error) {
      console.error(
        `Failed to move policy "${entry.policyName}" to dead-letter:`,
        error
      );
      throw error;
    }
  }

  /**
   * Get all queue entries (for testing/monitoring)
   *
   * v2.0.0: Returns Map<policyName, QueueEntry>
   */
  async getAllQueueEntries(): Promise<Map<string, QueueEntry>> {
    const entries = new Map<string, QueueEntry>();
    const listOptions = { prefix: KEY_PREFIX.QUEUE, limit: 1000 };

    try {
      let cursor: string | undefined;
      let hasMore = true;

      while (hasMore) {
        const result = await this.namespace.list({
          ...listOptions,
          cursor
        } as Parameters<KVNamespace['list']>[0]);

        for (const key of result.keys) {
          const policyName = key.name.substring(KEY_PREFIX.QUEUE.length);
          const data = await this.namespace.get(key.name, { type: 'text' });

          if (data) {
            try {
              const entry = JSON.parse(data) as QueueEntry;
              entries.set(policyName, entry);
            } catch (error) {
              console.error(`Failed to parse queue entry for key "${key.name}":`, error);
            }
          }
        }

        cursor = (result as { cursor?: string }).cursor;
        hasMore = result.list_complete === false;
      }
    } catch (error) {
      console.error('Failed to list all queue entries:', error);
    }

    return entries;
  }

  private async runBatchedOperations<T>(
    items: T[],
    batchSize: number,
    operation: (item: T) => Promise<void>,
    onError: (item: T, error: unknown, batchIndex: number) => void,
    summary: string
  ): Promise<void> {
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      const batchIndex = Math.floor(i / batchSize);
      const results = await Promise.allSettled(batch.map(item => operation(item)));

      const failures = results
        .map((result, index) => (result.status === 'rejected' ? { item: batch[index], reason: result.reason } : null))
        .filter((value): value is { item: T; reason: unknown } => value !== null);

      if (failures.length > 0) {
        console.error(
          `Failed to ${summary} (batch ${batchIndex}): ${failures.length}/${batch.length} operations failed`
        );
        failures.forEach(({ item, reason }) => onError(item, reason, batchIndex));

        const aggregateError = new AggregateError(
          failures.map(failure => failure.reason),
          `Failed to ${summary} (batch ${batchIndex})`
        );
        throw aggregateError;
      }
    }
  }
}
