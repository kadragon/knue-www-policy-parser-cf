/**
 * DEPRECATED: Page Fetcher
 *
 * This module is deprecated and will be removed on 2026-01-20.
 * The HTML-based policy collection has been replaced with GitHub-based sync.
 *
 * @deprecated Use GitHub API client (src/github/client.ts) instead
 * @removal-date 2026-01-20
 */

interface FetchOptions {
  timeoutMs?: number;
  maxRetries?: number;
  backoffMultiplier?: number;
}

export async function fetchPolicyPage(
  url: string,
  options: FetchOptions = {}
): Promise<string> {
  const {
    timeoutMs = 5000,
    maxRetries = 3,
    backoffMultiplier = 2
  } = options;

  let lastError: Error | null = null;
  let delay = 1000;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(url, {
          signal: controller.signal,
          headers: {
            'User-Agent': 'KNUE-Policy-Parser/1.0'
          }
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const html = await response.text();

        if (attempt > 1) {
          console.log(`✓ Page fetch succeeded on attempt ${attempt}/${maxRetries}`);
        }

        return html;
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      const isRetryable =
        error instanceof Error &&
        (error.name === 'AbortError' ||
          error.message.includes('503') ||
          error.message.includes('429') ||
          error.message.includes('ECONNRESET'));

      if (attempt < maxRetries && isRetryable) {
        console.log(
          `⚠ Page fetch attempt ${attempt} failed: ${lastError.message}. Retrying in ${delay}ms...`
        );
        await new Promise(resolve => setTimeout(resolve, delay));
        delay = Math.min(delay * backoffMultiplier, 10000);
      } else if (!isRetryable) {
        throw lastError;
      }
    }
  }

  throw lastError || new Error('Page fetch failed after all retries');
}
