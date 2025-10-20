import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GitHubClient } from '../src/github/client';
import type { GitHubCommit, GitHubTree, GitHubBlob, GitHubCompare } from '../src/github/types';

describe('GitHubClient', () => {
  let client: GitHubClient;

  beforeEach(() => {
    client = new GitHubClient({ timeoutMs: 5000, maxRetries: 2 });
    vi.clearAllMocks();
  });

  describe('getLatestCommit', () => {
    it('should fetch and return commit SHA', async () => {
      const mockCommit: GitHubCommit = {
        sha: 'abc123def456789',
        commit: {
          message: 'Update policies',
          author: {
            name: 'Test Author',
            email: 'test@example.com',
            date: '2025-10-20T10:00:00Z'
          }
        }
      };

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => mockCommit,
        headers: new Map()
      } as any);

      const sha = await client.getLatestCommit('kadragon', 'knue-policy-hub', 'main');

      expect(sha).toBe('abc123def456789');
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/kadragon/knue-policy-hub/commits/main',
        expect.any(Object)
      );
    });

    it('should throw on 404 not found', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        headers: new Map()
      } as any);

      await expect(
        client.getLatestCommit('invalid', 'repo', 'main')
      ).rejects.toThrow('GitHub resource not found');
    });

    it('should throw on rate limit (403)', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        headers: new Map([
          ['X-RateLimit-Remaining', '0'],
          ['X-RateLimit-Reset', '1609459200']
        ])
      } as any);

      await expect(
        client.getLatestCommit('kadragon', 'knue-policy-hub', 'main')
      ).rejects.toThrow('GitHub API rate limit exceeded');
    });

    it('should retry on transient error', async () => {
      const mockCommit: GitHubCommit = {
        sha: 'retry-success-sha',
        commit: { message: '', author: { name: '', email: '', date: '' } }
      };

      const transientError = new Error('503 Service Unavailable');
      const fetchMock = vi
        .fn()
        .mockRejectedValueOnce(transientError)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockCommit,
          headers: new Map()
        } as any);

      global.fetch = fetchMock;

      const sha = await client.getLatestCommit('kadragon', 'knue-policy-hub', 'main');

      expect(sha).toBe('retry-success-sha');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('getCommitDiff', () => {
    it('should fetch commit diff with file changes', async () => {
      const mockDiff: GitHubCompare = {
        status: 'ahead',
        ahead_by: 2,
        behind_by: 0,
        total_commits: 2,
        commits: [],
        files: [
          {
            sha: 'file1-sha',
            filename: 'policies/학칙.md',
            status: 'modified',
            additions: 5,
            deletions: 2,
            changes: 7,
            blob_url: '',
            raw_url: '',
            contents_url: ''
          },
          {
            sha: 'file2-sha',
            filename: 'policies/신규규정.md',
            status: 'added',
            additions: 10,
            deletions: 0,
            changes: 10,
            blob_url: '',
            raw_url: '',
            contents_url: ''
          }
        ]
      };

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => mockDiff,
        headers: new Map()
      } as any);

      const diff = await client.getCommitDiff('kadragon', 'knue-policy-hub', 'abc123', 'def456');

      expect(diff.files).toHaveLength(2);
      expect(diff.files[0].filename).toBe('policies/학칙.md');
      expect(diff.files[0].status).toBe('modified');
      expect(diff.files[1].status).toBe('added');
    });

    it('should handle identical commits (no changes)', async () => {
      const mockDiff: GitHubCompare = {
        status: 'identical',
        ahead_by: 0,
        behind_by: 0,
        total_commits: 0,
        commits: [],
        files: []
      };

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => mockDiff,
        headers: new Map()
      } as any);

      const diff = await client.getCommitDiff('kadragon', 'knue-policy-hub', 'abc123', 'abc123');

      expect(diff.status).toBe('identical');
      expect(diff.files).toHaveLength(0);
    });
  });

  describe('getFileTree', () => {
    it('should fetch file tree recursively', async () => {
      const mockTree: GitHubTree = {
        sha: 'tree-sha',
        url: '',
        truncated: false,
        tree: [
          {
            path: 'policies/학칙.md',
            mode: '100644',
            type: 'blob',
            sha: 'blob1-sha',
            size: 1024,
            url: ''
          },
          {
            path: 'policies/내규.md',
            mode: '100644',
            type: 'blob',
            sha: 'blob2-sha',
            size: 512,
            url: ''
          },
          {
            path: 'docs',
            mode: '040000',
            type: 'tree',
            sha: 'tree2-sha',
            url: ''
          }
        ]
      };

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => mockTree,
        headers: new Map()
      } as any);

      const tree = await client.getFileTree('kadragon', 'knue-policy-hub', 'commit-sha', true);

      expect(tree).toHaveLength(3);
      expect(tree[0].path).toBe('policies/학칙.md');
      expect(tree[0].type).toBe('blob');
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('?recursive=1'),
        expect.any(Object)
      );
    });

    it('should fetch file tree non-recursively', async () => {
      const mockTree: GitHubTree = {
        sha: 'tree-sha',
        url: '',
        truncated: false,
        tree: []
      };

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => mockTree,
        headers: new Map()
      } as any);

      await client.getFileTree('kadragon', 'knue-policy-hub', 'commit-sha', false);

      expect(global.fetch).toHaveBeenCalledWith(
        expect.not.stringContaining('?recursive=1'),
        expect.any(Object)
      );
    });
  });

  describe('getFileContent', () => {
    it('should decode base64 content', async () => {
      const mockBlob: GitHubBlob = {
        sha: 'blob-sha',
        content: btoa('# Test Policy\n\nContent here'),
        encoding: 'base64',
        size: 100
      };

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => mockBlob,
        headers: new Map()
      } as any);

      const content = await client.getFileContent('kadragon', 'knue-policy-hub', 'blob-sha');

      expect(content).toBe('# Test Policy\n\nContent here');
    });

    it('should handle UTF-8 content', async () => {
      const mockBlob: GitHubBlob = {
        sha: 'blob-sha',
        content: '# 학칙\n\n대학 규정',
        encoding: 'utf-8',
        size: 100
      };

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => mockBlob,
        headers: new Map()
      } as any);

      const content = await client.getFileContent('kadragon', 'knue-policy-hub', 'blob-sha');

      expect(content).toBe('# 학칙\n\n대학 규정');
    });

    it('should handle base64 with newlines', async () => {
      const originalContent = 'A'.repeat(100);
      const base64WithNewlines = btoa(originalContent).replace(/(.{60})/g, '$1\n');

      const mockBlob: GitHubBlob = {
        sha: 'blob-sha',
        content: base64WithNewlines,
        encoding: 'base64',
        size: 100
      };

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => mockBlob,
        headers: new Map()
      } as any);

      const content = await client.getFileContent('kadragon', 'knue-policy-hub', 'blob-sha');

      expect(content).toBe(originalContent);
    });
  });

  describe('Authorization', () => {
    it('should include token in Authorization header when provided', async () => {
      const clientWithToken = new GitHubClient({ token: 'test-token-123' });

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ sha: 'test-sha' }),
        headers: new Map()
      } as any);

      await clientWithToken.getLatestCommit('kadragon', 'knue-policy-hub', 'main');

      const callArgs = (global.fetch as any).mock.calls[0][1];
      expect(callArgs.headers.Authorization).toBe('Bearer test-token-123');
    });

    it('should not include token when not provided', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ sha: 'test-sha' }),
        headers: new Map()
      } as any);

      await client.getLatestCommit('kadragon', 'knue-policy-hub', 'main');

      const callArgs = (global.fetch as any).mock.calls[0][1];
      expect(callArgs.headers.Authorization).toBeUndefined();
    });
  });
});
