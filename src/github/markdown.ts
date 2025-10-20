/**
 * Markdown Parser
 *
 * Extracts policy metadata from markdown files fetched from GitHub.
 */

import type { PolicyDocument } from './types';

/**
 * Extract policy name from file path
 * Examples:
 *   "학칙.md" → "학칙"
 *   "policies/내규.md" → "내규"
 *   "docs/rules/운영규정.md" → "운영규정"
 */
export function extractPolicyName(filePath: string): string {
  // Get the filename from the path
  const parts = filePath.split('/');
  const filename = parts[parts.length - 1];

  // Remove .md extension
  return filename.replace(/\.md$/i, '');
}

/**
 * Extract title from markdown content (first # heading)
 * Falls back to empty string if no heading found
 */
export function extractTitle(markdown: string): string {
  // Match first # heading (H1)
  const match = markdown.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : '';
}

/**
 * Parse markdown file into PolicyDocument
 *
 * @param content - Full markdown content
 * @param path - Relative path in repository
 * @param sha - Git blob SHA
 * @returns PolicyDocument with extracted metadata
 */
export function parseMarkdown(
  content: string,
  path: string,
  sha: string
): PolicyDocument {
  const policyName = extractPolicyName(path);
  let title = extractTitle(content);

  // Fallback: use policyName if no title found
  if (!title) {
    console.warn(
      `[Markdown] No # heading found in ${path}, using filename as title: "${policyName}"`
    );
    title = policyName;
  }

  return {
    policyName,
    title,
    content,
    sha,
    path,
    lastModified: new Date().toISOString()
  };
}

/**
 * Validate if a file should be processed as a policy
 *
 * Filters:
 * - Must be .md file
 * - Must not be README.md
 */
export function shouldProcessFile(filePath: string): boolean {
  // Must be markdown file
  if (!filePath.toLowerCase().endsWith('.md')) {
    return false;
  }

  // Exclude README files
  const filename = filePath.split('/').pop() || '';
  if (filename.toLowerCase() === 'readme.md') {
    return false;
  }

  return true;
}

/**
 * Parse multiple markdown files
 */
export async function parseMarkdownFiles(
  files: Array<{ path: string; content: string; sha: string }>
): Promise<PolicyDocument[]> {
  const policies: PolicyDocument[] = [];

  for (const file of files) {
    if (!shouldProcessFile(file.path)) {
      console.log(`[Markdown] Skipping: ${file.path}`);
      continue;
    }

    try {
      const policy = parseMarkdown(file.content, file.path, file.sha);
      policies.push(policy);
      console.log(`[Markdown] Parsed: ${policy.policyName} (${file.path})`);
    } catch (error) {
      console.error(
        `[Markdown] Failed to parse ${file.path}:`,
        error instanceof Error ? error.message : String(error)
      );
      // Continue with other files
    }
  }

  return policies;
}
