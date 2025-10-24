/**
 * Change Tracker
 *
 * Detects changes in policy files between Git commits using GitHub API.
 */

import type { ChangeSet, PolicyDocument, GitHubFile, GitHubTreeEntry } from './types';
import type { GitHubClient } from './client';
import { parseMarkdown, shouldProcessFile } from './markdown';

export class ChangeTracker {
  /**
   * Batch size for fetching file contents from GitHub API.
   *
   * Cloudflare Workers subrequest limit: 50 per request
   * Conservative approach with concurrent request limiting:
   * - getLatestCommit() / getCommitDiff() / other API calls: ~3 subrequests
   * - getFileTree(recursive=true): 1 subrequest
   * - Concurrent fetches: 5 (limited via pLimit)
   *
   * Safe calculation: 3 (initial) + 1 (tree) + 5 (concurrent) = 9 < 50 ✓
   *
   * Strategy: Use BATCH_SIZE=30 with MAX_CONCURRENT_FETCHES=5
   * - Process 30 files per batch
   * - Limit to 5 concurrent HTTP requests per batch
   * - This prevents subrequest limit from being exceeded
   */
  private static readonly BATCH_SIZE = 30;
  private static readonly MAX_CONCURRENT_FETCHES = 5;

  constructor(private client: GitHubClient) {}

  /**
   * Execute async functions with concurrency limit
   * Prevents exceeding Cloudflare subrequest limit
   *
   * IMPORTANT: Results are stored by original index to maintain order,
   * because promises may resolve out of order due to async operations.
   * This ensures results[i] corresponds to tasks[i], not completion order.
   */
  private async executeWithLimit<T>(
    tasks: Array<() => Promise<T>>,
    concurrency: number
  ): Promise<Array<{ status: 'fulfilled' | 'rejected'; value?: T; reason?: Error }>> {
    const results: Array<{ status: 'fulfilled' | 'rejected'; value?: T; reason?: Error }> = new Array(
      tasks.length
    );
    const executing = new Set<Promise<void>>();

    for (const [index, task] of tasks.entries()) {
      const promise = task()
        .then(
          value => {
            results[index] = { status: 'fulfilled', value };
          },
          reason => {
            results[index] = { status: 'rejected', reason };
          }
        )
        .finally(() => executing.delete(promise));

      executing.add(promise);

      if (executing.size >= concurrency) {
        await Promise.race(executing);
      }
    }

    await Promise.all(executing);
    return results;
  }

  /**
   * Detect changes between two commits
   *
   * @param owner - GitHub repository owner
   * @param repo - GitHub repository name
   * @param currentCommit - Current (head) commit SHA
   * @param previousCommit - Previous (base) commit SHA (optional, for first run)
   * @returns ChangeSet with added, modified, and deleted policies
   */
  async detectChanges(
    owner: string,
    repo: string,
    currentCommit: string,
    previousCommit?: string
  ): Promise<ChangeSet> {
    // If no previous commit (first run), treat all files as added
    if (!previousCommit) {
      console.log('[Tracker] First run detected, fetching all files as added');
      return await this.fetchAllFilesAsAdded(owner, repo, currentCommit);
    }

    // If same commit, no changes
    if (currentCommit === previousCommit) {
      console.log('[Tracker] No changes detected (same commit SHA)');
      return { added: [], modified: [], deleted: [] };
    }

    console.log(`[Tracker] Detecting changes: ${previousCommit} → ${currentCommit}`);

    // Fetch commit diff
    const diff = await this.client.getCommitDiff(owner, repo, previousCommit, currentCommit);

    // Filter and categorize files
    const added: PolicyDocument[] = [];
    const modified: PolicyDocument[] = [];
    const deleted: string[] = [];

    // Separate files that need content fetching
    interface FileToProcess {
      file: GitHubFile;
      category: 'added' | 'modified' | 'renamed';
    }

    interface DeletedFile {
      filename: string;
      previous_filename?: string;
      status: 'removed' | 'renamed';
    }

    const filesToFetch: FileToProcess[] = [];
    const deletedFiles: DeletedFile[] = [];

    for (const file of diff.files) {
      // Only process markdown files (excluding README)
      if (!shouldProcessFile(file.filename)) {
        continue;
      }

      if (file.status === 'added') {
        filesToFetch.push({ file, category: 'added' });
      } else if (file.status === 'modified') {
        filesToFetch.push({ file, category: 'modified' });
      } else if (file.status === 'removed') {
        deletedFiles.push({
          filename: file.filename,
          status: 'removed'
        });
      } else if (file.status === 'renamed') {
        filesToFetch.push({ file, category: 'renamed' });
        deletedFiles.push({
          filename: file.filename,
          previous_filename: file.previous_filename,
          status: 'renamed'
        });
      }
    }

    // Process deleted files
    for (const file of deletedFiles) {
      if (file.status === 'removed') {
        const policyName = file.filename.split('/').pop()?.replace(/\.md$/i, '') || '';
        if (policyName) {
          deleted.push(policyName);
          console.log(`[Tracker] DELETE: ${policyName}`);
        }
      } else if (file.status === 'renamed' && file.previous_filename) {
        const oldPolicyName = file.previous_filename.split('/').pop()?.replace(/\.md$/i, '') || '';
        if (oldPolicyName) {
          deleted.push(oldPolicyName);
          console.log(`[Tracker] DELETE (renamed): ${oldPolicyName}`);
        }
      }
    }

    // Batch fetch file contents to avoid subrequest limit
    await this.fetchFilesInBatches(owner, repo, filesToFetch, added, modified);

    console.log(
      `[Tracker] Changes detected: +${added.length} ~${modified.length} -${deleted.length}`
    );

    return { added, modified, deleted };
  }

  /**
   * Load the full set of policy documents for a commit
   *
   * Reuses prefetched PolicyDocument instances (e.g., added/modified files)
   * to avoid redundant GitHub blob requests.
   */
  async getAllPolicies(
    owner: string,
    repo: string,
    commitSHA: string,
    prefetched: PolicyDocument[] = []
  ): Promise<PolicyDocument[]> {
    const prefetchedMap = new Map(prefetched.map(policy => [policy.path, policy]));

    const policies = await this.loadPoliciesFromTree(
      owner,
      repo,
      commitSHA,
      prefetchedMap,
      'full'
    );

    console.log(`[Tracker] Loaded ${policies.length} policies for commit ${commitSHA.substring(0, 7)}`);

    return policies;
  }

  /**
   * Fetch all markdown files as added (first run scenario)
   */
  private async fetchAllFilesAsAdded(
    owner: string,
    repo: string,
    commitSHA: string
  ): Promise<ChangeSet> {
    const added = await this.loadPoliciesFromTree(owner, repo, commitSHA, new Map(), 'initial');
    console.log(`[Tracker] Initial sync: ${added.length} policies found`);

    return { added, modified: [], deleted: [] };
  }

  /**
   * Helper: Load policies from repository tree for a specific commit
   *
   * @param prefetched Map of path -> PolicyDocument for files already fetched
   * @param logContext Controls per-policy logging verbosity
   */
  private async loadPoliciesFromTree(
    owner: string,
    repo: string,
    commitSHA: string,
    prefetched: Map<string, PolicyDocument>,
    logContext: 'initial' | 'full'
  ): Promise<PolicyDocument[]> {
    const tree = await this.client.getFileTree(owner, repo, commitSHA, true);
    const policies: PolicyDocument[] = [];

    // Separate prefetched from entries that need fetching
    interface EntryToFetch {
      entry: GitHubTreeEntry;
    }

    const entriesToFetch: EntryToFetch[] = [];

    for (const entry of tree) {
      if (entry.type !== 'blob' || !shouldProcessFile(entry.path)) {
        continue;
      }

      const cached = prefetched.get(entry.path);
      if (cached) {
        policies.push(cached);
        if (logContext === 'initial') {
          console.log(`[Tracker] ADD (initial): ${cached.policyName}`);
        }
        continue;
      }

      entriesToFetch.push({ entry });
    }

    // Batch fetch entries to avoid subrequest limit
    const fetchedPolicies = await this.fetchEntriesInBatches(
      owner,
      repo,
      entriesToFetch,
      logContext
    );
    policies.push(...fetchedPolicies);

    return policies;
  }

  /**
   * Batch fetch file contents for detectChanges diff files
   * Processes batches with limited concurrency to stay within Cloudflare 50 subrequest limit
   */
  private async fetchFilesInBatches(
    owner: string,
    repo: string,
    filesToFetch: Array<{ file: GitHubFile; category: 'added' | 'modified' | 'renamed' }>,
    added: PolicyDocument[],
    modified: PolicyDocument[]
  ): Promise<void> {
    for (let i = 0; i < filesToFetch.length; i += ChangeTracker.BATCH_SIZE) {
      const batch = filesToFetch.slice(i, i + ChangeTracker.BATCH_SIZE);
      const batchNum = Math.floor(i / ChangeTracker.BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(filesToFetch.length / ChangeTracker.BATCH_SIZE);
      console.log(
        `[Tracker] Fetching batch ${batchNum}/${totalBatches} (${batch.length} files, max ${ChangeTracker.MAX_CONCURRENT_FETCHES} concurrent)`
      );

      // Create tasks for concurrent execution with limit
      const tasks = batch.map(({ file, category }) => async () => {
        const content = await this.client.getFileContent(owner, repo, file.sha);
        const policy = parseMarkdown(content, file.filename, file.sha);

        if (category === 'added') {
          console.log(`[Tracker] ADD: ${policy.policyName}`);
          added.push(policy);
        } else if (category === 'modified') {
          console.log(`[Tracker] UPDATE: ${policy.policyName}`);
          modified.push(policy);
        } else if (category === 'renamed') {
          console.log(`[Tracker] ADD (renamed): ${policy.policyName}`);
          added.push(policy);
        }

        return policy;
      });

      // Execute with concurrency limit
      const results = await this.executeWithLimit(tasks, ChangeTracker.MAX_CONCURRENT_FETCHES);

      // Log any failures in this batch
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          const file = batch[index].file;
          console.error(
            `[Tracker] Failed to fetch ${file.filename}:`,
            result.reason instanceof Error ? result.reason.message : String(result.reason)
          );
        }
      });
    }
  }

  /**
   * Batch fetch file contents for tree entries
   * Processes batches with limited concurrency to stay within Cloudflare 50 subrequest limit
   */
  private async fetchEntriesInBatches(
    owner: string,
    repo: string,
    entriesToFetch: Array<{ entry: GitHubTreeEntry }>,
    logContext: 'initial' | 'full'
  ): Promise<PolicyDocument[]> {
    const policies: PolicyDocument[] = [];

    for (let i = 0; i < entriesToFetch.length; i += ChangeTracker.BATCH_SIZE) {
      const batch = entriesToFetch.slice(i, i + ChangeTracker.BATCH_SIZE);
      const batchNum = Math.floor(i / ChangeTracker.BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(entriesToFetch.length / ChangeTracker.BATCH_SIZE);
      console.log(
        `[Tracker] Fetching batch ${batchNum}/${totalBatches} (${batch.length} files, max ${ChangeTracker.MAX_CONCURRENT_FETCHES} concurrent)`
      );

      // Create tasks for concurrent execution with limit
      const tasks = batch.map(({ entry }) => async () => {
        const content = await this.client.getFileContent(owner, repo, entry.sha);
        const policy = parseMarkdown(content, entry.path, entry.sha);

        if (logContext === 'initial') {
          console.log(`[Tracker] ADD (initial): ${policy.policyName}`);
        }

        return policy;
      });

      // Execute with concurrency limit
      const results = await this.executeWithLimit(tasks, ChangeTracker.MAX_CONCURRENT_FETCHES);

      // Collect successful results and log failures
      results.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value) {
          policies.push(result.value);
        } else {
          const entry = batch[index].entry;
          console.error(
            `[Tracker] Failed to fetch ${entry.path}:`,
            result.reason instanceof Error ? result.reason.message : String(result.reason)
          );
        }
      });
    }

    return policies;
  }
}
