# Research Log - KNUE Policy Metadata Pipeline

**Task ID**: `init-policy-parser`  
**Date**: 2025-10-19  
**Status**: Completed

## Problem Statement
Collect authoritative policy metadata from `https://www.knue.ac.kr/www/contents.do?key=392`, normalize it, and distribute it to downstream services (KV registry, Markdown exports, legacy JSON snapshots).

## Source Analysis

### Policy Page Structure
- HTML contains `<a>` elements pointing to `previewMenuCntFile.do?key=392&fileNo={n}`.  
- Download endpoints follow `/downloadContentsFile.do?key=392&fileNo={n}`.  
- Titles sit inside `<p class="text_left">` blocks located near the link cluster (≤500 chars apart).
- Fixture stored as `fixtures/policy-page-sample.html` (3,228 lines, captured 2025-10-19).

### Volume & Variability
- Fixture reveals 96 unique `fileNo` values; expect ~100 policies.  
- New policies append to the page; removals rare but possible (necessitates delete detection).
- HTML layout has remained stable across current and archival snapshots.

### Preview Parser Contract
- Existing worker `knue-www-preview-parser-cf` exposes GET endpoint expecting `atchmnflNo` query.  
- Requires `Authorization: Bearer <token>`.  
- Response includes fields `{ title?, summary?, content?, ... }`.  
- Average response size <100 KB; 1–2 requests per policy acceptable with `fetchContent` flag.

## Downstream Requirements

| Consumer | Need | Mapping |
|----------|------|---------|
| KV Registry (`policy-registry`) | Canonical title → fileNo map | Add/update/delete with metadata |
| Markdown exports (R2) | Human-readable policy bundle | YAML front matter + localized timestamps + preview content |
| Legacy consumers | JSON snapshot identical to prior worker | Keep path `policy/{pageKey}/{yyyy}_{mm}_{dd}_links.json` |
| Vectorizer service | Markdown ingestion | Requires Markdown path stable per `fileNo` |

## Technical Constraints & Decisions

- **Primary key**: Use `title` for KV registry; it remains consistent between revisions.  
- **Idempotency**: Use `bucket.head` to skip duplicate JSON writes; Markdown overwrites allowed (captures new preview content).  
- **Cron Frequency**: Daily at 01:00 KST to capture regulatory updates promptly while bounding resource usage.  
- **Retries**: HTML fetch uses exponential backoff (1s → 2s → 4s). Preview fetch limited to 2 retries to avoid long tail.  
- **Localization**: Markdown headings remain Korean to align with knowledge-base usage.

## Evidence

- Fixture extraction using `curl -s` recorded in repository.  
- Vitest unit and integration suites confirm parser & exporter behavior using mocks.  
- Manual preview API test (2025-10-19) returned sample content with expected schema (see `test/preview.test.ts`).

## Open Questions / Future Work

1. Should we persist complete PDFs to R2 alongside Markdown? (Deferred.)  
2. Need for multi-page crawling if KNUE splits policies by category? (Monitor page updates.)  
3. Evaluate caching strategy for preview API to reduce outbound calls if content unchanged.
