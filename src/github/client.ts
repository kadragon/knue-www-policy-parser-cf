/**
 * GitHub API Client
 *
 * Provides methods to interact with GitHub REST API v3 for fetching commits,
 * file trees, and blob content.
 */

import type {
  GitHubCommit,
  GitHubTree,
  GitHubBlob,
  GitHubCompare,
  GitHubTreeEntry
} from './types';

export interface GitHubClientOptions {
  token?: string;
  timeoutMs?: number;
  maxRetries?: number;
}

export class GitHubClient {
  private readonly baseUrl = 'https://api.github.com';
  private readonly token?: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  constructor(options: GitHubClientOptions = {}) {
    this.token = options.token;
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.maxRetries = options.maxRetries ?? 3;
  }

  /**
   * Get the latest commit SHA for a branch
   */
  async getLatestCommit(
    owner: string,
    repo: string,
    branch: string
  ): Promise<string> {
    const url = `${this.baseUrl}/repos/${owner}/${repo}/commits/${branch}`;
    const commit = await this.fetchWithRetry<GitHubCommit>(url);
    return commit.sha;
  }

  /**
   * Get the diff between two commits
   */
  async getCommitDiff(
    owner: string,
    repo: string,
    baseCommit: string,
    headCommit: string
  ): Promise<GitHubCompare> {
    const url = `${this.baseUrl}/repos/${owner}/${repo}/compare/${baseCommit}...${headCommit}`;
    return await this.fetchWithRetry<GitHubCompare>(url);
  }

  /**
   * Get the file tree for a commit (optionally recursive)
   */
  async getFileTree(
    owner: string,
    repo: string,
    commitSHA: string,
    recursive: boolean = true
  ): Promise<GitHubTreeEntry[]> {
    const url = `${this.baseUrl}/repos/${owner}/${repo}/git/trees/${commitSHA}${
      recursive ? '?recursive=1' : ''
    }`;
    const tree = await this.fetchWithRetry<GitHubTree>(url);
    return tree.tree;
  }

  /**
   * Get the content of a file blob (decoded from base64)
   */
  async getFileContent(
    owner: string,
    repo: string,
    blobSHA: string
  ): Promise<string> {
    const url = `${this.baseUrl}/repos/${owner}/${repo}/git/blobs/${blobSHA}`;
    const blob = await this.fetchWithRetry<GitHubBlob>(url);

    if (blob.encoding === 'base64') {
      // Decode base64 content
      return this.decodeBase64(blob.content);
    }

    return blob.content;
  }

  /**
   * Fetch with retry logic and timeout
   */
  private async fetchWithRetry<T>(url: string): Promise<T> {
    let lastError: Error | null = null;
    let delay = 1000; // Start with 1 second delay

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

        try {
          const headers: Record<string, string> = {
            Accept: 'application/vnd.github.v3+json',
            'User-Agent': 'KNUE-Policy-Parser/2.0'
          };

          if (this.token) {
            headers.Authorization = `Bearer ${this.token}`;
          }

          const response = await fetch(url, {
            signal: controller.signal,
            headers
          });

          if (!response.ok) {
            // Check for rate limit
            if (response.status === 403) {
              const rateLimitRemaining = response.headers.get('X-RateLimit-Remaining');
              if (rateLimitRemaining === '0') {
                const resetTime = response.headers.get('X-RateLimit-Reset');
                throw new Error(
                  `GitHub API rate limit exceeded. Reset at: ${resetTime}`
                );
              }
            }

            // Check for not found
            if (response.status === 404) {
              throw new Error(`GitHub resource not found: ${url}`);
            }

            throw new Error(
              `GitHub API error: ${response.status} ${response.statusText}`
            );
          }

          const data = (await response.json()) as T;

          if (attempt > 1) {
            console.log(`✓ GitHub API request succeeded on attempt ${attempt}`);
          }

          return data;
        } finally {
          clearTimeout(timeoutId);
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        const isRetryable =
          error instanceof Error &&
          (error.name === 'AbortError' ||
            error.message.includes('503') ||
            error.message.includes('ECONNRESET'));

        if (attempt < this.maxRetries && isRetryable) {
          console.log(
            `⚠ GitHub API attempt ${attempt} failed: ${lastError.message}. Retrying in ${delay}ms...`
          );
          await new Promise(resolve => setTimeout(resolve, delay));
          delay = Math.min(delay * 2, 10000); // Exponential backoff, max 10s
        } else if (!isRetryable) {
          throw lastError;
        }
      }
    }

    throw lastError || new Error('GitHub API request failed after all retries');
  }

  /**
   * Decode base64 string to UTF-8
   */
  private decodeBase64(base64: string): string {
    // Remove newlines that GitHub adds to base64 content
    const cleaned = base64.replace(/\n/g, '');

    // Decode base64 to binary string
    const binaryString = atob(cleaned);

    // Convert binary string to UTF-8
    const bytes = Uint8Array.from(binaryString, char => char.charCodeAt(0));

    return new TextDecoder('utf-8').decode(bytes);
  }
}
