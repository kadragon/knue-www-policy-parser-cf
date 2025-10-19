import type { PolicyLink } from '../page/parser';
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
