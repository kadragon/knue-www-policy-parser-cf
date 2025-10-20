import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import worker from '../../src/index';

const fixtureHTML = readFileSync(
  join(__dirname, '../../fixtures/policy-page-sample.html'),
  'utf-8'
);

describe('Policy Parser Integration', () => {
  let mockEnv: {
    POLICY_STORAGE: R2Bucket;
    POLICY_REGISTRY: KVNamespace;
    GITHUB_REPO: string;
    GITHUB_BRANCH: string;
    GITHUB_TOKEN?: string;
  };
  let storage: Map<string, { content: string; metadata: R2HTTPMetadata }>;
  let kvStorage: Map<string, string>;

  beforeEach(() => {
    storage = new Map();
    kvStorage = new Map();

    mockEnv = {
      GITHUB_REPO: 'kadragon/knue-policy-hub',
      GITHUB_BRANCH: 'main',
      POLICY_STORAGE: {
        head: async (key: string) => {
          return storage.has(key) ? ({ key } as R2Object) : null;
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
      } as unknown as R2Bucket,
      POLICY_REGISTRY: {
        get: async (key: string, options?: any) => {
          return kvStorage.get(key) || null;
        },
        put: async (key: string, value: string, options?: any) => {
          kvStorage.set(key, value);
        },
        delete: async (key: string) => {
          kvStorage.delete(key);
        },
        list: async (options?: any) => {
          const prefix = options?.prefix || '';
          const limit = options?.limit || 1000;
          const filteredKeys = Array.from(kvStorage.keys())
            .filter(key => key.startsWith(prefix))
            .slice(0, limit);

          return {
            keys: filteredKeys.map(name => ({ name, metadata: null })),
            list_complete: true,
            cacheStatus: null
          } as unknown as KVNamespaceListResult<any>;
        }
      } as unknown as KVNamespace
    };

    // Mock global fetch for GitHub API (v3.0.0 - GitHub-based workflow)
    global.fetch = (async (url: RequestInfo | URL) => {
      const urlString = url.toString();

      // Mock GitHub API: get latest commit
      if (urlString.includes('/repos/kadragon/knue-policy-hub/commits/main')) {
        return new Response(JSON.stringify({
          sha: 'abc123def456789abc123def456789abc12345',
          commit: {
            message: 'Update policies',
            author: { name: 'Test', date: new Date().toISOString() }
          }
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Mock GitHub API: compare commits (detect changes)
      if (urlString.includes('/repos/kadragon/knue-policy-hub/compare')) {
        return new Response(JSON.stringify({
          files: [
            {
              filename: 'policies/학칙.md',
              status: 'added',
              patch: '+# 학칙\n+내용'
            },
            {
              filename: 'policies/규정1.md',
              status: 'added',
              patch: '+# 규정 1\n+내용'
            }
          ]
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Mock GitHub API: get file tree
      if (urlString.includes('/repos/kadragon/knue-policy-hub/git/trees')) {
        return new Response(JSON.stringify({
          tree: [
            { path: 'policies/학칙.md', type: 'blob', sha: 'blob1' },
            { path: 'policies/규정1.md', type: 'blob', sha: 'blob2' }
          ],
          truncated: false
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Mock GitHub API: get blob content
      if (urlString.includes('/repos/kadragon/knue-policy-hub/git/blobs')) {
        return new Response(JSON.stringify({
          content: btoa('# 정책 제목\n\n정책 내용\n\n## 기본 정보\n정보\n\n## 링크\n링크'),
          encoding: 'base64'
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      return new Response('Not Found', { status: 404 });
    }) as unknown as typeof fetch;
  });

  it('should reject direct HTTP requests', async () => {
    const request = new Request('http://localhost:8787/');
    const response = await worker.fetch(request, mockEnv, {} as ExecutionContext);

    expect(response.status).toBe(405);

    const body = await response.json();
    expect(body).toMatchObject({
      error: 'Method Not Allowed',
      message: expect.stringContaining('cron triggers')
    });
  });

  it('should successfully collect and save policy links', async () => {
    const controller = {} as ScheduledController;
    const ctx = {} as ExecutionContext;

    await worker.scheduled(controller, mockEnv, ctx);

    // Check that links were saved to R2
    // Should have individual policies under /policies/ + combined legacy file
    const keys = Array.from(storage.keys());
    expect(keys.length).toBeGreaterThan(1);

    // Find combined legacy file
    const legacyKey = keys.find(k => k.match(/^policy\/392\/\d{4}_\d{2}_\d{2}_links\.json$/));
    expect(legacyKey).toBeDefined();

    // Find individual policy files
    const policyKeys = keys.filter(k => k.startsWith('policies/'));
    expect(policyKeys.length).toBeGreaterThan(0);

    // Verify combined legacy content
    const saved = storage.get(legacyKey!);
    expect(saved).toBeDefined();

    const parsed = JSON.parse(saved!.content);
    expect(parsed.pageKey).toBe('392');
    expect(parsed.count).toBeGreaterThan(0);
    expect(parsed.links).toBeDefined();
    expect(Array.isArray(parsed.links)).toBe(true);

    // Verify link structure
    const firstLink = parsed.links[0];
    expect(firstLink.fileNo).toBeDefined();
    expect(firstLink.previewUrl).toMatch(/^https:\/\/www\.knue\.ac\.kr/);
    expect(firstLink.downloadUrl).toMatch(/^https:\/\/www\.knue\.ac\.kr/);

    // Verify individual policy structure (keyed by fileNo)
    const firstPolicyKey = policyKeys[0];
    expect(firstPolicyKey).toMatch(/^policies\/\d+\/policy\.md$/);
    const policyContent = storage.get(firstPolicyKey);
    expect(policyContent).toBeDefined();
    const policyMarkdown = policyContent!.content;
    expect(policyMarkdown).toMatch(/^---/); // Should have YAML front matter
    expect(policyMarkdown).toContain('title:');
    expect(policyMarkdown).toContain('fileNo:');
    expect(policyMarkdown).toContain('## 기본 정보');
    expect(policyMarkdown).toContain('## 링크');
  });

  it('should skip saving combined file on subsequent runs on the same day', async () => {
    const controller = {} as ScheduledController;
    const ctx = {} as ExecutionContext;

    // First run
    await worker.scheduled(controller, mockEnv, ctx);
    const firstRunSize = storage.size;
    expect(firstRunSize).toBeGreaterThan(1);

    // Second run (same day) - individual policies are rewritten, but combined file is skipped
    await worker.scheduled(controller, mockEnv, ctx);
    const secondRunSize = storage.size;
    expect(secondRunSize).toBe(firstRunSize); // Same total size (individual overwritten, combined skipped)
  });

  it('should handle fetch errors gracefully', async () => {
    // Mock fetch to fail
    global.fetch = async () => {
      throw new Error('Network error');
    };

    const controller = {} as ScheduledController;
    const ctx = {} as ExecutionContext;

    await expect(worker.scheduled(controller, mockEnv, ctx)).rejects.toThrow();

    // Should not save anything
    expect(storage.size).toBe(0);
  });

  it('should enrich links with titles', async () => {
    const controller = {} as ScheduledController;
    const ctx = {} as ExecutionContext;

    await worker.scheduled(controller, mockEnv, ctx);

    // Check individual policy files have titles
    const keys = Array.from(storage.keys());
    const policyKeys = keys.filter(k => k.startsWith('policies/'));

    let policiesWithTitles = 0;
    for (const key of policyKeys) {
      const content = storage.get(key);
      if (content) {
        const markdown = content.content;
        // Check if markdown contains title in YAML front matter (not Unknown)
        if (markdown.includes('title:') && !markdown.includes('title: "Unknown"')) {
          policiesWithTitles++;
        }
      }
    }

    expect(policiesWithTitles).toBeGreaterThan(0);

    // Also check combined file has links with titles
    const legacyKey = keys.find(k => k.match(/^policy\/392\/\d{4}_\d{2}_\d{2}_links\.json$/));
    if (legacyKey) {
      const saved = storage.get(legacyKey);
      const parsed = JSON.parse(saved!.content);
      const withTitles = parsed.links.filter((link: { title?: string }) => link.title);
      expect(withTitles.length).toBeGreaterThan(0);
    }
  });
});
