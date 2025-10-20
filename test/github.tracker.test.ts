import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ChangeTracker } from '../src/github/tracker';
import { GitHubClient } from '../src/github/client';
import type { GitHubCompare, PolicyDocument } from '../src/github/types';

// Mock GitHubClient
vi.mock('../src/github/client');

describe('ChangeTracker', () => {
  let tracker: ChangeTracker;
  let mockClient: any;

  beforeEach(() => {
    mockClient = new GitHubClient() as any;
    tracker = new ChangeTracker(mockClient);
    vi.clearAllMocks();
  });

  describe('detectChanges - incremental sync (with previous commit)', () => {
    it('should detect added files', async () => {
      const mockDiff: GitHubCompare = {
        status: 'ahead',
        ahead_by: 1,
        behind_by: 0,
        total_commits: 1,
        commits: [],
        files: [
          {
            sha: 'file-sha-1',
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

      mockClient.getCommitDiff.mockResolvedValue(mockDiff);
      mockClient.getFileContent.mockResolvedValue('# 신규규정\n\n새로운 규정');

      const changeSet = await tracker.detectChanges(
        'kadragon',
        'knue-policy-hub',
        'new-commit',
        'old-commit'
      );

      expect(changeSet.added).toHaveLength(1);
      expect(changeSet.added[0].policyName).toBe('신규규정');
      expect(changeSet.modified).toHaveLength(0);
      expect(changeSet.deleted).toHaveLength(0);
    });

    it('should detect modified files', async () => {
      const mockDiff: GitHubCompare = {
        status: 'ahead',
        ahead_by: 1,
        behind_by: 0,
        total_commits: 1,
        commits: [],
        files: [
          {
            sha: 'file-sha-2',
            filename: 'policies/학칙.md',
            status: 'modified',
            additions: 3,
            deletions: 1,
            changes: 4,
            blob_url: '',
            raw_url: '',
            contents_url: ''
          }
        ]
      };

      mockClient.getCommitDiff.mockResolvedValue(mockDiff);
      mockClient.getFileContent.mockResolvedValue('# 한국교원대학교 학칙\n\n수정된 내용');

      const changeSet = await tracker.detectChanges(
        'kadragon',
        'knue-policy-hub',
        'new-commit',
        'old-commit'
      );

      expect(changeSet.modified).toHaveLength(1);
      expect(changeSet.modified[0].policyName).toBe('학칙');
      expect(changeSet.added).toHaveLength(0);
      expect(changeSet.deleted).toHaveLength(0);
    });

    it('should detect deleted files', async () => {
      const mockDiff: GitHubCompare = {
        status: 'ahead',
        ahead_by: 1,
        behind_by: 0,
        total_commits: 1,
        commits: [],
        files: [
          {
            sha: 'file-sha-3',
            filename: 'policies/폐기된규정.md',
            status: 'removed',
            additions: 0,
            deletions: 5,
            changes: 5,
            blob_url: '',
            raw_url: '',
            contents_url: ''
          }
        ]
      };

      mockClient.getCommitDiff.mockResolvedValue(mockDiff);

      const changeSet = await tracker.detectChanges(
        'kadragon',
        'knue-policy-hub',
        'new-commit',
        'old-commit'
      );

      expect(changeSet.deleted).toHaveLength(1);
      expect(changeSet.deleted[0]).toBe('폐기된규정');
      expect(changeSet.added).toHaveLength(0);
      expect(changeSet.modified).toHaveLength(0);
    });

    it('should handle renamed files as delete + add', async () => {
      const mockDiff: GitHubCompare = {
        status: 'ahead',
        ahead_by: 1,
        behind_by: 0,
        total_commits: 1,
        commits: [],
        files: [
          {
            sha: 'file-sha-4',
            filename: 'policies/새로운이름.md',
            status: 'renamed',
            additions: 0,
            deletions: 0,
            changes: 0,
            blob_url: '',
            raw_url: '',
            contents_url: '',
            previous_filename: 'policies/예전이름.md'
          }
        ]
      };

      mockClient.getCommitDiff.mockResolvedValue(mockDiff);
      mockClient.getFileContent.mockResolvedValue('# 새로운이름\n\n내용');

      const changeSet = await tracker.detectChanges(
        'kadragon',
        'knue-policy-hub',
        'new-commit',
        'old-commit'
      );

      expect(changeSet.added).toHaveLength(1);
      expect(changeSet.added[0].policyName).toBe('새로운이름');
      expect(changeSet.deleted).toHaveLength(1);
      expect(changeSet.deleted[0]).toBe('예전이름');
    });

    it('should exclude README.md from processing', async () => {
      const mockDiff: GitHubCompare = {
        status: 'ahead',
        ahead_by: 1,
        behind_by: 0,
        total_commits: 1,
        commits: [],
        files: [
          {
            sha: 'file-sha-5',
            filename: 'README.md',
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

      mockClient.getCommitDiff.mockResolvedValue(mockDiff);

      const changeSet = await tracker.detectChanges(
        'kadragon',
        'knue-policy-hub',
        'new-commit',
        'old-commit'
      );

      expect(changeSet.added).toHaveLength(0);
      expect(changeSet.modified).toHaveLength(0);
      expect(changeSet.deleted).toHaveLength(0);
    });

    it('should exclude non-markdown files', async () => {
      const mockDiff: GitHubCompare = {
        status: 'ahead',
        ahead_by: 1,
        behind_by: 0,
        total_commits: 1,
        commits: [],
        files: [
          {
            sha: 'file-sha-6',
            filename: 'policies/document.pdf',
            status: 'added',
            additions: 0,
            deletions: 0,
            changes: 0,
            blob_url: '',
            raw_url: '',
            contents_url: ''
          }
        ]
      };

      mockClient.getCommitDiff.mockResolvedValue(mockDiff);

      const changeSet = await tracker.detectChanges(
        'kadragon',
        'knue-policy-hub',
        'new-commit',
        'old-commit'
      );

      expect(changeSet.added).toHaveLength(0);
    });

    it('should combine multiple changes (add + modify + delete)', async () => {
      const mockDiff: GitHubCompare = {
        status: 'ahead',
        ahead_by: 3,
        behind_by: 0,
        total_commits: 3,
        commits: [],
        files: [
          {
            sha: 'new-sha',
            filename: 'policies/신규.md',
            status: 'added',
            additions: 10,
            deletions: 0,
            changes: 10,
            blob_url: '',
            raw_url: '',
            contents_url: ''
          },
          {
            sha: 'mod-sha',
            filename: 'policies/수정됨.md',
            status: 'modified',
            additions: 2,
            deletions: 1,
            changes: 3,
            blob_url: '',
            raw_url: '',
            contents_url: ''
          },
          {
            sha: 'del-sha',
            filename: 'policies/삭제됨.md',
            status: 'removed',
            additions: 0,
            deletions: 5,
            changes: 5,
            blob_url: '',
            raw_url: '',
            contents_url: ''
          }
        ]
      };

      mockClient.getCommitDiff.mockResolvedValue(mockDiff);
      mockClient.getFileContent.mockResolvedValue('# Test\n\nContent');

      const changeSet = await tracker.detectChanges(
        'kadragon',
        'knue-policy-hub',
        'new-commit',
        'old-commit'
      );

      expect(changeSet.added).toHaveLength(1);
      expect(changeSet.modified).toHaveLength(1);
      expect(changeSet.deleted).toHaveLength(1);
    });
  });

  describe('detectChanges - first run (no previous commit)', () => {
    it('should fetch all files as added on first run', async () => {
      mockClient.getFileTree.mockResolvedValue([
        {
          path: 'policies/학칙.md',
          mode: '100644',
          type: 'blob',
          sha: 'tree-blob-1',
          size: 1024,
          url: ''
        },
        {
          path: 'policies/내규.md',
          mode: '100644',
          type: 'blob',
          sha: 'tree-blob-2',
          size: 512,
          url: ''
        },
        {
          path: 'README.md',
          mode: '100644',
          type: 'blob',
          sha: 'tree-blob-3',
          size: 256,
          url: ''
        }
      ]);

      mockClient.getFileContent.mockResolvedValue('# Test\n\nContent');

      const changeSet = await tracker.detectChanges(
        'kadragon',
        'knue-policy-hub',
        'current-commit'
      );

      expect(changeSet.added).toHaveLength(2);
      expect(changeSet.modified).toHaveLength(0);
      expect(changeSet.deleted).toHaveLength(0);
      expect(mockClient.getFileTree).toHaveBeenCalled();
    });

    it('should skip directories in file tree', async () => {
      mockClient.getFileTree.mockResolvedValue([
        {
          path: 'policies/학칙.md',
          mode: '100644',
          type: 'blob',
          sha: 'blob-1',
          url: ''
        },
        {
          path: 'policies',
          mode: '040000',
          type: 'tree',
          sha: 'tree-1',
          url: ''
        }
      ]);

      mockClient.getFileContent.mockResolvedValue('# Test');

      const changeSet = await tracker.detectChanges(
        'kadragon',
        'knue-policy-hub',
        'commit-sha'
      );

      expect(changeSet.added).toHaveLength(1);
      expect(changeSet.added[0].policyName).toBe('학칙');
    });

    it('should handle errors gracefully on first run', async () => {
      mockClient.getFileTree.mockResolvedValue([
        {
          path: 'policies/valid.md',
          mode: '100644',
          type: 'blob',
          sha: 'blob-1',
          url: ''
        },
        {
          path: 'policies/invalid.md',
          mode: '100644',
          type: 'blob',
          sha: 'blob-2',
          url: ''
        }
      ]);

      mockClient.getFileContent
        .mockResolvedValueOnce('# Valid\n\nContent')
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce('# Invalid\n\nContent');

      const changeSet = await tracker.detectChanges(
        'kadragon',
        'knue-policy-hub',
        'commit-sha'
      );

      // Should continue despite error
      expect(changeSet.added.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('detectChanges - no changes (same commit)', () => {
    it('should return empty changeset when commits are identical', async () => {
      const changeSet = await tracker.detectChanges(
        'kadragon',
        'knue-policy-hub',
        'same-commit',
        'same-commit'
      );

      expect(changeSet.added).toHaveLength(0);
      expect(changeSet.modified).toHaveLength(0);
      expect(changeSet.deleted).toHaveLength(0);
      expect(mockClient.getCommitDiff).not.toHaveBeenCalled();
      expect(mockClient.getFileTree).not.toHaveBeenCalled();
    });
  });

  describe('File content fetching', () => {
    it('should fetch content for added files only', async () => {
      const mockDiff: GitHubCompare = {
        status: 'ahead',
        ahead_by: 1,
        behind_by: 0,
        total_commits: 1,
        commits: [],
        files: [
          {
            sha: 'sha1',
            filename: 'policies/new.md',
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

      mockClient.getCommitDiff.mockResolvedValue(mockDiff);
      mockClient.getFileContent.mockResolvedValue('# New');

      await tracker.detectChanges('kadragon', 'knue-policy-hub', 'new', 'old');

      expect(mockClient.getFileContent).toHaveBeenCalledWith(
        'kadragon',
        'knue-policy-hub',
        'sha1'
      );
    });

    it('should fetch content for modified files', async () => {
      const mockDiff: GitHubCompare = {
        status: 'ahead',
        ahead_by: 1,
        behind_by: 0,
        total_commits: 1,
        commits: [],
        files: [
          {
            sha: 'sha2',
            filename: 'policies/existing.md',
            status: 'modified',
            additions: 2,
            deletions: 1,
            changes: 3,
            blob_url: '',
            raw_url: '',
            contents_url: ''
          }
        ]
      };

      mockClient.getCommitDiff.mockResolvedValue(mockDiff);
      mockClient.getFileContent.mockResolvedValue('# Modified');

      await tracker.detectChanges('kadragon', 'knue-policy-hub', 'new', 'old');

      expect(mockClient.getFileContent).toHaveBeenCalledWith(
        'kadragon',
        'knue-policy-hub',
        'sha2'
      );
    });

    it('should not fetch content for deleted files', async () => {
      const mockDiff: GitHubCompare = {
        status: 'ahead',
        ahead_by: 1,
        behind_by: 0,
        total_commits: 1,
        commits: [],
        files: [
          {
            sha: 'sha3',
            filename: 'policies/deleted.md',
            status: 'removed',
            additions: 0,
            deletions: 5,
            changes: 5,
            blob_url: '',
            raw_url: '',
            contents_url: ''
          }
        ]
      };

      mockClient.getCommitDiff.mockResolvedValue(mockDiff);

      await tracker.detectChanges('kadragon', 'knue-policy-hub', 'new', 'old');

      expect(mockClient.getFileContent).not.toHaveBeenCalled();
    });
  });

  describe('Nested file paths', () => {
    it('should handle deeply nested markdown files', async () => {
      mockClient.getFileTree.mockResolvedValue([
        {
          path: 'docs/rules/academic/standards.md',
          mode: '100644',
          type: 'blob',
          sha: 'blob-1',
          url: ''
        }
      ]);

      mockClient.getFileContent.mockResolvedValue('# Standards');

      const changeSet = await tracker.detectChanges(
        'kadragon',
        'knue-policy-hub',
        'commit-sha'
      );

      expect(changeSet.added[0].policyName).toBe('standards');
    });
  });
});
