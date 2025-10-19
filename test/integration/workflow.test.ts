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
    POLICY_PAGE_URL: string;
    POLICY_PAGE_KEY: string;
  };
  let storage: Map<string, { content: string; metadata: R2HTTPMetadata }>;

  beforeEach(() => {
    storage = new Map();

    mockEnv = {
      POLICY_PAGE_URL: 'https://www.knue.ac.kr/www/contents.do?key=392',
      POLICY_PAGE_KEY: '392',
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
      } as unknown as R2Bucket
    };

    // Mock global fetch for policy page
    global.fetch = (async (url: RequestInfo | URL) => {
      const urlString = url.toString();
      if (urlString.includes('contents.do?key=392')) {
        return new Response(fixtureHTML, {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
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
    const keys = Array.from(storage.keys());
    expect(keys.length).toBe(1);
    expect(keys[0]).toMatch(/^policy\/392\/\d{4}_\d{2}_\d{2}_links\.json$/);

    // Verify saved content
    const saved = storage.get(keys[0]);
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
  });

  it('should skip saving on subsequent runs on the same day', async () => {
    const controller = {} as ScheduledController;
    const ctx = {} as ExecutionContext;

    // First run
    await worker.scheduled(controller, mockEnv, ctx);
    expect(storage.size).toBe(1);

    // Second run (same day)
    await worker.scheduled(controller, mockEnv, ctx);
    expect(storage.size).toBe(1); // Should not create duplicate
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

    const keys = Array.from(storage.keys());
    const saved = storage.get(keys[0]);
    const parsed = JSON.parse(saved!.content);

    // At least some links should have titles
    const withTitles = parsed.links.filter((link: { title?: string }) => link.title);
    expect(withTitles.length).toBeGreaterThan(0);
  });
});
