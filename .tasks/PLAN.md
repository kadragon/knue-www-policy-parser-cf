# Implementation Plan - Policy Link Collection Worker

**Task ID**: `init-policy-parser`
**Date**: 2025-10-19
**Status**: Completed

## Overview

Create a new Cloudflare Worker project to collect policy document links from KNUE website and store them in R2.

## Dependencies

### Context7 MCP Check
Not required - using standard web fetch and HTML regex parsing. No external libraries needed beyond:
- `date-fns-tz@^3.2.0` (already in use by RSS parser)
- Standard TypeScript/Cloudflare Workers types

## Implementation Steps

### Phase 1: Project Setup
**Goal**: Bootstrap project structure

**Tasks**:
1. Create project directory: `/Users/kadragon/Dev/knue-www-policy-parser-cf`
2. Copy configuration files from `knue-www-rss-parser-cf`:
   - `.agents/` (full policy structure)
   - `.gitignore`
   - `.eslintrc.json`
   - `tsconfig.json`
   - `vitest.config.ts`
   - `.env.example`
3. Create directory structure:
   - `src/` → `page/`, `storage/`, `utils/`
   - `test/` → `integration/`
   - `fixtures/`
   - `.github/workflows/`
4. Initialize git repository

**Acceptance**:
- ✅ All config files in place
- ✅ Directory structure created
- ✅ Git initialized

### Phase 2: Core Implementation (TDD)
**Goal**: Implement link collection logic

#### Step 2.1: Page Fetcher
**File**: `src/page/fetcher.ts`

**Test-First**:
- Test: Successful fetch
- Test: Retry on transient errors
- Test: Timeout handling
- Test: Non-retryable errors

**Implementation**:
- Fetch HTML from policy page URL
- Retry logic with exponential backoff
- Timeout per attempt (5s)
- User-Agent header

**Acceptance**:
- ✅ Fetches HTML successfully
- ✅ Retries up to 3 times
- ✅ Handles timeouts correctly

#### Step 2.2: Link Parser
**File**: `src/page/parser.ts`

**Test-First** (using real HTML fixture):
1. Download sample HTML to `fixtures/policy-page-sample.html`
2. Test: Extract fileNo values
3. Test: Generate preview URLs
4. Test: Generate download URLs
5. Test: Remove duplicates
6. Test: Filter by page key
7. Test: Extract title for known fileNo
8. Test: Return undefined for unknown fileNo
9. Test: Enrich links with titles

**Implementation**:
```typescript
parsePolicyLinks(html: string, pageKey: string): PolicyLink[]
  - Regex: /previewMenuCntFile\.do\?key=(\d+)&fileNo=(\d+)/g
  - Filter by pageKey
  - Deduplicate by fileNo
  - Generate full URLs

extractTitle(html: string, fileNo: string): string | undefined
  - Regex: /<p class="text_left">([^<]+)<\/p>[\s\S]{0,500}fileNo={fileNo}/
  - Return trimmed title or undefined

enrichLinksWithTitles(html: string, links: PolicyLink[]): PolicyLink[]
  - Map over links
  - Add title field if found
```

**Acceptance**:
- ✅ 96 links extracted from fixture
- ✅ All links have correct URL format
- ✅ No duplicates
- ✅ Titles extracted where available

#### Step 2.3: R2 Writer
**File**: `src/storage/r2-writer.ts`

**Test-First**:
- Test: Save links to R2 with correct path
- Test: JSON structure matches schema
- Test: Content-Type is application/json
- Test: Skip if file exists
- Test: Different paths for different dates
- Test: Handle empty links array

**Implementation**:
```typescript
writeLinksToR2(
  bucket: R2Bucket,
  links: PolicyLink[],
  pageKey: string,
  timestamp: Date
): Promise<WriteResult>
  - Generate path: policy/{pageKey}/YYYY_MM_DD_links.json
  - Check if exists (head)
  - If exists, return {saved: false, skipped: true}
  - Create JSON with timestamp, pageKey, count, links
  - Put to R2 with content-type
  - Return {saved: true, skipped: false, path}
```

**Acceptance**:
- ✅ Saves to correct path
- ✅ JSON has all required fields
- ✅ Skips duplicates
- ✅ Date-based paths work

#### Step 2.4: Main Workflow
**File**: `src/index.ts`

**Test-First** (Integration):
- Test: Reject direct HTTP requests (405)
- Test: Full workflow (fetch → parse → save)
- Test: Skip on duplicate execution
- Test: Handle fetch errors
- Test: Verify title enrichment

**Implementation**:
```typescript
fetch handler:
  - Return 405 with error message

scheduled handler:
  1. Log start
  2. Fetch policy page (with retry)
  3. Parse links
  4. Enrich with titles
  5. Save to R2
  6. Log results (saved/skipped)
  7. Handle errors (log + throw)
```

**Acceptance**:
- ✅ HTTP requests rejected
- ✅ Integration tests pass (5/5)
- ✅ Error handling works

### Phase 3: Configuration
**Goal**: Set up environment and deployment

**Tasks**:
1. Create `package.json`:
   - Name: `knue-www-policy-parser-cf`
   - Scripts: dev, deploy, test, lint, typecheck
   - Dependencies: minimal (date-fns-tz only)
2. Create `wrangler.jsonc`:
   - Cron: `0 2 * * 0` (Sunday 2AM UTC = 11AM KST)
   - R2 binding: `POLICY_STORAGE` → `knue-vectorstore`
   - Vars: `POLICY_PAGE_URL`, `POLICY_PAGE_KEY`
3. Set up Husky pre-commit hook
4. Copy `.mcp.json` for MCP servers

**Acceptance**:
- ✅ package.json configured
- ✅ wrangler.jsonc configured
- ✅ Pre-commit hook works

### Phase 4: Testing & Verification
**Goal**: Ensure quality and completeness

**Tasks**:
1. Run all tests: `npm test -- --run`
2. Check coverage: `npm run test:coverage`
3. Typecheck: `npm run typecheck`
4. Lint: `npm run lint`
5. Fix any type errors
6. Verify fixture-based tests

**Acceptance**:
- ✅ 20/20 tests passing
- ✅ No TypeScript errors
- ✅ No lint errors
- ✅ Coverage meets target

### Phase 5: Documentation
**Goal**: Complete README and task documentation

**Tasks**:
1. Create `README.md`:
   - Project description
   - Architecture diagram
   - Setup instructions
   - Testing guide
   - Cron schedule
   - Integration with other projects
2. Create `.tasks/` documentation:
   - `RESEARCH.md`: Analysis findings
   - `SPEC-DELTA.md`: Requirements
   - `PLAN.md`: This file
   - `PROGRESS.md`: Implementation log
   - `TASK_SUMMARY.md`: Executive summary

**Acceptance**:
- ✅ README complete
- ✅ Task documentation complete

## Rollback Plan

If issues arise:
1. Project is separate - no impact on existing systems
2. Delete directory and restart
3. Shared R2 bucket is read-only for this worker (only writes new files)

## Deployment Steps

1. Review configuration in `wrangler.jsonc`
2. Run: `npm run deploy`
3. Verify cron trigger in Cloudflare dashboard
4. Monitor first scheduled execution
5. Check R2 for output file

## Success Metrics

- [x] All tests passing (20/20)
- [x] TypeScript compilation clean
- [x] ESLint passing
- [x] README complete
- [x] Task documentation complete
- [ ] First deployment successful (pending)
- [ ] First cron execution successful (pending)
- [ ] Data appears in R2 (pending)

## Notes

- Reused existing R2 bucket (`knue-vectorstore`) - no new infrastructure needed
- Weekly schedule chosen (policies change infrequently)
- Future enhancement: Download and vectorize actual policy documents
- Can integrate with `knue-policy-vectorizer` for downstream processing
