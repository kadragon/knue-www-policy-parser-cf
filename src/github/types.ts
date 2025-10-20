/**
 * GitHub API Types
 */

export interface GitHubCommit {
  sha: string;
  commit: {
    message: string;
    author: {
      name: string;
      email: string;
      date: string;
    };
  };
}

export interface GitHubTree {
  sha: string;
  url: string;
  tree: GitHubTreeEntry[];
  truncated: boolean;
}

export interface GitHubTreeEntry {
  path: string;
  mode: string;
  type: 'blob' | 'tree';
  sha: string;
  size?: number;
  url: string;
}

export interface GitHubBlob {
  sha: string;
  content: string;
  encoding: 'base64' | 'utf-8';
  size: number;
}

export interface GitHubCompare {
  status: 'diverged' | 'ahead' | 'behind' | 'identical';
  ahead_by: number;
  behind_by: number;
  total_commits: number;
  commits: GitHubCommit[];
  files: GitHubFile[];
}

export interface GitHubFile {
  sha: string;
  filename: string;
  status: 'added' | 'removed' | 'modified' | 'renamed';
  additions: number;
  deletions: number;
  changes: number;
  blob_url: string;
  raw_url: string;
  contents_url: string;
  patch?: string;
  previous_filename?: string;
}

/**
 * Policy Types for GitHub-based sync
 */
export interface PolicyDocument {
  policyName: string;
  title: string;
  content: string;
  sha: string;
  path: string;
  lastModified?: string;
}

export interface ChangeSet {
  added: PolicyDocument[];
  modified: PolicyDocument[];
  deleted: string[]; // policy names only
}
