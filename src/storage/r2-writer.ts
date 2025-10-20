import type { ApiPolicy, PolicyEntry } from '../kv/types';

export interface WriteResultV2 {
  saved: boolean;
  skipped: boolean;
  path?: string;
  savedPolicies?: { policyName: string; path: string }[];
  errors?: Array<{ policyName: string; error: string }>;
}

export interface DeleteResultV2 {
  deleted: { policyName: string; path: string }[];
  errors: Array<{ policyName: string; error: string }>;
}

/**
 * Policy markdown data with YAML front matter (v2.0.0)
 */
export interface PolicyMarkdownDataV2 {
  policyName: string;       // Primary key
  title: string;            // Display title
  sha: string;              // Git blob SHA
  path: string;             // GitHub repository path
  content: string;          // Full markdown content (from GitHub)
  savedAt: string;          // ISO 8601 format
  lastUpdated: string;      // ISO 8601 format
}

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
    savedPolicies: savedPolicies.length > 0 ? savedPolicies : undefined,
    errors: errors.length > 0 ? errors : undefined
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
        lastUpdated: entry.lastUpdated
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
    savedPolicies: savedPolicies.length > 0 ? savedPolicies : undefined,
    errors: errors.length > 0 ? errors : undefined
  };
}

/**
 * Delete policy markdown files from R2 (v2.0.0)
 *
 * @param bucket - R2 bucket reference
 * @param policyNames - Array of policyName identifiers to delete
 * @returns DeleteResultV2 with deleted policy details and errors, if any
 */
export async function deletePoliciesFromR2(
  bucket: R2Bucket,
  policyNames: string[]
): Promise<DeleteResultV2> {
  const deleted: { policyName: string; path: string }[] = [];
  const errors: Array<{ policyName: string; error: string }> = [];

  for (const policyName of policyNames) {
    const path = `policies/${policyName}/policy.md`;
    try {
      await bucket.delete(path);
      deleted.push({ policyName, path });
      console.log(`✓ [R2 v2] Deleted policy: ${path}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push({ policyName, error: message });
      console.error(`✗ [R2 v2] Failed to delete policy "${policyName}":`, error);
    }
  }

  if (errors.length > 0) {
    console.warn(`[R2 v2] Delete completed with ${errors.length} errors:`, errors);
  } else if (policyNames.length > 0) {
    console.log(`✓ [R2 v2] Deleted ${deleted.length}/${policyNames.length} policies from R2`);
  }

  return { deleted, errors };
}

/**
 * Escape YAML string values
 */
function escapeYaml(value: string): string {
  if (!value) return '""';
  // Escape quotes and backslashes
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
