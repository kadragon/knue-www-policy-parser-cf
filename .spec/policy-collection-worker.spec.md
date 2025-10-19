---
id: SPEC-POLICY-COLLECTOR-001
version: 1.0.0
scope: global
status: active
supersedes: []
depends: [SPEC-CRON-TIMING-001, SPEC-KV-SYNC-ALGO-001]
last-updated: 2025-10-19
owner: project-admin
---
# Policy Collection Worker Specification

## Overview

Cloudflare Worker that ingests KNUE policy metadata on a daily schedule, synchronizes a KV registry, and exports both JSON snapshots and Markdown bundles to R2. The worker enriches each policy with preview content fetched from the preview-parser API.

## Runtime Contracts

| Component | Contract |
|-----------|----------|
| Cron | `0 16 * * *` (16:00 UTC / 01:00 KST daily) — see `SPEC-CRON-TIMING-001`. |
| Fetch | Source HTML at `POLICY_PAGE_URL` must return HTTP 200 within 5s; transient failures retried up to 3 times with exponential backoff. |
| KV Registry | Namespace `POLICY_REGISTRY` stores canonical policy records keyed by `policy:{title}`. Requires read/write/list access. |
| R2 Storage | Bucket binding `POLICY_STORAGE` must allow `put`, `get`, `head`. Markdown exports saved under `policies/{fileNo}/policy.md`; legacy JSON saved under `policy/{pageKey}/{yyyy}_{mm}_{dd}_links.json`. |
| Preview API | `PREVIEW_PARSER_BASE_URL` + `BEARER_TOKEN` supply optional policy content; request uses query `atchmnflNo={fileNo}` and `Authorization: Bearer <token>`. |

## Acceptance Criteria

1. **HTTP Guard** — `fetch()` responds with HTTP 405 JSON payload when invoked outside cron context.
2. **Scheduled Run** — `scheduled()` executes successfully when triggered with the daily cron schedule.
3. **Page Fetching** — Worker retries transient errors (429/503/timeouts) up to three attempts, aborting after `timeoutMs` (default 5000ms).
4. **Link Extraction** — Parser deduplicates `fileNo`, filters by `POLICY_PAGE_KEY`, and constructs absolute preview/download URLs.
5. **Title Enrichment** — Titles are extracted from nearby `<p class="text_left">` nodes; absence of a title results in `title` being undefined.
6. **Preview Enrichment** — When `fetchContent` is enabled and preview API credentials exist, Markdown output embeds returned `summary`, `content`, and additional fields.
7. **KV Synchronization** — Sync engine validates inputs, computes add/update/delete sets, persists them to KV, enqueues operations, and writes `metadata:sync:lastRun`.
8. **Per-Policy Markdown Export** — For each enriched link, worker writes `policies/{fileNo}/policy.md` with YAML front matter and localized timestamps (ko-KR). Missing preview content is allowed.
9. **Legacy JSON Snapshot** — Worker writes daily snapshot unless an object already exists for the same date; when existing, report skip without error.
10. **Logging** — Execution logs include start/end timestamps, KV statistics, and R2 summaries; errors emit structured details (message + stack).
11. **Credential Hygiene** — `BEARER_TOKEN` is never logged nor written to storage. Failures fetching preview content are logged as warnings without leaking token value.

## Data Structures

```typescript
interface PolicyLink {
  fileNo: string;
  previewUrl: string;
  downloadUrl: string;
  title?: string;
}

interface PolicyRecord extends PolicyLink {
  status: 'active' | 'archived';
  lastUpdated: string; // ISO8601
}

interface MarkdownFrontMatter {
  title: string;
  fileNo: string;
  savedAt: string;      // ISO8601
  lastUpdated: string;  // ISO8601
}
```

- Markdown body sections: `## 기본 정보`, `## 링크`, optional `## 정책 내용` (with `### 요약`, `### 전문`), optional `### 추가 정보`.
- Snapshot JSON payload:
  ```json
  {
    "timestamp": "<ISO8601>",
    "pageKey": "<POLICY_PAGE_KEY>",
    "count": <number>,
    "links": PolicyLink[]
  }
  ```
- KV schema defined in `SPEC-KV-SYNC-ALGO-001`.

## Error Handling

- Abort fetch retries on non-retryable HTTP statuses (e.g., 400/404) and propagate error.
- Markdown export logs warning and continues when preview fetch fails.
- KV persistence errors halt the run and surface via thrown exceptions.
- Combined snapshot write aborts when R2 `head()` indicates the file already exists (treated as non-error).

## Observability

- Required log markers:
  - Start/end banners with ISO timestamp.
  - Fetch success with HTML byte length.
  - KV summary (total processed, added, updated, deleted).
  - R2 summary (policies saved, snapshot path or skip reason).
- Failures must include stack trace (when available).

## Testing Requirements

- **Unit**: parser, preview fetcher/formatter, KV manager, policy synchronizer, R2 writers.
- **Integration**: end-to-end scheduled run using fixture HTML, verifying KV writes, Markdown exports, legacy JSON skip logic, and preview enrichment.
- **Regression**: ensure duplicate cron executions on same date keep snapshots idempotent and rewrite Markdown content.

## Security & Compliance

- Treat preview API errors as recoverable; do not halt entire job unless critical.
- Ensure Markdown output escapes YAML metacharacters inside titles.
- Validate `fileNo` digits prior to KV persistence, rejecting invalid data.
