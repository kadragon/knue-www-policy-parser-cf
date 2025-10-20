import type { PolicyLink } from '../page/parser';
import type { ApiPolicy, PolicyEntry } from '../kv/types';
import { fetchPreviewContent } from '../preview/fetcher';
import { formatPolicyAsMarkdown, type PolicyMarkdownData } from '../preview/formatter';

export interface WriteResult {
  saved: boolean;
  skipped: boolean;
  path?: string;
  savedPolicies?: number;
}

export interface WritePoliciesOptions {
  previewParserBaseUrl?: string;
  bearerToken?: string;
  fetchContent?: boolean;
}

/**
 * v2.0.0: Support for direct markdown content (from GitHub)
 */
export interface PolicyMarkdownDataV2 {
  policyName: string;       // Primary key
  title: string;            // Display title
  sha: string;              // Git blob SHA
  path: string;             // GitHub repository path
  content: string;          // Full markdown content (from GitHub)
  savedAt: string;          // ISO 8601 format
  lastUpdated: string;      // ISO 8601 format
  // v1.x: Optional backward compatibility
  fileNo?: string;
  previewUrl?: string;
  downloadUrl?: string;
}

/**
 * v2.0.0: Result type for policyName-centric write operations
 * Note: Different from WriteResult due to different savedPolicies format
 */
export interface WriteResultV2 {
  saved: boolean;
  skipped: boolean;
  path?: string;
  savedPolicies?: { policyName: string; path: string }[];
}

/**
 * Write individual policies to R2 under /policies/{fileNo}/
 *
 * Uses fileNo as the path identifier (short, stable, unique).
 * Saves as Markdown format with basic metadata and fetched preview content.
 * This avoids issues with encoding long Korean titles in paths.
 *
 * Structure:
 *   policies/868/policy.md
 *   policies/869/policy.md
 *   etc.
 */
export async function writePoliciestoR2ByTitle(
  bucket: R2Bucket,
  links: PolicyLink[],
  timestamp: Date,
  options: WritePoliciesOptions = {}
): Promise<WriteResult> {
  const { previewParserBaseUrl, bearerToken, fetchContent = true } = options;
  const savedPolicies: string[] = [];
  const errors: Array<{ title: string; error: string }> = [];

  for (const link of links) {
    try {
      const title = link.title || 'Unknown';
      const path = `policies/${link.fileNo}/policy.md`;

      // Prepare markdown data with basic metadata
      const markdownData: PolicyMarkdownData = {
        title,
        fileNo: link.fileNo,
        previewUrl: link.previewUrl,
        downloadUrl: link.downloadUrl,
        savedAt: timestamp.toISOString(),
        lastUpdated: timestamp.toISOString()
      };

      // Fetch preview content if requested and credentials are available
      if (
        fetchContent &&
        previewParserBaseUrl &&
        bearerToken
      ) {
        try {
          const previewContent = await fetchPreviewContent(
            previewParserBaseUrl,
            link.fileNo,
            bearerToken,
            { timeoutMs: 8000, retries: 1 }
          );

          if (previewContent) {
            markdownData.previewContent = previewContent;
          }
        } catch (error) {
          console.warn(
            `⚠ [R2] Failed to fetch preview content for fileNo ${link.fileNo}:`,
            error instanceof Error ? error.message : String(error)
          );
          // Continue without preview content
        }
      }

      // Format as Markdown
      const content = formatPolicyAsMarkdown(markdownData);

      // Save to R2
      await bucket.put(path, content, {
        httpMetadata: {
          contentType: 'text/markdown; charset=utf-8'
        }
      });

      savedPolicies.push(title);
      console.log(`✓ [R2] Saved policy: ${path} (title: "${title}")`);
    } catch (error) {
      const title = link.title || 'Unknown';
      errors.push({
        title,
        error: error instanceof Error ? error.message : String(error)
      });
      console.error(`✗ [R2] Failed to save policy "${title}":`, error);
    }
  }

  if (errors.length > 0) {
    console.warn(`[R2] Completed with ${errors.length} errors:`, errors);
  }

  console.log(`✓ [R2] Saved ${savedPolicies.length}/${links.length} policies under /policies/{fileNo}/`);

  return {
    saved: savedPolicies.length > 0,
    skipped: savedPolicies.length === 0,
    savedPolicies: savedPolicies.length
  };
}

/**
 * Legacy: Write combined links file (kept for backward compatibility)
 */
export async function writeLinksToR2(
  bucket: R2Bucket,
  links: PolicyLink[],
  pageKey: string,
  timestamp: Date
): Promise<WriteResult> {
  const year = timestamp.getFullYear();
  const month = String(timestamp.getMonth() + 1).padStart(2, '0');
  const day = String(timestamp.getDate()).padStart(2, '0');

  const path = `policy/${pageKey}/${year}_${month}_${day}_links.json`;

  // Check if file already exists
  const existing = await bucket.head(path);

  if (existing) {
    console.log(`⏭ [R2] File already exists: ${path}`);
    return { saved: false, skipped: true };
  }

  const content = JSON.stringify(
    {
      timestamp: timestamp.toISOString(),
      pageKey,
      count: links.length,
      links
    },
    null,
    2
  );

  await bucket.put(path, content, {
    httpMetadata: {
      contentType: 'application/json'
    }
  });

  console.log(`✓ [R2] Saved ${links.length} links to ${path}`);

  return {
    saved: true,
    skipped: false,
    path
  };
}

/**
 * ============================================================================
 * v2.0.0 Functions: GitHub-based policies with policyName-centric structure
 * ============================================================================
 */

/**
 * Format policy markdown with YAML front matter (v2.0.0)
 *
 * Structure:
 * ---
 * policyName: "학칙"
 * title: "한국교원대학교 학칙"
 * sha: "abc123..."
 * path: "policies/학칙.md"
 * savedAt: "2025-10-20T12:00:00Z"
 * lastUpdated: "2025-10-20T12:00:00Z"
 * ---
 *
 * [GitHub markdown content here]
 */
export function formatPolicyAsMarkdownV2(data: PolicyMarkdownDataV2): string {
  const lines: string[] = [];

  // YAML Front Matter
  lines.push('---');
  lines.push(`policyName: "${escapeYaml(data.policyName)}"`);
  lines.push(`title: "${escapeYaml(data.title)}"`);
  lines.push(`sha: "${data.sha}"`);
  lines.push(`path: "${escapeYaml(data.path)}"`);
  lines.push(`savedAt: "${data.savedAt}"`);
  lines.push(`lastUpdated: "${data.lastUpdated}"`);

  // Optional backward compatibility
  if (data.fileNo !== undefined) {
    lines.push(`fileNo: "${data.fileNo}"`);
  }
  if (data.previewUrl !== undefined) {
    lines.push(`previewUrl: "${escapeYaml(data.previewUrl)}"`);
  }
  if (data.downloadUrl !== undefined) {
    lines.push(`downloadUrl: "${escapeYaml(data.downloadUrl)}"`);
  }

  lines.push('---');
  lines.push('');

  // GitHub markdown content (as-is, preserves original formatting)
  lines.push(data.content);

  return lines.join('\n');
}

/**
 * Write policies from ApiPolicy array to R2 (v2.0.0)
 *
 * Uses policyName as path identifier and includes full GitHub markdown content.
 * Path structure: policies/{policyName}/policy.md
 *
 * @param bucket - R2 bucket reference
 * @param policies - Array of ApiPolicy objects from GitHub
 * @param timestamp - Sync timestamp
 * @returns WriteResultV2 with saved policy details
 */
export async function writePoliciestoR2ByPolicyNameV2(
  bucket: R2Bucket,
  policies: ApiPolicy[],
  timestamp: Date
): Promise<WriteResultV2> {
  const savedPolicies: { policyName: string; path: string }[] = [];
  const errors: Array<{ policyName: string; error: string }> = [];

  for (const policy of policies) {
    try {
      const policyName = policy.policyName;
      const path = `policies/${policyName}/policy.md`;

      // Prepare markdown data with GitHub content
      const markdownData: PolicyMarkdownDataV2 = {
        policyName,
        title: policy.title,
        sha: policy.sha,
        path: policy.path,
        content: policy.content,
        savedAt: timestamp.toISOString(),
        lastUpdated: timestamp.toISOString()
      };

      // Format as Markdown with front matter
      const content = formatPolicyAsMarkdownV2(markdownData);

      // Save to R2
      await bucket.put(path, content, {
        httpMetadata: {
          contentType: 'text/markdown; charset=utf-8'
        }
      });

      savedPolicies.push({ policyName, path });
      console.log(`✓ [R2 v2] Saved policy: ${path} (policyName: "${policyName}", sha: ${policy.sha.substring(0, 7)})`);
    } catch (error) {
      const policyName = policy.policyName || 'Unknown';
      errors.push({
        policyName,
        error: error instanceof Error ? error.message : String(error)
      });
      console.error(`✗ [R2 v2] Failed to save policy "${policyName}":`, error);
    }
  }

  if (errors.length > 0) {
    console.warn(`[R2 v2] Completed with ${errors.length} errors:`, errors);
  }

  console.log(`✓ [R2 v2] Saved ${savedPolicies.length}/${policies.length} policies under /policies/{policyName}/`);

  return {
    saved: savedPolicies.length > 0,
    skipped: savedPolicies.length === 0,
    savedPolicies: savedPolicies.length > 0 ? savedPolicies : undefined
  };
}

/**
 * Write PolicyEntry objects to R2 (v2.0.0)
 *
 * For use when policies are already in KV registry and you have the PolicyEntry objects.
 * Requires the full markdown content to be passed separately (from GitHub or cache).
 *
 * @param bucket - R2 bucket reference
 * @param entries - Array of PolicyEntry objects with markdown content
 * @param timestamp - Sync timestamp
 * @returns WriteResultV2 with saved policy details
 */
export async function writePolicyEntriesToR2V2(
  bucket: R2Bucket,
  entries: Array<PolicyEntry & { content: string }>,
  timestamp: Date
): Promise<WriteResultV2> {
  const savedPolicies: { policyName: string; path: string }[] = [];
  const errors: Array<{ policyName: string; error: string }> = [];

  for (const entry of entries) {
    try {
      const policyName = entry.policyName;
      const path = `policies/${policyName}/policy.md`;

      // Prepare markdown data
      const markdownData: PolicyMarkdownDataV2 = {
        policyName,
        title: entry.title,
        sha: entry.sha,
        path: entry.path,
        content: entry.content,
        savedAt: timestamp.toISOString(),
        lastUpdated: entry.lastUpdated,
        // Optional backward compatibility
        fileNo: entry.fileNo,
        previewUrl: entry.previewUrl,
        downloadUrl: entry.downloadUrl
      };

      // Format as Markdown with front matter
      const content = formatPolicyAsMarkdownV2(markdownData);

      // Save to R2
      await bucket.put(path, content, {
        httpMetadata: {
          contentType: 'text/markdown; charset=utf-8'
        }
      });

      savedPolicies.push({ policyName, path });
      console.log(`✓ [R2 v2] Saved entry: ${path} (policyName: "${policyName}", sha: ${entry.sha.substring(0, 7)})`);
    } catch (error) {
      const policyName = entry.policyName || 'Unknown';
      errors.push({
        policyName,
        error: error instanceof Error ? error.message : String(error)
      });
      console.error(`✗ [R2 v2] Failed to save entry "${policyName}":`, error);
    }
  }

  if (errors.length > 0) {
    console.warn(`[R2 v2] Completed with ${errors.length} errors:`, errors);
  }

  console.log(`✓ [R2 v2] Saved ${savedPolicies.length}/${entries.length} entries under /policies/{policyName}/`);

  return {
    saved: savedPolicies.length > 0,
    skipped: savedPolicies.length === 0,
    savedPolicies: savedPolicies.length > 0 ? savedPolicies : undefined
  };
}

/**
 * Escape YAML string values (shared helper)
 */
function escapeYaml(value: string): string {
  if (!value) return '""';
  // Escape quotes and backslashes
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
