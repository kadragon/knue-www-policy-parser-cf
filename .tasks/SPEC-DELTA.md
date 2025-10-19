# Specification - Policy Link Collection Worker (Daily Sync)

**Task ID**: `init-policy-parser`  
**Version**: 2.0.0  
**Date**: 2025-10-19  
**Status**: Active

## Acceptance Criteria

1. **AC-1: Daily Cron Execution**  
   - GIVEN the worker is deployed with cron trigger `0 16 * * *`  
   - WHEN it is 16:00 UTC on any calendar day  
   - THEN the scheduled handler runs exactly once for that slot and logs the ISO timestamp of the run.

2. **AC-2: Guarding HTTP Requests**  
   - GIVEN an HTTP request hits the worker  
   - WHEN the request uses `fetch()` entrypoint  
   - THEN the worker returns HTTP 405 with a JSON body explaining that only cron triggers are allowed.

3. **AC-3: Policy Page Fetching**  
   - GIVEN `POLICY_PAGE_URL` resolves correctly  
   - WHEN the scheduled handler executes  
   - THEN it fetches HTML within 5s, retrying up to 3 times on `429`, `503`, timeouts, or aborted requests, and aborts early on non-retryable errors.

4. **AC-4: Link Extraction & Title Enrichment**  
   - GIVEN valid HTML is retrieved  
   - WHEN `parsePolicyLinks` runs  
   - THEN it returns deduplicated entries filtered by `POLICY_PAGE_KEY` with absolute preview/download URLs.  
   - AND `enrichLinksWithTitles` attempts to attach `title` per `fileNo`, leaving the field undefined if not found.

5. **AC-5: Preview API Enrichment**  
   - GIVEN `PREVIEW_PARSER_BASE_URL` and `BEARER_TOKEN` are configured  
   - WHEN per-policy exports are written  
   - THEN the worker calls the preview API with `atchmnflNo={fileNo}` and Authorization header, and, upon success, includes `summary`, `content`, and any extra fields in the Markdown output.  
   - AND any fetch failure downgrades to a warning without aborting the run.

6. **AC-6: KV Synchronization**  
   - GIVEN enriched link data with titles  
   - WHEN `PolicySynchronizer.synchronize` executes  
   - THEN new titles are added, changed `fileNo` values are updated, missing titles are dropped, and removed titles are deleted.  
   - AND matching queue entries are enqueued for add/update operations.  
   - AND sync metadata (`metadata:sync:lastRun`) records counts and success status.

7. **AC-7: Per-Policy Markdown Export**  
   - GIVEN enriched links (with or without preview content)  
   - WHEN `writePoliciestoR2ByTitle` runs  
   - THEN each policy is written to `policies/{fileNo}/policy.md` with YAML front matter (`title`, `fileNo`, `savedAt`, `lastUpdated`) and sections: `## 기본 정보`, `## 링크`, optionally `## 정책 내용`.  
   - AND exports succeed even if preview content is absent.

8. **AC-8: Legacy Snapshot JSON**  
   - GIVEN the run date (KST)  
   - WHEN `writeLinksToR2` executes  
   - THEN it writes a JSON snapshot to `policy/{pageKey}/{yyyy}_{mm}_{dd}_links.json` unless an object already exists, in which case it logs a skip and returns without error.

9. **AC-9: Observability & Logging**  
   - GIVEN the worker runs under cron  
   - WHEN each phase completes  
   - THEN logs include phase banners, counts of parsed policies, KV sync stats, per-policy export counts, snapshot status, duration, and structured error details on failure.

10. **AC-10: Failure Propagation**  
    - GIVEN a critical error occurs in fetch, parse, KV sync, or legacy snapshot write  
    - WHEN the error is thrown  
    - THEN the worker rethrows after logging and the run is marked as failed, preventing partial metadata from being recorded.

## Data Schema

```typescript
interface PolicyLink {
  fileNo: string;
  previewUrl: string;
  downloadUrl: string;
  title?: string;
}

interface PolicyMarkdownFrontMatter {
  title: string;
  fileNo: string;
  savedAt: string;      // ISO-8601
  lastUpdated: string;  // ISO-8601
}

interface SnapshotPayload {
  timestamp: string;
  pageKey: string;
  count: number;
  links: PolicyLink[];
}
```

- KV schema follows `.spec/kv-sync-algorithm.spec.md` (`policy:{title}`, `metadata:sync:lastRun`, optional `queue:{title}`).
- Markdown body contains localized timestamps formatted with `ko-KR` locale.

## Non-Functional Requirements

- **Performance**: End-to-end execution under 10 seconds given <150 policies; preview fetch timeout defaults to 10s.  
- **Reliability**: Retry backoff begins at 1s with multiplier 2 and caps at 10s; KV and R2 operations surface errors immediately.  
- **Idempotency**: Markdown exports overwrite existing objects; JSON snapshot skips if already present for the day.  
- **Security**: `BEARER_TOKEN` never logged or persisted; errors redact token contents.  
- **Localization**: Markdown sections and labels remain in Korean to match downstream readers.

## Environment Variables & Secrets

| Name | Type | Required | Example | Notes |
|------|------|----------|---------|-------|
| `POLICY_PAGE_URL` | string | ✅ | `https://www.knue.ac.kr/www/contents.do?key=392` | Source HTML |
| `POLICY_PAGE_KEY` | string | ✅ | `392` | Used to filter links |
| `PREVIEW_PARSER_BASE_URL` | string | ✅ | `https://knue-www-preview-parser-cf...` | HTTPS endpoint expecting `atchmnflNo` |
| `BEARER_TOKEN` | secret | ✅ | *(Workers secret)* | Required for preview fetch |
| `POLICY_STORAGE` | R2 bucket binding | ✅ | `knue-vectorstore` | Holds Markdown + JSON |
| `POLICY_REGISTRY` | KV namespace binding | ✅ | `policy-registry` | Stores canonical records |

## Test Requirements

- **Unit**: parser, preview fetcher, formatter, KV manager, synchronizer, R2 writers.
- **Integration**: fixture-driven scheduled run verifying KV sync, Markdown export count, legacy JSON skip behavior, and preview enrichment.
- **Regression**: duplicate cron execution within same day results in skipped JSON but refreshed Markdown.
- **Mocks**: Provide deterministic mock clock and random seeds where required; stub preview API responses.

## Out of Scope

- Downloading or persisting full PDFs/content beyond preview API payloads.
- Multi-page crawling (only `POLICY_PAGE_KEY` 392 supported).
- Historical diffing beyond daily snapshot retention.
