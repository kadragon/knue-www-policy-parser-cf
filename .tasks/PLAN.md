# Implementation Plan - GitHub Repository Migration

**Task ID**: `github-repo-migration`
**Date**: 2025-10-20
**Status**: 🟡 In Progress
**Supersedes**: `init-policy-parser`

## Goal

Migrate policy collection from slow preview API to fast GitHub repository-based fetching, implementing Git commit-based change tracking and policyName-centric data model.

## Dependencies

- Cloudflare Worker runtime (Node 18 compatibility)
- R2 bucket `knue-vectorstore` (write access)
- KV namespace `policy-registry`
- GitHub public repository `kadragon/knue-policy-hub`
- Vitest, ESLint, TypeScript toolchain

## Phased Plan (RSP-I Aligned)

### Phase 1 — Research & Documentation ✅
- ✅ Analyze current implementation bottleneck
- ✅ Investigate GitHub repository structure
- ✅ Design new data model (policyName-centric)
- ✅ Document technical decisions in `.tasks/RESEARCH.md`

### Phase 2 — Specification & Architecture 🔄
- 🔄 Update `.tasks/SPEC-DELTA.md` with new acceptance criteria
- 🔄 Create `.spec/github-integration.spec.md` for GitHub client behavior
- 🔄 Create `.spec/policy-name-migration.spec.md` for data model migration
- 🔄 Update existing `.spec/kv-sync-algorithm.spec.md` to reflect policyName keys

### Phase 3 — GitHub Integration Module (TDD) 📋
#### 3.1 Types & Interfaces
- [ ] Create `src/github/types.ts` with GitHub API response types
- [ ] Define `PolicyDocument`, `ChangeSet` interfaces

#### 3.2 GitHub API Client
- [ ] Implement `src/github/client.ts`:
  - [ ] `getLatestCommit(owner, repo, branch)` → commit SHA
  - [ ] `getCommitDiff(owner, repo, baseCommit, headCommit)` → file changes
  - [ ] `getFileTree(owner, repo, commitSHA, recursive)` → all .md files
  - [ ] `getFileContent(owner, repo, blobSHA)` → base64 decoded content
- [ ] Add retry logic + timeout handling
- [ ] Unit tests with mocked fetch responses

#### 3.3 Markdown Parser
- [ ] Implement `src/github/markdown.ts`:
  - [ ] `extractPolicyName(filepath)` → filename without extension
  - [ ] `extractTitle(markdown)` → first `# heading` (fallback to filename)
  - [ ] `parseMarkdown(content, path)` → PolicyDocument
- [ ] Handle edge cases: no heading, multiple `#`, empty files
- [ ] Unit tests with fixture markdown samples

#### 3.4 Change Tracker
- [ ] Implement `src/github/tracker.ts`:
  - [ ] `detectChanges(currentCommit, lastCommit, owner, repo)` → ChangeSet
  - [ ] Filter .md files, exclude README.md
  - [ ] Map file status to (added, modified, deleted)
  - [ ] Handle renames using `previous_filename`
- [ ] Integration tests with GitHub API mocks

### Phase 4 — Data Model Migration 📋
#### 4.1 Update KV Types
- [ ] Modify `src/kv/types.ts`:
  - [ ] Add `policyName` field (required)
  - [ ] Make `fileNo` optional (for backward compatibility)
  - [ ] Update `PolicyEntry` interface
  - [ ] Update queue entry structure

#### 4.2 Migration Utilities
- [ ] Create `src/kv/migration.ts` (optional, for existing data):
  - [ ] `migrateFileNoToPolicyName()` → remap KV keys
  - [ ] Log migration actions for rollback

### Phase 5 — Synchronizer Refactoring 📋
- [ ] Update `src/kv/synchronizer.ts`:
  - [ ] Change comparison key from `title` to `policyName`
  - [ ] Update `buildPolicyMap` to use `policyName`
  - [ ] Modify `createPolicyEntry` to include `policyName`
  - [ ] Update validation logic for new schema
- [ ] Update unit tests to reflect policyName-based logic

### Phase 6 — R2 Writer Refactoring 📋
- [ ] Update `src/storage/r2-writer.ts`:
  - [ ] Remove `fetchPreviewContent` calls
  - [ ] Use markdown content from GitHub directly
  - [ ] Change path structure: `policies/{policyName}/policy.md`
  - [ ] Update front matter to include `policyName`, `sha`, `path`
  - [ ] Remove or deprecate preview API dependencies
- [ ] Update unit tests with direct markdown inputs

### Phase 7 — Main Workflow Integration 📋
- [ ] Update `src/index.ts` scheduled handler:
  - [ ] Remove HTML fetching + parsing logic
  - [ ] Add GitHub client initialization
  - [ ] Fetch latest commit SHA
  - [ ] Load last synced commit from KV (`metadata:sync:lastCommit`)
  - [ ] Detect changes using `tracker.detectChanges()`
  - [ ] Convert `ChangeSet` to `ApiPolicy[]` format
  - [ ] Run existing synchronizer with new data
  - [ ] Write policies to R2 using direct markdown
  - [ ] Update last commit SHA in KV
- [ ] Preserve legacy JSON snapshot (optional, for compatibility)

### Phase 8 — Environment & Configuration 📋
- [ ] Update `wrangler.jsonc`:
  - [ ] Add `GITHUB_REPO: "kadragon/knue-policy-hub"`
  - [ ] Add `GITHUB_BRANCH: "main"`
  - [ ] Add `GITHUB_TOKEN: ""` (optional, for future)
  - [ ] Remove `PREVIEW_PARSER_BASE_URL` (deprecated)
  - [ ] Remove `BEARER_TOKEN` (deprecated)
- [ ] Update `.env.example` if exists
- [ ] Document new environment variables in README

### Phase 9 — Testing & Validation 📋
#### 9.1 Unit Tests
- [ ] GitHub client tests (API mocking)
- [ ] Markdown parser tests (fixture-based)
- [ ] Change tracker tests (commit diff scenarios)
- [ ] Updated synchronizer tests (policyName comparison)
- [ ] Updated R2 writer tests (direct markdown)

#### 9.2 Integration Tests
- [ ] End-to-end sync flow with mocked GitHub API
- [ ] Verify KV updates (added, modified, deleted)
- [ ] Verify R2 markdown exports
- [ ] Verify commit SHA tracking
- [ ] Test first-run scenario (no previous commit)
- [ ] Test no-change scenario (same commit SHA)

#### 9.3 Coverage & Quality
- [ ] Run `npm run test:coverage` → target 80%+
- [ ] Run `npm run lint` → zero warnings
- [ ] Run `npm run typecheck` → zero errors

### Phase 10 — Deprecation & Cleanup 📋
- [x] Remove legacy `src/page/` and `src/preview/` modules (2025-10-20)
- [x] Delete `_deprecated/` directory and associated regression tests
- [x] Update docs/specs to reflect permanent Preview API removal

### Phase 11 — Documentation 📋
- [ ] Update main README.md:
  - [ ] Document new GitHub-based approach
  - [ ] Update environment variables section
  - [ ] Add migration guide
- [ ] Update `.tasks/TASK_SUMMARY.md`
- [ ] Archive old specs to `.spec/_archive/`
- [ ] Create `.spec/github-integration.spec.md`
- [ ] Create `.spec/policy-name-migration.spec.md`

### Phase 12 — Deployment & Monitoring 📋
- [ ] Test locally with `wrangler dev --test-scheduled`
- [ ] Deploy to staging/preview environment
- [ ] Run manual sync and verify logs
- [ ] Compare performance metrics (old vs new)
- [ ] Deploy to production
- [ ] Monitor first 3 cron runs for errors
- [ ] Verify GitHub API rate limit usage

## Rollback Strategy

If critical issues arise:
1. **Code**: Revert to previous commit (`git revert`)
2. **KV**: Restore from backup if migration applied
3. **Environment**: Switch back to old env vars via dashboard
4. **Cron**: Disable trigger temporarily if needed

## Verification Checklist

- [ ] All tests pass (`npm test`)
- [ ] No lint errors (`npm run lint`)
- [ ] No type errors (`npm run typecheck`)
- [ ] Coverage ≥ 80% (`npm run test:coverage`)
- [ ] Local scheduled test succeeds
- [ ] R2 markdown exports validated
- [ ] KV registry entries correct
- [ ] Commit SHA tracking works
- [ ] Performance improvement confirmed (>5x faster)
- [ ] GitHub API rate limit not exceeded

## Success Metrics

| Metric | Before | Target | Actual |
|--------|--------|--------|--------|
| Sync duration | 100-200s | <20s | TBD |
| API calls | ~100 (preview) | ~3 (GitHub) | TBD |
| Error rate | <5% | <1% | TBD |
| Code complexity | High (multi-source) | Medium (single source) | TBD |

## Status

- ✅ Phase 1: Research complete
- 🔄 Phase 2: Spec in progress
- 📋 Phases 3-12: Pending
