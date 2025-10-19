import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchPreviewContent } from '../src/preview/fetcher';
import { formatPolicyAsMarkdown } from '../src/preview/formatter';
import type { PolicyMarkdownData } from '../src/preview/formatter';

describe('Preview Module', () => {
  describe('fetchPreviewContent', () => {
    const baseUrl = 'https://example.com/api/';
    const fileNo = '100';
    const bearerToken = 'test-token-123';

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should fetch preview content successfully', async () => {
      const mockResponse = {
        title: '정책 제목',
        content: '정책 내용',
        summary: '요약'
      };

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      });

      const result = await fetchPreviewContent(baseUrl, fileNo, bearerToken);

      expect(result).toEqual(mockResponse);
      expect(global.fetch).toHaveBeenCalledOnce();

      const callArgs = (global.fetch as any).mock.calls[0];
      expect(callArgs[0]).toContain('atchmnflNo=100');
      expect(callArgs[1].headers.Authorization).toBe('Bearer test-token-123');
    });

    it('should handle API errors gracefully', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found'
      });

      const result = await fetchPreviewContent(baseUrl, fileNo, bearerToken, {
        retries: 0
      });

      expect(result).toBeNull();
    });

    it('should include fileNo in query parameters', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({})
      });

      await fetchPreviewContent(baseUrl, '999', bearerToken);

      const callUrl = (global.fetch as any).mock.calls[0][0] as string;
      expect(callUrl).toContain('atchmnflNo=999');
    });

    it('should retry on network error', async () => {
      global.fetch = vi
        .fn()
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ content: 'success' })
        });

      const result = await fetchPreviewContent(baseUrl, fileNo, bearerToken, {
        retries: 1,
        timeoutMs: 1000
      });

      expect(result).toEqual({ content: 'success' });
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('formatPolicyAsMarkdown', () => {
    const baseData: PolicyMarkdownData = {
      title: '기본 정책',
      fileNo: '100',
      previewUrl: 'https://example.com/preview',
      downloadUrl: 'https://example.com/download',
      savedAt: '2025-10-19T10:00:00.000Z',
      lastUpdated: '2025-10-19T10:00:00.000Z'
    };

    it('should format basic metadata as markdown', () => {
      const markdown = formatPolicyAsMarkdown(baseData);

      expect(markdown).toContain('# 기본 정책');
      expect(markdown).toContain('fileNo: 100');
      expect(markdown).toContain('## 기본 정보');
      expect(markdown).toContain('- **파일번호**: 100');
      expect(markdown).toContain('## 링크');
      expect(markdown).toContain('[미리보기](https://example.com/preview)');
      expect(markdown).toContain('[다운로드](https://example.com/download)');
    });

    it('should include front matter', () => {
      const markdown = formatPolicyAsMarkdown(baseData);

      expect(markdown).toMatch(/^---\n/);
      expect(markdown).toContain('title: "기본 정책"');
      expect(markdown).toContain('fileNo: 100');
    });

    it('should include preview content if provided', () => {
      const dataWithContent: PolicyMarkdownData = {
        ...baseData,
        previewContent: {
          summary: '정책 요약',
          content: '정책 상세 내용입니다.'
        }
      };

      const markdown = formatPolicyAsMarkdown(dataWithContent);

      expect(markdown).toContain('## 정책 내용');
      expect(markdown).toContain('### 요약');
      expect(markdown).toContain('정책 요약');
      expect(markdown).toContain('### 전문');
      expect(markdown).toContain('정책 상세 내용입니다.');
    });

    it('should handle additional fields in preview content', () => {
      const dataWithExtra: PolicyMarkdownData = {
        ...baseData,
        previewContent: {
          content: '내용',
          author: 'John Doe',
          date: '2025-10-19'
        }
      };

      const markdown = formatPolicyAsMarkdown(dataWithExtra);

      expect(markdown).toContain('### 추가 정보');
      expect(markdown).toContain('**author**: John Doe');
      expect(markdown).toContain('**date**: 2025-10-19');
    });

    it('should escape quotes in YAML front matter', () => {
      const dataWithQuotes: PolicyMarkdownData = {
        ...baseData,
        title: '정책 "제목" 테스트'
      };

      const markdown = formatPolicyAsMarkdown(dataWithQuotes);

      expect(markdown).toContain('title: "정책 \\"제목\\" 테스트"');
    });

    it('should produce valid markdown structure', () => {
      const markdown = formatPolicyAsMarkdown(baseData);
      const lines = markdown.split('\n');

      // Check front matter
      expect(lines[0]).toBe('---');
      expect(lines[lines.length - 3]).toBe('---');

      // Check basic sections exist
      expect(markdown).toContain('# 기본 정책');
      expect(markdown).toContain('## 기본 정보');
      expect(markdown).toContain('## 링크');
    });
  });
});
