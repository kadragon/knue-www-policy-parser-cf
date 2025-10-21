---
id: SPEC-POLICY-COLLECTOR-001
version: 2.1.0
scope: global
status: active
supersedes: [SPEC-POLICY-COLLECTOR-001 v1.0.0]
depends: [SPEC-GITHUB-INTEGRATION-001, SPEC-KV-SYNC-ALGO-001]
last-updated: 2025-10-20
owner: project-admin
---
# Policy Collection Worker Specification (GitHub Sync)

## Overview

Cloudflare Worker scheduled daily to synchronize KNUE policy markdown files from the public GitHub repository `kadragon/knue-policy-hub`. The worker performs commit-based change detection, updates the `policy-registry` KV namespace using `policyName` as the primary identifier, and writes per-policy markdown exports to Cloudflare R2.

Preview API enrichment and HTML crawling were removed in v2.0.0, and all legacy modules were deleted on 2025-10-20.

## Runtime Contracts

| Component | Contract |
|-----------|----------|
| Cron | `0 16 * * *` (16:00 UTC / 01:00 KST daily). See `SPEC-CRON-TIMING-001`. |
| GitHub API | Uses REST v3 endpoints (`commits`, `compare`, `git/trees`, `git/blobs`). Requests must complete within 5s and respect rate limits (60 req/h unauthenticated, 5000 req/h with token). |
| KV Registry | Namespace binding `POLICY_REGISTRY`. Keys follow `policy:{policyName}`. Requires read/list/write/delete. Stores sync metadata at `metadata:sync:lastRun` and `metadata:sync:lastCommit`. |
| R2 Storage | Bucket binding `POLICY_STORAGE`. Markdown exports saved under `policies/{policyName}/policy.md`. Writes must be idempotent; existing objects are overwritten with latest content. |
| HTTP Fetch Entry | `fetch()` continues to reject external HTTP requests with HTTP 405 JSON payload, preserving cron-only operation. |

## Acceptance Criteria (v2.0.0)

1. **HTTP Guard** — Direct HTTP requests to the Worker respond with HTTP 405 and a JSON body indicating cron-only support. (Regression from v1.0.0)
2. **Scheduled Execution** — The `scheduled()` handler runs exactly once per cron slot and logs ISO timestamps for start and completion events.
3. **Latest Commit Retrieval** — The worker fetches the latest commit SHA for `GITHUB_REPO`/`GITHUB_BRANCH`. Rate-limit (403) and not-found (404) responses produce structured errors and abort the run.
4. **Commit Diff Detection** — When a previous commit SHA exists in `metadata:sync:lastCommit`, the worker requests the compare API and filters results to `.md` files excluding `README.md`. When the commit SHA is unchanged, diff processing is skipped.
5. **Initial Sync Tree Scan** — On first run (no stored commit), the worker retrieves the full git tree recursively, selecting only `.md` blobs and excluding `README.md` files.
6. **Markdown Parsing** — Each changed blob is decoded and parsed to extract `policyName` (filename without extension), `title` (first `#` heading), and raw markdown content. Empty files emit warnings and are skipped.
7. **KV Synchronization** — `PolicySynchronizer.synchronize()` computes additions/updates/deletions keyed by `policyName`, compares Git `sha` values, writes updated entries to `POLICY_REGISTRY`, removes missing policies, and updates queue items when enabled.
8. **Metadata Persistence** — After a successful KV write cycle, the worker records the latest commit SHA in `metadata:sync:lastCommit` and writes sync statistics to `metadata:sync:lastRun`, including `commitSHA` and `previousCommitSHA`.
9. **R2 Markdown Export** — Updated policy documents are written to `policies/{policyName}/policy.md` with YAML front matter containing `policyName`, `title`, `sha`, `path`, `savedAt`, and `lastUpdated`. Markdown body mirrors the GitHub source without Preview API enrichment.
10. **Idempotency & Deletion** — Policies deleted from the repository trigger KV deletions and R2 object removals (if implemented) or are logged as pending cleanup. Duplicate runs with identical commit SHA make no external API calls beyond the initial commit fetch.
11. **Observability** — Logs capture GitHub repository/branch, previous & current commit SHA, counts of added/modified/deleted policies, KV stats (processed/add/update/delete), R2 write counts, elapsed duration, and error summaries.
12. **Failure Handling** — Any unhandled error aborts the run after logging context. Partial failures (e.g., single file >1MB) log warnings and continue processing remaining files.

## Data Structures

```typescript
interface PolicyDocument {
  policyName: string;   // Filename without .md extension
  title: string;        // First level-1 heading, fallback to policyName
  content: string;      // Full markdown content from GitHub
  sha: string;          // Git blob SHA
  path: string;         // Relative path within the repository
  lastModified?: string;// Optional ISO timestamp derived from commit (if available)
}

interface PolicyEntry {
  policyName: string;
  title: string;
  status: 'active';
  lastUpdated: string;  // ISO 8601 timestamp of synchronization
  sha: string;
  path: string;
  fileNo?: string;      // Legacy migration field (optional)
  previewUrl?: string;  // Legacy migration field (optional)
  downloadUrl?: string; // Legacy migration field (optional)
}

interface SyncMetadata {
  timestamp: string;
  totalProcessed: number;
  added: number;
  updated: number;
  deleted: number;
  status: 'success' | 'failure';
  errorCount: number;
  commitSHA?: string;
  previousCommitSHA?: string;
}
```

- KV key pattern: `policy:{policyName}`.
- R2 object key: `policies/{policyName}/policy.md`.
- `metadata:sync:lastCommit`: stores latest commit SHA as a raw string.

## Error Handling & Retries

- GitHub network errors retry up to 3 times with exponential backoff (1s → 2s → 4s).
- Rate-limit responses (`403` with `X-RateLimit-Remaining: 0`) log retry-after timestamp and abort; next cron run retries automatically.
- Missing repository/branch (`404`) is treated as configuration error and aborts without retry.
- Blobs larger than 1 MB are skipped with warning logs; they do not fail the run.
- KV or R2 write failures propagate and mark the run as failed.

## Observability Requirements

- Structured logging with JSON-friendly key/value pairs for major phases.
- Success log must include total duration in milliseconds.
- On failure, include `error.name`, `error.message`, and stack trace (if available).
- Emit summary line for KV (`added`, `updated`, `deleted`) and R2 (`written`, `skipped`, `removed`).

## Testing Requirements

- **Unit Tests**: GitHub client (commit/tree/blob/diff), markdown parser edge cases, KV synchronizer diff logic, R2 writer YAML front matter.
- **Integration Tests**: First-run scenario (no previous commit), unchanged commit short-circuit, mixed add/update/delete diff, rate-limit error propagation, large file skip.

## Security & Compliance

- Secrets (`GITHUB_TOKEN`) must be stored as Workers secrets; never log or persist the token.
- Repository identifiers (`GITHUB_REPO`, `GITHUB_BRANCH`) validated using regex `^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$`.
- GitHub responses are sanitized before logging (no raw content for large markdown files).
- Legacy preview API tokens remain unsupported in active workflow.

## Migration Notes

- KV entries containing legacy fields (`fileNo`, `previewUrl`, `downloadUrl`) must remain readable; new writes omit these fields unless migration utilities populate them.
- Snapshot JSON exports are optional and disabled by default in v2.0.0.
