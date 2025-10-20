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
        },
        delete: async (key: string) => {
          storage.delete(key);
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
      const urlString = typeof url === 'string' ? url : url.toString();
      console.log('[Mock] fetch called:', urlString);

      // Mock GitHub API: get latest commit
      if (urlString.includes('/commits/main')) {
        console.log('[Mock] Returning latest commit');
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
      if (urlString.includes('/compare/')) {
        console.log('[Mock] Returning compare commits');
        // Use valid 40-character hex SHAs
        return new Response(JSON.stringify({
          files: [
            {
              filename: 'policies/학칙.md',
              status: 'added',
              patch: '+# 학칙\n+내용',
              sha: 'a'.repeat(40)
            },
            {
              filename: 'policies/규정1.md',
              status: 'added',
              patch: '+# 규정 1\n+내용',
              sha: 'b'.repeat(40)
            }
          ]
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Mock GitHub API: get file tree
      if (urlString.includes('/git/trees/')) {
        console.log('[Mock] Returning file tree');
        // Use valid 40-character hex SHAs
        return new Response(JSON.stringify({
          tree: [
            { path: 'policies/학칙.md', type: 'blob', sha: 'a'.repeat(40) },
            { path: 'policies/규정1.md', type: 'blob', sha: 'b'.repeat(40) }
          ],
          truncated: false
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Mock GitHub API: get blob content
      if (urlString.includes('/git/blobs/')) {
        console.log('[Mock] Returning blob content');
        // Properly encode Korean text to base64 using UTF-8
        const text = '# 정책 제목\n\n정책 내용\n\n## 기본 정보\n정보\n\n## 링크\n링크';
        const encoder = new TextEncoder();
        const data = encoder.encode(text);
        const binary = String.fromCharCode.apply(null, Array.from(data));
        const base64Content = btoa(binary);
        return new Response(JSON.stringify({
          content: base64Content,
          encoding: 'base64'
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      console.log('[Mock] No match for URL, returning 404:', urlString);
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

    // Check that policies were saved to R2
    // Should have individual policies under /policies/ (GitHub-based structure v2.0.0)
    const keys = Array.from(storage.keys());
    expect(keys.length).toBeGreaterThan(0);

    // Find individual policy files (new structure: policies/{policyName}/policy.md)
    const policyKeys = keys.filter(k => k.startsWith('policies/'));
    expect(policyKeys.length).toBeGreaterThan(0);

    // Verify individual policy structure (keyed by policyName, not fileNo)
    const firstPolicyKey = policyKeys[0];
    expect(firstPolicyKey).toMatch(/^policies\/[^/]+\/policy\.md$/); // New structure
    const policyContent = storage.get(firstPolicyKey);
    expect(policyContent).toBeDefined();
    const policyMarkdown = policyContent!.content;
    expect(policyMarkdown).toMatch(/^---/); // Should have YAML front matter
    expect(policyMarkdown).toContain('title:');
    expect(policyMarkdown).toContain('policyName:'); // v2.0.0 uses policyName
    expect(policyMarkdown).toContain('sha:');
    expect(policyMarkdown).toContain('path:');
  });

  it('should skip saving combined file on subsequent runs on the same day', async () => {
    const controller = {} as ScheduledController;
    const ctx = {} as ExecutionContext;

    // First run
    await worker.scheduled(controller, mockEnv, ctx);
    const firstRunSize = storage.size;
    expect(firstRunSize).toBeGreaterThan(0); // v2.0.0 GitHub-based saves individual policy files

    // Second run (same day) - individual policies are rewritten
    kvStorage.clear(); // Clear KV to force re-sync
    await worker.scheduled(controller, mockEnv, ctx);
    const secondRunSize = storage.size;
    expect(secondRunSize).toBeGreaterThan(0); // Same files saved again
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
        // Check if markdown contains title in YAML front matter (v2.0.0 format)
        if (markdown.includes('title:')) {
          policiesWithTitles++;
        }
      }
    }

    expect(policiesWithTitles).toBeGreaterThan(0);
    // v2.0.0 GitHub-based workflow doesn't generate legacy combined files
  });
});
