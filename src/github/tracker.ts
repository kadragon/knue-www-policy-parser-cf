/**
 * Change Tracker
 *
 * Detects changes in policy files between Git commits using GitHub API.
 */

import type { ChangeSet, PolicyDocument } from './types';
import type { GitHubClient } from './client';
import { parseMarkdown, shouldProcessFile } from './markdown';

export class ChangeTracker {
  constructor(private client: GitHubClient) {}

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

    // Process changed files
    const added: PolicyDocument[] = [];
    const modified: PolicyDocument[] = [];
    const deleted: string[] = [];

    for (const file of diff.files) {
      // Only process markdown files (excluding README)
      if (!shouldProcessFile(file.filename)) {
        continue;
      }

      if (file.status === 'added') {
        // Fetch content for added file
        const content = await this.client.getFileContent(owner, repo, file.sha);
        const policy = parseMarkdown(content, file.filename, file.sha);
        added.push(policy);
        console.log(`[Tracker] ADD: ${policy.policyName}`);
      } else if (file.status === 'modified') {
        // Fetch content for modified file
        const content = await this.client.getFileContent(owner, repo, file.sha);
        const policy = parseMarkdown(content, file.filename, file.sha);
        modified.push(policy);
        console.log(`[Tracker] UPDATE: ${policy.policyName}`);
      } else if (file.status === 'removed') {
        // Extract policy name from deleted file
        const policyName = file.filename.split('/').pop()?.replace(/\.md$/i, '') || '';
        if (policyName) {
          deleted.push(policyName);
          console.log(`[Tracker] DELETE: ${policyName}`);
        }
      } else if (file.status === 'renamed') {
        // Handle rename: delete old, add new
        if (file.previous_filename) {
          const oldPolicyName =
            file.previous_filename.split('/').pop()?.replace(/\.md$/i, '') || '';
          if (oldPolicyName) {
            deleted.push(oldPolicyName);
            console.log(`[Tracker] DELETE (renamed): ${oldPolicyName}`);
          }
        }

        const content = await this.client.getFileContent(owner, repo, file.sha);
        const policy = parseMarkdown(content, file.filename, file.sha);
        added.push(policy);
        console.log(`[Tracker] ADD (renamed): ${policy.policyName}`);
      }
    }

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

      try {
        const content = await this.client.getFileContent(owner, repo, entry.sha);
        const policy = parseMarkdown(content, entry.path, entry.sha);
        policies.push(policy);

        if (logContext === 'initial') {
          console.log(`[Tracker] ADD (initial): ${policy.policyName}`);
        }
      } catch (error) {
        console.error(
          `[Tracker] Failed to fetch ${entry.path}:`,
          error instanceof Error ? error.message : String(error)
        );
      }
    }

    return policies;
  }
}
