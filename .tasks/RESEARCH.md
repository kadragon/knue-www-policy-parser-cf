# Research Log - GitHub Repository Migration

**Task ID**: `github-repo-migration`
**Date**: 2025-10-20
**Status**: In Progress
**Supersedes**: `init-policy-parser` (v2.0.0)

## Problem Statement

The current implementation fetches policy content via `PREVIEW_PARSER_BASE_URL` API endpoint, which is slow and creates a performance bottleneck. We need to migrate to fetching pre-parsed markdown files directly from a GitHub repository (`kadragon/knue-policy-hub`) to improve sync speed and reduce external API dependencies.

## Current Implementation Analysis

### Data Flow (Before)
```
1. Fetch HTML from KNUE website → Parse links (fileNo, previewUrl, downloadUrl)
2. For each policy → Call PREVIEW_PARSER_BASE_URL API (SLOW!)
3. Sync to KV registry (fileNo-based)
4. Export to R2 as markdown
```

### Performance Bottleneck
- **Preview API calls**: N sequential HTTP requests (N = ~100 policies)
- **Average latency**: 1-2 seconds per request
- **Total overhead**: 100-200 seconds just for content fetching
- **Failure mode**: Single API failure doesn't block entire sync (downgrade to warning)

### Current Data Model
```typescript
interface PolicyLink {
  fileNo: string;        // Primary key from KNUE website
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

## GitHub Repository Analysis

### Source Repository
- **URL**: `https://github.com/kadragon/knue-policy-hub`
- **Access**: Public repository (GitHub API, no auth required)
- **File structure**: Recursive markdown files (README.md excluded)

### Key Differences
| Aspect | Current (KNUE Website) | New (GitHub Repo) |
|--------|----------------------|-------------------|
| Primary Key | `fileNo` (numeric ID) | `policyName` (filename) |
| Title Source | HTML parsing | Markdown `# heading` |
| Content Source | Preview API call | Direct file read |
| Change Detection | Daily full scan | Git commit diff |
| Rate Limiting | KNUE website limits | GitHub API: 60 req/h (unauth) |

### Data Model Changes Required
```typescript
// Before: fileNo-centric
{
  fileNo: "868",
  title: "학칙",
  previewUrl: "...",
  downloadUrl: "..."
}

// After: policyName-centric
{
  policyName: "학칙",  // Filename without .md extension
  title: "학칙",       // First # heading in markdown
  content: "...",      // Full markdown content
  sha: "abc123...",    // Git blob SHA
  path: "policies/학칙.md"
}
```

## Technical Decisions

### 1. GitHub API Strategy
- **Use GitHub REST API v3** (well-documented, stable)
- **Endpoints needed**:
  - `GET /repos/{owner}/{repo}/commits/{ref}` → Latest commit SHA
  - `GET /repos/{owner}/{repo}/compare/{base}...{head}` → Diff between commits
  - `GET /repos/{owner}/{repo}/git/trees/{sha}?recursive=1` → Full file tree
  - `GET /repos/{owner}/{repo}/git/blobs/{sha}` → File content (base64)

### 2. Change Tracking Strategy
- **Store last sync commit SHA** in KV (`metadata:sync:lastCommit`)
- **On each sync**:
  1. Fetch latest commit SHA
  2. Compare with stored SHA
  3. If different → fetch commit diff (added/modified/deleted files)
  4. Only process changed .md files (not full tree scan)
  5. Update stored SHA after successful sync

### 3. Rate Limit Mitigation
- **Unauthenticated GitHub API**: 60 requests/hour
- **Daily cron**: 1 run/day = well within limits
- **Optimization**: Use tree API (1 call) instead of listing+fetching each file
- **Future**: Add `GITHUB_TOKEN` if needed (5000 req/h)

### 4. Markdown Parsing
```markdown
# 학칙

## 제1장 총칙

...
```
- **Extract policyName**: Filename without `.md` (e.g., `학칙.md` → `학칙`)
- **Extract title**: First `# heading` (fallback to filename if not found)
- **Content**: Full markdown text (preserve formatting)

### 5. Migration Path
- **Backward compatibility**: Keep `fileNo` field as optional for transition period
- **KV key migration**:
  - Old: `policy:{title}` (title derived from HTML)
  - New: `policy:{policyName}` (policyName = filename)
  - If collision → title takes precedence during migration

## Evidence

### GitHub API Test (2025-10-20)
```bash
# Latest commit
curl -s https://api.github.com/repos/kadragon/knue-policy-hub/commits/main \
  | jq -r '.sha'
# → Returns commit SHA

# Tree listing (recursive)
curl -s "https://api.github.com/repos/kadragon/knue-policy-hub/git/trees/main?recursive=1" \
  | jq '.tree[] | select(.path | endswith(".md")) | .path'
# → Returns all .md file paths
```

### Performance Projection
- **Current**: ~100-200s (N preview API calls)
- **GitHub approach**: ~5-10s (1 tree call + changed files only)
- **Expected improvement**: 10-20x faster

## Risks & Mitigation

| Risk | Impact | Mitigation |
|------|--------|-----------|
| GitHub API rate limit (60/h) | Sync failure | Monitor usage, add token if needed |
| Repo structure change | Parser breaks | Validate structure, add tests |
| Large file (>1MB blob) | API error | Filter by size, skip oversized files |
| Filename encoding (Korean) | URL encoding issues | Use blob SHA, not filename in URLs |
| Network partition | Sync failure | Keep retry logic, fallback to last known state |

## Open Questions

1. **Should we preserve fileNo mapping?**
   → Yes, as optional field for transition period (90 days)

2. **How to handle renamed files?**
   → Git diff includes `previous_filename` → detect renames, update KV key

3. **What if markdown has no `# heading`?**
   → Fallback to filename as title, log warning

4. **Archive old preview fetcher code?**
   → Mark as deprecated, move to `src/_deprecated/` after 30-day validation period

## Next Steps

1. Implement GitHub client (`src/github/client.ts`)
2. Implement markdown parser (`src/github/markdown.ts`)
3. Implement change tracker (`src/github/tracker.ts`)
4. Update KV types to support both `fileNo` and `policyName`
5. Refactor synchronizer to use `policyName` as primary key
6. Write comprehensive tests with GitHub API mocks
