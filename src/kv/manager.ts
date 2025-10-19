/**
 * KV Manager - CRUD Operations for Policy Registry
 *
 * Provides abstraction layer for Cloudflare KV operations.
 */

import type { PolicyEntry, SyncMetadata, QueueEntry } from './types';

const KEY_PREFIX = {
  POLICY: 'policy:',
  METADATA: 'metadata:sync:lastRun',
  QUEUE: 'queue:',
  DEAD_LETTER: 'dead-letter:'
};

export class KVManager {
  constructor(private namespace: KVNamespace) {}

  /**
   * Read a policy entry by title
   */
  async getPolicyByTitle(title: string): Promise<PolicyEntry | null> {
    const key = `${KEY_PREFIX.POLICY}${title}`;
    const data = await this.namespace.get(key, { type: 'text' });

    if (!data) {
      return null;
    }

    try {
      return JSON.parse(data) as PolicyEntry;
    } catch (error) {
      console.error(`Failed to parse policy entry for title "${title}":`, error);
      return null;
    }
  }

  /**
   * Read all policy entries
   * Returns a Map<title, PolicyEntry> for efficient lookups
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
          const title = key.name.substring(KEY_PREFIX.POLICY.length);
          const data = await this.namespace.get(key.name, { type: 'text' });

          if (data) {
            try {
              const policy = JSON.parse(data) as PolicyEntry;
              policies.set(title, policy);
            } catch (error) {
              console.error(`Failed to parse policy for key "${key.name}":`, error);
            }
          }
        }

        // @ts-expect-error cursor may exist in some implementations
        cursor = result.cursor;
        hasMore = result.list_complete === false;
      }
    } catch (error) {
      console.error('Failed to list all policies:', error);
    }

    return policies;
  }

  /**
   * Create or update a policy entry
   */
  async setPolicyEntry(policy: PolicyEntry): Promise<void> {
    const key = `${KEY_PREFIX.POLICY}${policy.title}`;
    const value = JSON.stringify(policy);

    try {
      await this.namespace.put(key, value);
    } catch (error) {
      console.error(`Failed to write policy entry for title "${policy.title}":`, error);
      throw error;
    }
  }

  /**
   * Batch write multiple policy entries
   */
  async setPolicyEntries(policies: PolicyEntry[]): Promise<void> {
    const operations = policies.map(policy => ({
      key: `${KEY_PREFIX.POLICY}${policy.title}`,
      value: JSON.stringify(policy)
    }));

    // Process in batches to avoid rate limits
    const batchSize = 100;
    for (let i = 0; i < operations.length; i += batchSize) {
      const batch = operations.slice(i, i + batchSize);

      try {
        await Promise.all(
          batch.map(op => this.namespace.put(op.key, op.value))
        );
      } catch (error) {
        console.error(`Failed to batch write policies (batch ${i / batchSize}):`, error);
        throw error;
      }
    }
  }

  /**
   * Delete a policy entry by title
   */
  async deletePolicyByTitle(title: string): Promise<void> {
    const key = `${KEY_PREFIX.POLICY}${title}`;

    try {
      await this.namespace.delete(key);
    } catch (error) {
      console.error(`Failed to delete policy entry for title "${title}":`, error);
      throw error;
    }
  }

  /**
   * Batch delete multiple policy entries
   */
  async deletePoliciesByTitles(titles: string[]): Promise<void> {
    const batchSize = 100;
    for (let i = 0; i < titles.length; i += batchSize) {
      const batch = titles.slice(i, i + batchSize);

      try {
        await Promise.all(
          batch.map(title => this.namespace.delete(`${KEY_PREFIX.POLICY}${title}`))
        );
      } catch (error) {
        console.error(`Failed to batch delete policies (batch ${i / batchSize}):`, error);
        throw error;
      }
    }
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
   * Add entry to processing queue
   */
  async enqueueForProcessing(entry: QueueEntry): Promise<void> {
    const key = `${KEY_PREFIX.QUEUE}${entry.title}`;
    const value = JSON.stringify(entry);

    try {
      await this.namespace.put(key, value);
    } catch (error) {
      console.error(
        `Failed to enqueue policy "${entry.title}" for processing:`,
        error
      );
      throw error;
    }
  }

  /**
   * Batch enqueue multiple entries
   */
  async enqueueMultiple(entries: QueueEntry[]): Promise<void> {
    const operations = entries.map(entry => ({
      key: `${KEY_PREFIX.QUEUE}${entry.title}`,
      value: JSON.stringify(entry)
    }));

    const batchSize = 100;
    for (let i = 0; i < operations.length; i += batchSize) {
      const batch = operations.slice(i, i + batchSize);

      try {
        await Promise.all(
          batch.map(op => this.namespace.put(op.key, op.value))
        );
      } catch (error) {
        console.error(`Failed to batch enqueue entries (batch ${i / batchSize}):`, error);
        throw error;
      }
    }
  }

  /**
   * Get entry from queue
   */
  async getQueueEntry(title: string): Promise<QueueEntry | null> {
    const key = `${KEY_PREFIX.QUEUE}${title}`;
    const data = await this.namespace.get(key, { type: 'text' });

    if (!data) {
      return null;
    }

    try {
      return JSON.parse(data) as QueueEntry;
    } catch (error) {
      console.error(`Failed to parse queue entry for title "${title}":`, error);
      return null;
    }
  }

  /**
   * Remove entry from queue
   */
  async dequeueByTitle(title: string): Promise<void> {
    const key = `${KEY_PREFIX.QUEUE}${title}`;

    try {
      await this.namespace.delete(key);
    } catch (error) {
      console.error(`Failed to dequeue policy "${title}":`, error);
      throw error;
    }
  }

  /**
   * Move entry to dead-letter queue (for failed items)
   */
  async moveToDeadLetter(entry: QueueEntry, reason: string): Promise<void> {
    const key = `${KEY_PREFIX.DEAD_LETTER}${entry.title}`;
    const deadLetterEntry = {
      ...entry,
      errorMessage: reason,
      movedAt: new Date().toISOString()
    };
    const value = JSON.stringify(deadLetterEntry);

    try {
      await this.namespace.put(key, value);
      // Remove from active queue
      await this.dequeueByTitle(entry.title);
    } catch (error) {
      console.error(
        `Failed to move policy "${entry.title}" to dead-letter:`,
        error
      );
      throw error;
    }
  }

  /**
   * Get all queue entries (for testing/monitoring)
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
          const title = key.name.substring(KEY_PREFIX.QUEUE.length);
          const data = await this.namespace.get(key.name, { type: 'text' });

          if (data) {
            try {
              const entry = JSON.parse(data) as QueueEntry;
              entries.set(title, entry);
            } catch (error) {
              console.error(`Failed to parse queue entry for key "${key.name}":`, error);
            }
          }
        }

        // @ts-expect-error cursor may exist in some implementations
        cursor = result.cursor;
        hasMore = result.list_complete === false;
      }
    } catch (error) {
      console.error('Failed to list all queue entries:', error);
    }

    return entries;
  }
}
