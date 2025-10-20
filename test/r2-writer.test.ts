import { describe, it, expect, beforeEach } from 'vitest';
import {
  writePoliciestoR2ByPolicyNameV2,
  writePolicyEntriesToR2V2,
  deletePoliciesFromR2,
  formatPolicyAsMarkdownV2
} from '../src/storage/r2-writer';
import type { ApiPolicy, PolicyEntry } from '../src/kv/types';

describe('writePoliciestoR2ByPolicyNameV2 (v2.0.0)', () => {
  let mockBucket: R2Bucket;
  let storage: Map<string, { content: string; metadata: R2HTTPMetadata }>;

  const mockApiPolicies: ApiPolicy[] = [
    {
      policyName: '학칙',
      title: '한국교원대학교 학칙',
      sha: 'abc123def456789abcdef0123456789abcdef01',
      path: 'policies/학칙.md',
      content: '# 한국교원대학교 학칙\n\n## 개요\n\n이것은 학칙입니다.'
    },
    {
      policyName: '설치령',
      title: '한국교원대학교 설치령',
      sha: 'def456789abcdef0123456789abcdef01234567',
      path: 'policies/설치령.md',
      content: '# 한국교원대학교 설치령\n\n## 제1장\n\n제1조 정의'
    }
  ];

  beforeEach(() => {
    storage = new Map();

    mockBucket = {
      put: async (key: string, value: string, options?: R2PutOptions) => {
        storage.set(key, {
          content: value,
          metadata: (options?.httpMetadata || {}) as R2HTTPMetadata
        });
        return { key } as R2Object;
      },
      get: async (key: string) => {
        const item = storage.get(key);
        if (!item) return null;

        return {
          key,
          body: {
            text: async () => item.content
          }
        } as unknown as R2ObjectBody;
      },
      delete: async (key: string) => {
        storage.delete(key);
      }
    } as unknown as R2Bucket;
  });

  it('should save policies to R2 with policyName-based paths', async () => {
    const timestamp = new Date('2025-10-20T12:00:00Z');
    const result = await writePoliciestoR2ByPolicyNameV2(mockBucket, mockApiPolicies, timestamp);

    expect(result.saved).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.savedPolicies).toHaveLength(2);
    expect(storage.size).toBe(2);
  });

  it('should use correct path structure: policies/{policyName}/policy.md', async () => {
    const timestamp = new Date('2025-10-20T12:00:00Z');
    await writePoliciestoR2ByPolicyNameV2(mockBucket, mockApiPolicies, timestamp);

    const paths = Array.from(storage.keys());
    expect(paths).toContain('policies/학칙/policy.md');
    expect(paths).toContain('policies/설치령/policy.md');
  });

  it('should include YAML front matter with policyName, sha, path', async () => {
    const timestamp = new Date('2025-10-20T12:00:00Z');
    await writePoliciestoR2ByPolicyNameV2(mockBucket, mockApiPolicies, timestamp);

    const saved = storage.get('policies/학칙/policy.md');
    expect(saved).toBeDefined();

    const content = saved!.content;
    expect(content).toContain('policyName: "학칙"');
    expect(content).toContain('title: "한국교원대학교 학칙"');
    expect(content).toContain('sha: "abc123def456789abcdef0123456789abcdef01"');
    expect(content).toContain('path: "policies/학칙.md"');
  });

  it('should preserve GitHub markdown content as-is', async () => {
    const timestamp = new Date('2025-10-20T12:00:00Z');
    await writePoliciestoR2ByPolicyNameV2(mockBucket, mockApiPolicies, timestamp);

    const saved = storage.get('policies/학칙/policy.md');
    const content = saved!.content;

    // Content should include the GitHub markdown
    expect(content).toContain('# 한국교원대학교 학칙');
    expect(content).toContain('## 개요');
    expect(content).toContain('이것은 학칙입니다.');
  });

  it('should set correct content type', async () => {
    const timestamp = new Date('2025-10-20T12:00:00Z');
    await writePoliciestoR2ByPolicyNameV2(mockBucket, mockApiPolicies, timestamp);

    const saved = storage.get('policies/학칙/policy.md');
    expect(saved?.metadata.contentType).toBe('text/markdown; charset=utf-8');
  });

  it('should include savedAt and lastUpdated timestamps in front matter', async () => {
    const timestamp = new Date('2025-10-20T12:00:00Z');
    await writePoliciestoR2ByPolicyNameV2(mockBucket, mockApiPolicies, timestamp);

    const saved = storage.get('policies/학칙/policy.md');
    const content = saved!.content;

    expect(content).toContain('savedAt: "2025-10-20T12:00:00.000Z"');
    expect(content).toContain('lastUpdated: "2025-10-20T12:00:00.000Z"');
  });

  it('should return savedPolicies array with policyName and path', async () => {
    const timestamp = new Date('2025-10-20T12:00:00Z');
    const result = await writePoliciestoR2ByPolicyNameV2(mockBucket, mockApiPolicies, timestamp);

    expect(result.savedPolicies).toBeDefined();
    expect(result.savedPolicies![0]).toEqual({
      policyName: '학칙',
      path: 'policies/학칙/policy.md'
    });
    expect(result.savedPolicies![1]).toEqual({
      policyName: '설치령',
      path: 'policies/설치령/policy.md'
    });
  });

  it('should handle empty policies array', async () => {
    const timestamp = new Date('2025-10-20T12:00:00Z');
    const result = await writePoliciestoR2ByPolicyNameV2(mockBucket, [], timestamp);

    expect(result.saved).toBe(false);
    expect(result.skipped).toBe(true);
    expect(storage.size).toBe(0);
  });

  it('should handle error gracefully and continue with next policy', async () => {
    let callCount = 0;
    mockBucket = {
      put: async (key: string, value: string, options?: R2PutOptions) => {
        callCount++;
        if (callCount === 1) {
          throw new Error('R2 write failed');
        }
        storage.set(key, {
          content: value,
          metadata: (options?.httpMetadata || {}) as R2HTTPMetadata
        });
        return { key } as R2Object;
      },
      delete: async (key: string) => {
        storage.delete(key);
      }
    } as unknown as R2Bucket;

    const timestamp = new Date('2025-10-20T12:00:00Z');
    const result = await writePoliciestoR2ByPolicyNameV2(mockBucket, mockApiPolicies, timestamp);

    // First policy failed, second succeeded
    expect(result.saved).toBe(true);
    expect(result.savedPolicies).toHaveLength(1);
    expect(storage.has('policies/설치령/policy.md')).toBe(true);
  });

  it('should escape special characters in YAML front matter', async () => {
    const specialPolicy: ApiPolicy = {
      policyName: '특수문자"테스트',
      title: '제목에 "따옴표"가 있음',
      sha: 'abc123def456789abcdef0123456789abcdef01',
      path: 'policies/test.md',
      content: '# Test'
    };

    const timestamp = new Date('2025-10-20T12:00:00Z');
    await writePoliciestoR2ByPolicyNameV2(mockBucket, [specialPolicy], timestamp);

    const saved = storage.get('policies/특수문자"테스트/policy.md');
    expect(saved).toBeDefined();

    const content = saved!.content;
    expect(content).toContain('policyName: "특수문자\\"테스트"');
    expect(content).toContain('title: "제목에 \\"따옴표\\"가 있음"');
  });
});

describe('deletePoliciesFromR2', () => {
  let mockBucket: R2Bucket;
  let deletedKeys: string[];
  let failureNames: Set<string>;

  beforeEach(() => {
    deletedKeys = [];
    failureNames = new Set();

    mockBucket = {
      delete: async (key: string) => {
        const policyName = key.replace('policies/', '').replace('/policy.md', '');
        if (failureNames.has(policyName)) {
          throw new Error(`Failed to delete ${policyName}`);
        }
        deletedKeys.push(key);
      }
    } as unknown as R2Bucket;
  });

  it('should delete policies from R2 bucket', async () => {
    const result = await deletePoliciesFromR2(mockBucket, ['학칙', '규정1']);

    expect(result.deleted).toHaveLength(2);
    expect(result.errors).toHaveLength(0);
    expect(deletedKeys).toEqual([
      'policies/학칙/policy.md',
      'policies/규정1/policy.md'
    ]);
  });

  it('should continue deleting when an error occurs', async () => {
    failureNames.add('학칙');

    const result = await deletePoliciesFromR2(mockBucket, ['학칙', '규정1']);

    expect(result.deleted).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toEqual({
      policyName: '학칙',
      error: 'Failed to delete 학칙'
    });
    expect(deletedKeys).toContain('policies/규정1/policy.md');
  });
});

describe('writePolicyEntriesToR2V2', () => {
  let mockBucket: R2Bucket;
  let storage: Map<string, { content: string; metadata: R2HTTPMetadata }>;

  const mockEntries: Array<PolicyEntry & { content: string }> = [
    {
      policyName: '학칙',
      title: '한국교원대학교 학칙',
      sha: 'abc123def456789abcdef0123456789abcdef01',
      path: 'policies/학칙.md',
      status: 'active',
      lastUpdated: '2025-10-20T11:00:00Z',
      content: '# 한국교원대학교 학칙\n\n정책 내용'
    }
  ];

  beforeEach(() => {
    storage = new Map();

    mockBucket = {
      put: async (key: string, value: string, options?: R2PutOptions) => {
        storage.set(key, {
          content: value,
          metadata: (options?.httpMetadata || {}) as R2HTTPMetadata
        });
        return { key } as R2Object;
      },
      delete: async (key: string) => {
        storage.delete(key);
      }
    } as unknown as R2Bucket;
  });

  it('should save policy entries to R2', async () => {
    const timestamp = new Date('2025-10-20T12:00:00Z');
    const result = await writePolicyEntriesToR2V2(mockBucket, mockEntries, timestamp);

    expect(result.saved).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.savedPolicies).toHaveLength(1);
    expect(storage.size).toBe(1);
  });

  it('should use policyName in path', async () => {
    const timestamp = new Date('2025-10-20T12:00:00Z');
    await writePolicyEntriesToR2V2(mockBucket, mockEntries, timestamp);

    const paths = Array.from(storage.keys());
    expect(paths).toContain('policies/학칙/policy.md');
  });

  it('should include YAML front matter from policy entry', async () => {
    const timestamp = new Date('2025-10-20T12:00:00Z');
    await writePolicyEntriesToR2V2(mockBucket, mockEntries, timestamp);

    const saved = storage.get('policies/학칙/policy.md');
    const content = saved!.content;

    expect(content).toContain('policyName: "학칙"');
    expect(content).toContain('title: "한국교원대학교 학칙"');
    expect(content).toContain('sha: "abc123def456789abcdef0123456789abcdef01"');
    expect(content).toContain('path: "policies/학칙.md"');
  });

  it('should include entry content in body', async () => {
    const timestamp = new Date('2025-10-20T12:00:00Z');
    await writePolicyEntriesToR2V2(mockBucket, mockEntries, timestamp);

    const saved = storage.get('policies/학칙/policy.md');
    const content = saved!.content;

    expect(content).toContain('# 한국교원대학교 학칙');
    expect(content).toContain('정책 내용');
  });

  it('should handle empty entries array', async () => {
    const timestamp = new Date('2025-10-20T12:00:00Z');
    const result = await writePolicyEntriesToR2V2(mockBucket, [], timestamp);

    expect(result.saved).toBe(false);
    expect(result.skipped).toBe(true);
  });
});

describe('formatPolicyAsMarkdownV2', () => {
  it('should format policy with YAML front matter', () => {
    const data = {
      policyName: '학칙',
      title: '한국교원대학교 학칙',
      sha: 'abc123',
      path: 'policies/학칙.md',
      content: '# 학칙\n\n내용',
      savedAt: '2025-10-20T12:00:00Z',
      lastUpdated: '2025-10-20T11:00:00Z'
    };

    const result = formatPolicyAsMarkdownV2(data);

    expect(result).toContain('---');
    expect(result).toContain('policyName: "학칙"');
    expect(result).toContain('title: "한국교원대학교 학칙"');
    expect(result).toContain('sha: "abc123"');
    expect(result).toContain('path: "policies/학칙.md"');
    expect(result).toContain('# 학칙');
    expect(result).toContain('내용');
  });

  it('should preserve content exactly as provided', () => {
    const data = {
      policyName: 'test',
      title: 'Test Policy',
      sha: 'abc123',
      path: 'policies/test.md',
      content: '# Test\n\nWith **markdown** formatting\n\n- List item 1\n- List item 2',
      savedAt: '2025-10-20T12:00:00Z',
      lastUpdated: '2025-10-20T11:00:00Z'
    };

    const result = formatPolicyAsMarkdownV2(data);

    expect(result).toContain('# Test\n\nWith **markdown** formatting\n\n- List item 1\n- List item 2');
  });

  it('should escape special characters in YAML values', () => {
    const data = {
      policyName: 'test"name',
      title: 'Title with "quotes"',
      sha: 'abc123',
      path: 'policies/test.md',
      content: '# Test',
      savedAt: '2025-10-20T12:00:00Z',
      lastUpdated: '2025-10-20T11:00:00Z'
    };

    const result = formatPolicyAsMarkdownV2(data);

    expect(result).toContain('policyName: "test\\"name"');
    expect(result).toContain('title: "Title with \\"quotes\\""');
  });
});
