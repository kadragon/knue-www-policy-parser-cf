/**
 * DEPRECATED: Page Fetcher & Parser Module
 *
 * This module is deprecated and will be removed on 2026-01-20 (90 days from 2025-10-20).
 * The old HTML-based policy collection approach has been replaced with GitHub-based sync.
 *
 * Migration Guide:
 * - Use GitHub API client (src/github/client.ts) instead of fetchPageContent
 * - Use GitHub markdown parser (src/github/markdown.ts) instead of parsePoliciesFromHTML
 * - Use ChangeTracker (src/github/tracker.ts) for change detection
 *
 * @deprecated Use GitHub integration module (src/github/) instead
 * @removal-date 2026-01-20
 */

console.warn(
  '[DEPRECATION WARNING] src/page module is deprecated and will be removed on 2026-01-20. ' +
  'Please migrate to src/github/ module for policy collection.'
);

export * from './fetcher';
export * from './parser';
