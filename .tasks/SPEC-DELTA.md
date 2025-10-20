# Specification Delta - GitHub Repository Migration

**Task ID**: `github-repo-migration`
**Version**: 3.0.0
**Date**: 2025-10-20
**Status**: Draft → Active (pending implementation)
**Supersedes**: `init-policy-parser` (v2.0.0)

## Summary of Changes

This specification defines the migration from preview API-based policy collection to GitHub repository-based collection. The primary key shifts from `fileNo` to `policyName`, and content fetching moves from HTTP API calls to Git blob retrieval.

---

## Modified Acceptance Criteria

### AC-1: Daily Cron Execution (UNCHANGED)
- GIVEN the worker is deployed with cron trigger `0 16 * * *`
- WHEN it is 16:00 UTC on any calendar day
- THEN the scheduled handler runs exactly once for that slot and logs the ISO timestamp of the run.

### AC-2: Guarding HTTP Requests (UNCHANGED)
- GIVEN an HTTP request hits the worker
- WHEN the request uses `fetch()` entrypoint
- THEN the worker returns HTTP 405 with a JSON body explaining that only cron triggers are allowed.

### AC-3: GitHub Repository Sync (NEW)
- GIVEN `GITHUB_REPO` and `GITHUB_BRANCH` are configured
- WHEN the scheduled handler executes
- THEN it fetches the latest commit SHA from GitHub API
- AND compares it with the last synced commit SHA stored in KV (`metadata:sync:lastCommit`)
- AND if different, fetches the commit diff to determine changed markdown files
- AND processes only added/modified/deleted files (not full tree scan)

### AC-4: Markdown File Discovery (REPLACES AC-3, AC-4)
- GIVEN a valid commit SHA
- WHEN change detection runs
- THEN it identifies all `.md` files recursively in the repository
- AND excludes `README.md` files
- AND filters files to only process changes since last sync

### AC-5: Markdown Parsing (REPLACES AC-4 title enrichment)
- GIVEN a markdown file content
- WHEN the parser processes it
- THEN it extracts `policyName` from filename (without `.md` extension)
- AND extracts `title` from the first `# heading` line
- AND falls back to `policyName` if no `# heading` found
- AND preserves full markdown content

### AC-6: Policy Content Storage (REPLACES AC-5 Preview API)
- GIVEN parsed markdown documents
- WHEN content is prepared for storage
- THEN no external API calls are made (preview API removed)
- AND content comes directly from GitHub blob API
- AND includes Git SHA for version tracking

### AC-7: KV Synchronization (MODIFIED)
- GIVEN parsed policy documents with `policyName` as primary key
- WHEN `PolicySynchronizer.synchronize` executes
- THEN new `policyName` entries are added
- AND changed markdown content updates existing entries
- AND missing `policyName` entries are deleted from KV
- AND sync metadata includes commit SHA tracking
- **CHANGED**: Primary key is now `policyName` instead of `fileNo`
- **CHANGED**: KV key format: `policy:{policyName}` (was `policy:{title}`)

### AC-8: Per-Policy Markdown Export (MODIFIED)
- GIVEN parsed markdown documents
- WHEN `writePoliciestoR2ByName` runs
- THEN each policy is written to `policies/{policyName}/policy.md`
- AND YAML front matter includes: `policyName`, `title`, `sha`, `path`, `savedAt`, `lastUpdated`
- AND markdown body is the original GitHub file content (not preview API content)
- **CHANGED**: Path uses `policyName` instead of `fileNo`
- **CHANGED**: No preview content fetching

### AC-9: Legacy Snapshot JSON (DEPRECATED, OPTIONAL)
- GIVEN the current implementation for backward compatibility
- WHEN legacy support is enabled
- THEN it may write a JSON snapshot (optional)
- **CHANGED**: This feature is deprecated and may be removed in future versions

### AC-10: Commit SHA Tracking (NEW)
- GIVEN a successful sync completes
- WHEN metadata is recorded
- THEN the latest commit SHA is saved to KV (`metadata:sync:lastCommit`)
- AND subsequent syncs use this SHA as the base for comparison

### AC-11: Observability & Logging (MODIFIED)
- GIVEN the worker runs under cron
- WHEN each phase completes
- THEN logs include:
  - GitHub repo and branch info
  - Commit SHA (current and previous)
  - Number of changed files (added/modified/deleted)
  - Markdown parsing results
  - KV sync stats (policyName-based)
  - R2 export counts
  - Total duration
- **CHANGED**: Log GitHub operations instead of HTML fetch + preview API calls

### AC-12: Failure Propagation (UNCHANGED)
- GIVEN a critical error occurs
- WHEN the error is thrown
- THEN the worker rethrows after logging
- AND the run is marked as failed

---

## Data Schema Changes

### Before (v2.0.0)
```typescript
interface PolicyLink {
  fileNo: string;        // Primary identifier
  previewUrl: string;
  downloadUrl: string;
  title?: string;
}

interface PolicyEntry {
  title: string;         // KV key: "policy:{title}"
  fileNo: string;
  status: 'active';
  lastUpdated: string;
  previewUrl: string;
  downloadUrl: string;
}
```

### After (v3.0.0)
```typescript
interface PolicyDocument {
  policyName: string;    // Primary identifier (filename without .md)
  title: string;         // Extracted from markdown # heading
  content: string;       // Full markdown content
  sha: string;           // Git blob SHA
  path: string;          // Relative path in repo
  lastModified?: string; // ISO-8601 timestamp
}

interface PolicyEntry {
  policyName: string;    // KV key: "policy:{policyName}"
  title: string;
  status: 'active';
  lastUpdated: string;
  sha: string;           // Git SHA for version tracking
  path: string;
  fileNo?: string;       // Optional, for backward compatibility
  previewUrl?: string;   // Optional, deprecated
  downloadUrl?: string;  // Optional, deprecated
}
```

### New Metadata Keys
```typescript
// Commit tracking
"metadata:sync:lastCommit" → string (commit SHA)

// Sync metadata (existing, updated fields)
interface SyncMetadata {
  timestamp: string;
  totalProcessed: number;
  added: number;
  updated: number;
  deleted: number;
  status: 'success' | 'failure';
  errorCount: number;
  commitSHA?: string;        // NEW: current commit
  previousCommitSHA?: string; // NEW: previous commit
}
```

---

## Environment Variables

### Removed
- ~~`POLICY_PAGE_URL`~~ (HTML scraping no longer needed)
- ~~`POLICY_PAGE_KEY`~~ (no longer needed)
- ~~`PREVIEW_PARSER_BASE_URL`~~ (preview API deprecated)
- ~~`BEARER_TOKEN`~~ (secret, preview API deprecated)

### Added
| Name | Type | Required | Example | Notes |
|------|------|----------|---------|-------|
| `GITHUB_REPO` | string | ✅ | `kadragon/knue-policy-hub` | Owner/repo format |
| `GITHUB_BRANCH` | string | ✅ | `main` | Branch to track |
| `GITHUB_TOKEN` | secret | ❌ | *(Workers secret)* | Optional, increases rate limit to 5000/h |

### Unchanged
- `POLICY_STORAGE` (R2 bucket binding)
- `POLICY_REGISTRY` (KV namespace binding)

---

## API Changes

### GitHub API Endpoints Used
```
GET /repos/{owner}/{repo}/commits/{branch}
  → Returns latest commit SHA

GET /repos/{owner}/{repo}/compare/{base}...{head}
  → Returns diff between two commits (files changed)

GET /repos/{owner}/{repo}/git/trees/{sha}?recursive=1
  → Returns full file tree (for initial sync)

GET /repos/{owner}/{repo}/git/blobs/{sha}
  → Returns file content (base64 encoded)
```

### Rate Limits
- **Unauthenticated**: 60 requests/hour
- **Authenticated** (with `GITHUB_TOKEN`): 5000 requests/hour
- **Daily cron**: ~3-5 API calls per sync (well within limits)

---

## Backward Compatibility

### Transition Period (90 days)
- Keep `fileNo` as optional field in `PolicyEntry`
- Maintain `previewUrl` and `downloadUrl` as optional
- Support reading old KV entries (graceful migration)

### Migration Strategy
1. Deploy new code with both data models supported
2. Run sync with GitHub source (populates `policyName`)
3. Monitor for 30 days
4. Optionally run KV key migration script
5. After 90 days, remove deprecated fields

---

## Performance Expectations

| Metric | v2.0.0 (Preview API) | v3.0.0 (GitHub) | Improvement |
|--------|---------------------|----------------|-------------|
| Sync duration | 100-200s | <20s | 5-10x faster |
| External API calls | ~100 (preview) | ~3-5 (GitHub) | 20-30x fewer |
| Network bandwidth | High (JSON responses) | Low (only diffs) | 10x less |
| Error surface | Multi-source (HTML + API) | Single source (GitHub) | Simpler |

---

## Test Requirements (Updated)

### Unit Tests (New)
- GitHub API client (mocked responses)
- Markdown parser (fixture-based)
- Change tracker (commit diff scenarios)
- Updated synchronizer (policyName comparison)
- Updated R2 writer (direct markdown)

### Integration Tests (Modified)
- End-to-end sync with mocked GitHub API
- First-run scenario (no previous commit SHA)
- No-change scenario (same commit SHA)
- Multi-file change scenario (added + modified + deleted)
- Rename detection
- Error handling (API failures, network issues)

### Regression Tests
- Existing KV data compatibility
- R2 path structure preservation
- Metadata format consistency

---

## Out of Scope

- Automatic KV key migration (manual script provided if needed)
- Support for multiple GitHub repositories
- Support for private repositories (requires `GITHUB_TOKEN`)
- Webhook-based real-time sync (still cron-based)
- Historical commit analysis beyond last sync

---

## Acceptance Sign-off

- [ ] Unit tests pass with >80% coverage
- [ ] Integration tests validate GitHub sync flow
- [ ] Performance benchmarks meet targets (<20s sync)
- [ ] Documentation updated (README, SPEC)
- [ ] Environment variables configured
- [ ] Staging deployment successful
- [ ] Production deployment approved
