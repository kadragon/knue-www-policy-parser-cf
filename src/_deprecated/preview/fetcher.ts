/**
 * DEPRECATED: Preview Content Fetcher
 *
 * This module is deprecated and will be removed on 2026-01-20.
 * Preview API-based content fetching has been replaced with GitHub-based content.
 *
 * Fetch policy content from PREVIEW_PARSER_BASE_URL
 * Uses atchmnflNo parameter with fileNo
 *
 * @deprecated Use GitHub API client (src/github/client.ts) instead
 * @removal-date 2026-01-20
 */

export interface PreviewContent {
  title?: string;
  content?: string;
  summary?: string;
  [key: string]: unknown;
}

export interface FetchPreviewOptions {
  timeoutMs?: number;
  retries?: number;
}

/**
 * Fetch policy preview content from the preview parser API
 * @param baseUrl PREVIEW_PARSER_BASE_URL
 * @param fileNo Policy file number
 * @param bearerToken Authorization bearer token
 * @param options Fetch options
 * @returns Preview content
 */
export async function fetchPreviewContent(
  baseUrl: string,
  fileNo: string | number,
  bearerToken: string,
  options: FetchPreviewOptions = {}
): Promise<PreviewContent | null> {
  const { timeoutMs = 10000, retries = 2 } = options;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const url = new URL(baseUrl);
      url.searchParams.set('atchmnflNo', String(fileNo));

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(url.toString(), {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${bearerToken}`,
            'Content-Type': 'application/json'
          },
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(
            `Preview API returned ${response.status}: ${response.statusText}`
          );
        }

        const data = await response.json() as PreviewContent;
        console.log(`✓ [Preview] Fetched content for fileNo: ${fileNo}`);
        return data;
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < retries) {
        const delay = Math.pow(2, attempt) * 1000; // exponential backoff
        console.warn(
          `⚠ [Preview] Attempt ${attempt + 1} failed for fileNo: ${fileNo}, retrying in ${delay}ms...`,
          lastError.message
        );
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        console.error(
          `✗ [Preview] All ${retries + 1} attempts failed for fileNo: ${fileNo}`,
          lastError.message
        );
      }
    }
  }

  return null;
}
