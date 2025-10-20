/**
 * GitHub Integration Module
 *
 * Provides GitHub API client, markdown parsing, and change tracking
 * for policy synchronization from GitHub repositories.
 */

export { GitHubClient } from './client';
export type { GitHubClientOptions } from './client';

export { ChangeTracker } from './tracker';

export {
  extractPolicyName,
  extractTitle,
  parseMarkdown,
  shouldProcessFile,
  parseMarkdownFiles
} from './markdown';

export type {
  GitHubCommit,
  GitHubTree,
  GitHubTreeEntry,
  GitHubBlob,
  GitHubCompare,
  GitHubFile,
  PolicyDocument,
  ChangeSet
} from './types';
