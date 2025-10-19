import { describe, it, expect, beforeEach } from 'vitest';
import { writeLinksToR2 } from '../src/storage/r2-writer';
import type { PolicyLink } from '../src/page/parser';

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
