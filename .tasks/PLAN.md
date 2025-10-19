# Implementation Plan - Policy Link Collection Worker

**Task ID**: `init-policy-parser`  
**Date**: 2025-10-19  
**Status**: ✅ Completed

## Goal
Deliver a daily Cloudflare Worker that synchronizes KNUE policy metadata with KV, enriches preview content, and exports both Markdown bundles and legacy JSON snapshots to R2.

## Dependencies

- Cloudflare Worker runtime (Node 18 compatibility).  
- R2 bucket `knue-vectorstore` (write access).  
- KV namespace `policy-registry`.  
- Preview parser service (`PREVIEW_PARSER_BASE_URL`) + valid `BEARER_TOKEN`.  
- Vitest, ESLint, TypeScript toolchain locally.

## Phased Plan (RSP-I Aligned)

### Phase 1 — Research & Scoping
- Capture HTML structure and link patterns (`fixtures/policy-page-sample.html`).
- Confirm preview parser contract (`atchmnflNo`, bearer auth).  
- Decide on KV schema + queue semantics (title as primary key).

### Phase 2 — Spec & Architecture
- Document cron timing (`SPEC-CRON-TIMING-001`).  
- Finalize KV sync algorithm (`SPEC-KV-SYNC-ALGO-001`).  
- Define full worker behavior and export formats (`SPEC-POLICY-COLLECTOR-001`, `.tasks/SPEC-DELTA.md`).

### Phase 3 — Ingestion Pipeline (TDD)
1. Implement `fetchPolicyPage` with retry/backoff + abort controller.  
2. Build `parsePolicyLinks` + `enrichLinksWithTitles` using real fixture.  
3. Write parser/ingester unit tests (`vitest`).

### Phase 4 — Registry Synchronization
- Implement `KVManager` CRUD helpers + queue utilities.  
- Implement `PolicySynchronizer` (add/update/delete detection, validation).  
- Ensure metadata writes + batching.  
- Cover with unit tests, including duplicates, invalid inputs, and edge-cases.

### Phase 5 — Export Layer
- Implement preview client + Markdown formatter (front matter, localized timestamps).  
- Implement `writePoliciestoR2ByTitle` with optional preview fetch + error downgrades.  
- Maintain legacy JSON writer (`writeLinksToR2`) with skip logic.  
- Unit tests for preview client, formatter, and both writers.

### Phase 6 — Integration & Hardening
- Compose `src/index.ts` scheduled workflow (logging, timelines).  
- Write integration test covering: cron guard, fixture ingestion, KV sync, Markdown exports, JSON skip, preview enrichment.  
- Validate error propagation and idempotency.

### Phase 7 — Tooling & Docs
- Update README + `.tasks/` documentation.  
- Ensure `.spec/` aligns with final behavior.  
- Configure Husky pre-commit (lint → typecheck → test).  
- Confirm `wrangler.jsonc` matches cron + bindings.

## Rollback / Mitigation
- Disable cron trigger via Cloudflare dashboard on critical failures.  
- Remove newly added KV keys by title prefix if data corruption detected.  
- Delete erroneous Markdown/JSON objects via R2 browser using known prefixes (`policies/`, `policy/`).

## Verification Checklist
- `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:coverage`.  
- Manual `wrangler dev --test-scheduled` smoke (optional).  
- Inspect logs for structured output + absence of secrets.  
- Verify R2 outputs using integration test storage mocks.

## Status
- ✅ All phases completed locally (tests green).  
- ⏳ Deployment + production cron monitoring pending handshake with platform ops.
