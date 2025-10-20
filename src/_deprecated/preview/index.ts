/**
 * DEPRECATED: Preview Fetcher & Formatter Module
 *
 * This module is deprecated and will be removed on 2026-01-20 (90 days from 2025-10-20).
 * The old preview API-based content fetching has been replaced with GitHub-based markdown content.
 *
 * Migration Guide:
 * - Use GitHub API client (src/github/client.ts) to fetch content directly
 * - Use GitHub markdown parser (src/github/markdown.ts) to parse content
 * - Use R2 writer v2.0.0 (src/storage/r2-writer.ts) with formatPolicyAsMarkdownV2()
 *
 * @deprecated Use GitHub integration module (src/github/) instead
 * @removal-date 2026-01-20
 */

console.warn(
  '[DEPRECATION WARNING] src/preview module is deprecated and will be removed on 2026-01-20. ' +
  'Please use GitHub-based content fetching and v2.0.0 R2 writer instead.'
);

export * from './fetcher';
export * from './formatter';
