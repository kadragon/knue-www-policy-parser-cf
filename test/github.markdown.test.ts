import { describe, it, expect } from 'vitest';
import {
  extractPolicyName,
  extractTitle,
  parseMarkdown,
  shouldProcessFile,
  parseMarkdownFiles
} from '../src/github/markdown';

describe('GitHub Markdown Parser', () => {
  describe('extractPolicyName', () => {
    it('should extract policy name from simple filename', () => {
      const name = extractPolicyName('학칙.md');
      expect(name).toBe('학칙');
    });

    it('should extract policy name from nested path', () => {
      const name = extractPolicyName('policies/내규.md');
      expect(name).toBe('내규');
    });

    it('should extract policy name from deep nested path', () => {
      const name = extractPolicyName('docs/rules/운영규정.md');
      expect(name).toBe('운영규정');
    });

    it('should handle case-insensitive .md extension', () => {
      const name = extractPolicyName('policies/학칙.MD');
      expect(name).toBe('학칙');
    });

    it('should handle filenames with multiple dots', () => {
      const name = extractPolicyName('policies/academic.standards.md');
      expect(name).toBe('academic.standards');
    });

    it('should handle filenames with hyphens and underscores', () => {
      const name1 = extractPolicyName('policies/academic-standards.md');
      expect(name1).toBe('academic-standards');

      const name2 = extractPolicyName('policies/academic_standards.md');
      expect(name2).toBe('academic_standards');
    });
  });

  describe('extractTitle', () => {
    it('should extract title from first # heading', () => {
      const markdown = '# 학칙\n\n## 제1장\n\nContent';
      const title = extractTitle(markdown);
      expect(title).toBe('학칙');
    });

    it('should trim whitespace from title', () => {
      const markdown = '#   한국교원대학교 학칙   \n\nContent';
      const title = extractTitle(markdown);
      expect(title).toBe('한국교원대학교 학칙');
    });

    it('should return empty string when no # heading', () => {
      const markdown = '## 제1장\n\n## 제2장\n\nContent';
      const title = extractTitle(markdown);
      expect(title).toBe('');
    });

    it('should return empty string for empty markdown', () => {
      const title = extractTitle('');
      expect(title).toBe('');
    });

    it('should handle # in middle of line (not a heading)', () => {
      const markdown = 'This is # not a heading\n# Real Heading\n\nContent';
      const title = extractTitle(markdown);
      expect(title).toBe('Real Heading');
    });

    it('should match # heading at start of line only', () => {
      const markdown = 'First line\n# Correct Heading\n## Other';
      const title = extractTitle(markdown);
      expect(title).toBe('Correct Heading');
    });
  });

  describe('shouldProcessFile', () => {
    it('should accept .md files', () => {
      expect(shouldProcessFile('policies/학칙.md')).toBe(true);
    });

    it('should accept .MD files (case insensitive)', () => {
      expect(shouldProcessFile('policies/학칙.MD')).toBe(true);
    });

    it('should reject non-markdown files', () => {
      expect(shouldProcessFile('policies/document.txt')).toBe(false);
      expect(shouldProcessFile('policies/document.pdf')).toBe(false);
      expect(shouldProcessFile('policies/document.html')).toBe(false);
    });

    it('should reject README.md', () => {
      expect(shouldProcessFile('README.md')).toBe(false);
      expect(shouldProcessFile('policies/README.md')).toBe(false);
    });

    it('should reject readme.md (case insensitive)', () => {
      expect(shouldProcessFile('readme.md')).toBe(false);
      expect(shouldProcessFile('README.MD')).toBe(false);
    });

    it('should accept readme-style files if not named README', () => {
      expect(shouldProcessFile('readme-template.md')).toBe(true);
      expect(shouldProcessFile('readme_old.md')).toBe(true);
    });
  });

  describe('parseMarkdown', () => {
    it('should parse markdown with valid heading and content', () => {
      const markdown = '# 학칙\n\n## 제1장\n\n규정 내용';
      const policy = parseMarkdown(markdown, 'policies/학칙.md', 'abc123def456');

      expect(policy.policyName).toBe('학칙');
      expect(policy.title).toBe('학칙');
      expect(policy.content).toBe(markdown);
      expect(policy.sha).toBe('abc123def456');
      expect(policy.path).toBe('policies/학칙.md');
      expect(policy.lastModified).toBeDefined();
    });

    it('should fallback to policyName when no title found', () => {
      const markdown = '## 제1장\n\n규정 내용';
      const policy = parseMarkdown(markdown, 'policies/my-policy.md', 'sha123');

      expect(policy.policyName).toBe('my-policy');
      expect(policy.title).toBe('my-policy');
      expect(policy.content).toBe(markdown);
    });

    it('should preserve full markdown content', () => {
      const markdown = '# Title\n\n## Section 1\n\nContent 1\n\n## Section 2\n\nContent 2';
      const policy = parseMarkdown(markdown, 'policies/test.md', 'sha123');

      expect(policy.content).toBe(markdown);
    });

    it('should set lastModified to current ISO timestamp', () => {
      const before = new Date().toISOString();
      const policy = parseMarkdown('# Test', 'test.md', 'sha');
      const after = new Date().toISOString();

      expect(policy.lastModified).toBeDefined();
      expect(policy.lastModified! >= before).toBe(true);
      expect(policy.lastModified! <= after).toBe(true);
    });

    it('should handle Korean characters correctly', () => {
      const markdown = '# 한국교원대학교 학칙\n\n## 제1장 총칙';
      const policy = parseMarkdown(markdown, 'policies/학칙.md', 'sha123');

      expect(policy.title).toBe('한국교원대학교 학칙');
      expect(policy.policyName).toBe('학칙');
    });

    it('should handle empty content', () => {
      const policy = parseMarkdown('', 'empty.md', 'sha123');

      expect(policy.policyName).toBe('empty');
      expect(policy.title).toBe('empty');
      expect(policy.content).toBe('');
    });

    it('should handle nested paths correctly', () => {
      const markdown = '# Nested Policy';
      const policy = parseMarkdown(markdown, 'docs/rules/nested/policy.md', 'sha123');

      expect(policy.policyName).toBe('policy');
    });
  });

  describe('parseMarkdownFiles', () => {
    it('should parse multiple markdown files', async () => {
      const files = [
        {
          path: 'policies/학칙.md',
          content: '# 학칙\n\nContent 1',
          sha: 'sha1'
        },
        {
          path: 'policies/내규.md',
          content: '# 내규\n\nContent 2',
          sha: 'sha2'
        }
      ];

      const policies = await parseMarkdownFiles(files);

      expect(policies).toHaveLength(2);
      expect(policies[0].policyName).toBe('학칙');
      expect(policies[1].policyName).toBe('내규');
    });

    it('should skip README.md files', async () => {
      const files = [
        {
          path: 'policies/학칙.md',
          content: '# 학칙',
          sha: 'sha1'
        },
        {
          path: 'README.md',
          content: '# README',
          sha: 'sha2'
        }
      ];

      const policies = await parseMarkdownFiles(files);

      expect(policies).toHaveLength(1);
      expect(policies[0].policyName).toBe('학칙');
    });

    it('should skip non-markdown files', async () => {
      const files = [
        {
          path: 'policies/학칙.md',
          content: '# 학칙',
          sha: 'sha1'
        },
        {
          path: 'policies/document.txt',
          content: 'Not markdown',
          sha: 'sha2'
        }
      ];

      const policies = await parseMarkdownFiles(files);

      expect(policies).toHaveLength(1);
      expect(policies[0].policyName).toBe('학칙');
    });

    it('should handle valid and invalid files gracefully', async () => {
      // This tests that the function doesn't crash with valid input
      const files = [
        {
          path: 'policies/valid.md',
          content: '# Valid',
          sha: 'sha1'
        },
        {
          path: 'policies/also-valid.md',
          content: '# Also Valid',
          sha: 'sha2'
        }
      ];

      const policies = await parseMarkdownFiles(files);

      expect(policies).toHaveLength(2);
      expect(policies[0].policyName).toBe('valid');
      expect(policies[1].policyName).toBe('also-valid');
    });

    it('should handle empty file list', async () => {
      const policies = await parseMarkdownFiles([]);

      expect(policies).toHaveLength(0);
    });

    it('should preserve file order', async () => {
      const files = [
        { path: 'a.md', content: '# A', sha: 'sha1' },
        { path: 'b.md', content: '# B', sha: 'sha2' },
        { path: 'c.md', content: '# C', sha: 'sha3' }
      ];

      const policies = await parseMarkdownFiles(files);

      expect(policies[0].policyName).toBe('a');
      expect(policies[1].policyName).toBe('b');
      expect(policies[2].policyName).toBe('c');
    });
  });
});
