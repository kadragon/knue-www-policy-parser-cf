import { describe, it, expect, beforeEach } from 'vitest';
import { writeLinksToR2, writePoliciestoR2ByPolicyNameV2, writePolicyEntriesToR2V2, formatPolicyAsMarkdownV2 } from '../src/storage/r2-writer';
import type { PolicyLink } from '../src/page/parser';
import type { ApiPolicy, PolicyEntry } from '../src/kv/types';

const mockLinks: PolicyLink[] = [
  {
    fileNo: '868',
    previewUrl: 'https://www.knue.ac.kr/www/previewMenuCntFile.do?key=392&fileNo=868',
    downloadUrl: 'https://www.knue.ac.kr/downloadContentsFile.do?key=392&fileNo=868',
    title: '한국교원대학교 설치령'
  },
  {
    fileNo: '1345',
    previewUrl: 'https://www.knue.ac.kr/www/previewMenuCntFile.do?key=392&fileNo=1345',
    downloadUrl: 'https://www.knue.ac.kr/downloadContentsFile.do?key=392&fileNo=1345',
    title: '한국교원대학교 학칙'
  }
];

describe('writeLinksToR2', () => {
  let mockBucket: R2Bucket;
  let storage: Map<string, { content: string; metadata: R2HTTPMetadata }>;

  beforeEach(() => {
    storage = new Map();

    mockBucket = {
      head: async (key: string) => {
        return storage.has(key)
          ? ({ key } as R2Object)
          : null;
      },
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
      }
    } as unknown as R2Bucket;
  });

  it('should save links to R2', async () => {
    const timestamp = new Date('2025-10-19T03:00:00Z');
    const result = await writeLinksToR2(mockBucket, mockLinks, '392', timestamp);

    expect(result.saved).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.path).toBe('policy/392/2025_10_19_links.json');
    expect(storage.has('policy/392/2025_10_19_links.json')).toBe(true);
  });

  it('should save JSON with correct structure', async () => {
    const timestamp = new Date('2025-10-19T03:00:00Z');
    await writeLinksToR2(mockBucket, mockLinks, '392', timestamp);

    const saved = storage.get('policy/392/2025_10_19_links.json');
    expect(saved).toBeDefined();

    const parsed = JSON.parse(saved!.content);
    expect(parsed.timestamp).toBe('2025-10-19T03:00:00.000Z');
    expect(parsed.pageKey).toBe('392');
    expect(parsed.count).toBe(2);
    expect(parsed.links).toHaveLength(2);
    expect(parsed.links[0].fileNo).toBe('868');
  });

  it('should set correct content type', async () => {
    const timestamp = new Date('2025-10-19T03:00:00Z');
    await writeLinksToR2(mockBucket, mockLinks, '392', timestamp);

    const saved = storage.get('policy/392/2025_10_19_links.json');
    expect(saved?.metadata.contentType).toBe('application/json');
  });

  it('should skip if file already exists', async () => {
    const timestamp = new Date('2025-10-19T03:00:00Z');

    // First write
    const result1 = await writeLinksToR2(mockBucket, mockLinks, '392', timestamp);
    expect(result1.saved).toBe(true);

    // Second write (same day)
    const result2 = await writeLinksToR2(mockBucket, mockLinks, '392', timestamp);
    expect(result2.saved).toBe(false);
    expect(result2.skipped).toBe(true);
  });

  it('should use different path for different dates', async () => {
    const timestamp1 = new Date('2025-10-19T03:00:00Z');
    const timestamp2 = new Date('2025-10-20T03:00:00Z');

    const result1 = await writeLinksToR2(mockBucket, mockLinks, '392', timestamp1);
    const result2 = await writeLinksToR2(mockBucket, mockLinks, '392', timestamp2);

    expect(result1.saved).toBe(true);
    expect(result2.saved).toBe(true);
    expect(result1.path).toBe('policy/392/2025_10_19_links.json');
    expect(result2.path).toBe('policy/392/2025_10_20_links.json');
  });

  it('should handle empty links array', async () => {
    const timestamp = new Date('2025-10-19T03:00:00Z');
    const result = await writeLinksToR2(mockBucket, [], '392', timestamp);

    expect(result.saved).toBe(true);

    const saved = storage.get('policy/392/2025_10_19_links.json');
    const parsed = JSON.parse(saved!.content);
    expect(parsed.count).toBe(0);
    expect(parsed.links).toHaveLength(0);
  });
});

/**
 * v2.0.0 Tests: GitHub-based policies with policyName-centric structure
 */
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
    const content = saved!.content;

    // Should be properly escaped
    expect(content).toContain('policyName: "특수문자\\"테스트"');
    expect(content).toContain('title: "제목에 \\"따옴표\\"가 있음"');
  });

  it('should handle policies with backward compatibility fields', async () => {
    const legacyPolicy: ApiPolicy = {
      policyName: '학칙',
      title: '한국교원대학교 학칙',
      sha: 'abc123def456789abcdef0123456789abcdef01',
      path: 'policies/학칙.md',
      content: '# 학칙',
      // v1.x backward compatibility
      fileNo: '868',
      previewUrl: 'https://example.com/preview/868',
      downloadUrl: 'https://example.com/download/868'
    };

    const timestamp = new Date('2025-10-20T12:00:00Z');
    await writePoliciestoR2ByPolicyNameV2(mockBucket, [legacyPolicy], timestamp);

    const saved = storage.get('policies/학칙/policy.md');
    const content = saved!.content;

    // v2.0.0 fields should be present
    expect(content).toContain('policyName: "학칙"');
    expect(content).toContain('sha: "abc123def456789abcdef0123456789abcdef01"');
    // v1.x fields should NOT be present (not passed to formatPolicyAsMarkdownV2)
    expect(content).not.toContain('fileNo');
  });
});

describe('formatPolicyAsMarkdownV2', () => {
  it('should create valid YAML front matter', () => {
    const data = {
      policyName: '학칙',
      title: '한국교원대학교 학칙',
      sha: 'abc123def456789abcdef0123456789abcdef01',
      path: 'policies/학칙.md',
      content: '# Content here',
      savedAt: '2025-10-20T12:00:00Z',
      lastUpdated: '2025-10-20T12:00:00Z'
    };

    const formatted = formatPolicyAsMarkdownV2(data);

    // Split by --- to verify front matter structure
    const parts = formatted.split('---');
    expect(parts.length).toBeGreaterThanOrEqual(3); // opening ---, closing ---, content
    expect(parts[0]).toBe(''); // Before opening ---
    expect(parts[1]).toContain('policyName:'); // Front matter content
    expect(parts[2].trim()).not.toBe(''); // Content exists after closing ---
  });

  it('should include content after front matter', () => {
    const data = {
      policyName: '학칙',
      title: '한국교원대학교 학칙',
      sha: 'abc123def456789abcdef0123456789abcdef01',
      path: 'policies/학칙.md',
      content: '# My Custom Content\n\nWith multiple lines',
      savedAt: '2025-10-20T12:00:00Z',
      lastUpdated: '2025-10-20T12:00:00Z'
    };

    const formatted = formatPolicyAsMarkdownV2(data);

    expect(formatted).toContain('# My Custom Content');
    expect(formatted).toContain('With multiple lines');
  });
});

describe('writePolicyEntriesToR2V2', () => {
  let mockBucket: R2Bucket;
  let storage: Map<string, { content: string; metadata: R2HTTPMetadata }>;

  const mockEntries: Array<PolicyEntry & { content: string }> = [
    {
      policyName: '학칙',
      title: '한국교원대학교 학칙',
      status: 'active',
      lastUpdated: '2025-10-20T11:00:00Z',
      sha: 'abc123def456789abcdef0123456789abcdef01',
      path: 'policies/학칙.md',
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
      }
    } as unknown as R2Bucket;
  });

  it('should write PolicyEntry objects with content to R2', async () => {
    const timestamp = new Date('2025-10-20T12:00:00Z');
    const result = await writePolicyEntriesToR2V2(mockBucket, mockEntries, timestamp);

    expect(result.saved).toBe(true);
    expect(result.savedPolicies).toHaveLength(1);
    expect(storage.has('policies/학칙/policy.md')).toBe(true);
  });

  it('should use PolicyEntry.lastUpdated in front matter', async () => {
    const timestamp = new Date('2025-10-20T12:00:00Z');
    await writePolicyEntriesToR2V2(mockBucket, mockEntries, timestamp);

    const saved = storage.get('policies/학칙/policy.md');
    const content = saved!.content;

    // Should use entry's lastUpdated, not the timestamp
    expect(content).toContain('lastUpdated: "2025-10-20T11:00:00Z"');
  });

  it('should include backward compatibility fields if present', async () => {
    const entryWithLegacy: PolicyEntry & { content: string } = {
      ...mockEntries[0],
      fileNo: '868',
      previewUrl: 'https://example.com/preview',
      downloadUrl: 'https://example.com/download'
    };

    const timestamp = new Date('2025-10-20T12:00:00Z');
    await writePolicyEntriesToR2V2(mockBucket, [entryWithLegacy], timestamp);

    const saved = storage.get('policies/학칙/policy.md');
    const content = saved!.content;

    // v1.x fields should be included in front matter
    expect(content).toContain('fileNo: "868"');
    expect(content).toContain('previewUrl: "https://example.com/preview"');
    expect(content).toContain('downloadUrl: "https://example.com/download"');
  });
});
