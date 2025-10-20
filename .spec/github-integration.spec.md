# Specification - GitHub Integration

**Spec ID**: `SPEC-GITHUB-INTEGRATION-001`
**Version**: 1.0.0
**Date**: 2025-10-20
**Status**: Active
**Related**: `SPEC-KV-SYNC-ALGO-001`, `SPEC-POLICY-NAME-MIGRATION-001`

---

## Purpose

Define the behavior and contract for GitHub API integration, enabling the worker to fetch policy markdown files directly from a public GitHub repository, track changes via Git commit diffs, and parse markdown content for storage and synchronization.

---

## Scope

This specification covers:
- GitHub API client interactions
- Commit-based change detection
- Markdown file parsing and metadata extraction
- Rate limit handling and retry logic

Out of scope:
- GitHub webhook integration
- Private repository support (requires token)
- Historical commit analysis beyond last sync

---

## Acceptance Criteria

### AC-1: Fetch Latest Commit SHA
**GIVEN** a valid GitHub repository (`owner/repo`) and branch
**WHEN** `getLatestCommit(owner, repo, branch)` is called
**THEN** it returns the latest commit SHA from GitHub API
**AND** handles 404 errors (repo/branch not found)
**AND** handles rate limit errors (403 with `X-RateLimit-Remaining: 0`)
**AND** retries on network errors up to 3 times with exponential backoff

**Example**:
```typescript
const sha = await client.getLatestCommit('kadragon', 'knue-policy-hub', 'main');
// → "a1b2c3d4e5f6..."
```

---

### AC-2: Compare Commits and Detect Changes
**GIVEN** a base commit SHA and head commit SHA
**WHEN** `getCommitDiff(owner, repo, baseCommit, headCommit)` is called
**THEN** it returns an array of changed files with status (`added`, `modified`, `removed`)
**AND** filters results to only include `.md` files
**AND** excludes `README.md` files
**AND** includes `previous_filename` for renamed files
**AND** handles identical commits (returns empty array)

**Example**:
```typescript
const changes = await client.getCommitDiff(
  'kadragon',
  'knue-policy-hub',
  'abc123...',
  'def456...'
);
// → [
//   { filename: 'policies/학칙.md', status: 'modified', sha: '...' },
//   { filename: 'policies/신규규정.md', status: 'added', sha: '...' },
//   { filename: 'policies/삭제된규정.md', status: 'removed' }
// ]
```

---

### AC-3: Fetch File Tree (Initial Sync)
**GIVEN** a valid commit SHA
**WHEN** `getFileTree(owner, repo, commitSHA, recursive = true)` is called
**THEN** it returns all file paths in the repository tree
**AND** filters results to only `.md` files
**AND** excludes `README.md` files
**AND** includes blob SHA for each file

**Example**:
```typescript
const tree = await client.getFileTree('kadragon', 'knue-policy-hub', 'abc123...', true);
// → [
//   { path: 'policies/학칙.md', sha: '...', type: 'blob' },
//   { path: 'docs/내규.md', sha: '...', type: 'blob' }
// ]
```

**Note**: Used only on first sync when no previous commit SHA exists.

---

### AC-4: Fetch File Content
**GIVEN** a blob SHA
**WHEN** `getFileContent(owner, repo, blobSHA)` is called
**THEN** it returns the decoded file content (UTF-8 string)
**AND** handles base64 decoding from GitHub API response
**AND** handles large files (>1MB) with appropriate error

**Example**:
```typescript
const content = await client.getFileContent('kadragon', 'knue-policy-hub', 'blob-sha-123');
// → "# 학칙\n\n## 제1장 총칙\n..."
```

---

### AC-5: Parse Markdown Metadata
**GIVEN** a markdown file content and path
**WHEN** `parseMarkdown(content, path)` is called
**THEN** it extracts:
  - `policyName` from filename (without `.md` extension)
  - `title` from first `# heading` line
  - Falls back to `policyName` if no heading found
**AND** preserves full markdown content
**AND** handles edge cases:
  - Empty files → warning, skip
  - Multiple `# headings` → use first occurrence
  - No `# heading` → fallback to policyName

**Example**:
```typescript
const doc = parseMarkdown(
  '# 학칙\n\n## 제1장\n...',
  'policies/학칙.md'
);
// → {
//   policyName: '학칙',
//   title: '학칙',
//   content: '# 학칙\n\n## 제1장\n...',
//   path: 'policies/학칙.md'
// }
```

**Edge Case Example**:
```typescript
const doc = parseMarkdown(
  '## No H1 Heading\nContent...',
  'policies/no-heading.md'
);
// → {
//   policyName: 'no-heading',
//   title: 'no-heading',  // Fallback to filename
//   content: '## No H1 Heading\nContent...',
//   path: 'policies/no-heading.md'
// }
```

---

### AC-6: Extract Policy Name from Path
**GIVEN** a file path
**WHEN** `extractPolicyName(path)` is called
**THEN** it returns the filename without extension
**AND** handles nested directories
**AND** handles Korean characters in filenames

**Examples**:
```typescript
extractPolicyName('학칙.md') // → '학칙'
extractPolicyName('policies/내규.md') // → '내규'
extractPolicyName('docs/rules/운영규정.md') // → '운영규정'
extractPolicyName('README.md') // → 'README' (but should be filtered earlier)
```

---

### AC-7: Detect Changes with Tracker
**GIVEN** a current commit SHA and optional previous commit SHA
**WHEN** `detectChanges(owner, repo, currentCommit, previousCommit?)` is called
**THEN** it returns a `ChangeSet`:
  - `added`: Array of new PolicyDocuments
  - `modified`: Array of changed PolicyDocuments
  - `deleted`: Array of policy names (string[])
**AND** on first run (no previous commit) → treats all files as `added`
**AND** on no changes (same commit) → returns empty ChangeSet
**AND** fetches content only for added/modified files

**Example**:
```typescript
const changeSet = await tracker.detectChanges(
  'kadragon',
  'knue-policy-hub',
  'new-commit-sha',
  'old-commit-sha'
);
// → {
//   added: [{ policyName: '신규규정', title: '신규규정', content: '...', sha: '...', path: '...' }],
//   modified: [{ policyName: '학칙', title: '학칙', content: '...', sha: '...', path: '...' }],
//   deleted: ['삭제된규정']
// }
```

---

## Error Handling

### Rate Limit (403 with rate limit headers)
```
Response: 403 Forbidden
Headers:
  X-RateLimit-Remaining: 0
  X-RateLimit-Reset: 1609459200

Action:
- Log warning: "GitHub API rate limit exceeded. Retry after {reset_time}"
- Throw RateLimitError
- Worker should retry on next cron run
```

### Not Found (404)
```
Response: 404 Not Found

Action:
- Log error: "GitHub repository or branch not found: {owner}/{repo}/{branch}"
- Throw NotFoundError
- Do not retry (configuration issue)
```

### Network Timeout
```
Action:
- Retry up to 3 times with exponential backoff (1s, 2s, 4s)
- Log each retry attempt
- Throw TimeoutError after all retries exhausted
```

### Large File (>1MB)
```
Response: Blob size > 1MB

Action:
- Log warning: "Skipping large file: {path} ({size} bytes)"
- Skip file, continue with others
- Do not fail entire sync
```

---

## Performance Requirements

- **Latency**: Each API call should complete within 5 seconds (with timeout)
- **Throughput**: Process up to 500 markdown files in <20 seconds total
- **Rate Limit**: Stay within 60 requests/hour (unauthenticated) or 5000/hour (authenticated)
- **Memory**: Keep memory usage <128MB (within Cloudflare Worker limits)

---

## Security Requirements

- **API Token**: If `GITHUB_TOKEN` is provided, include in Authorization header
- **URL Encoding**: Properly encode repository names and file paths
- **Input Validation**: Validate owner/repo/branch format before API calls
- **Secret Handling**: Never log GitHub tokens

---

## Testing Requirements

### Unit Tests
- GitHub API client with mocked fetch responses
- Markdown parser with fixture markdown samples
- Policy name extraction from various path formats
- Error handling for 404, 403, timeout scenarios

### Integration Tests
- Full change detection flow with mocked GitHub API
- First-run scenario (no previous commit)
- No-change scenario (same commit SHA)
- Multi-file change scenario (added + modified + deleted)
- Rename detection

---

## Examples

### First Sync (No Previous Commit)
```typescript
// No previous commit in KV
const previousCommit = null;
const currentCommit = await client.getLatestCommit('kadragon', 'knue-policy-hub', 'main');

// Fetch full tree
const tree = await client.getFileTree('kadragon', 'knue-policy-hub', currentCommit, true);

// All files are "added"
const changeSet = {
  added: await Promise.all(tree.map(async (entry) => {
    const content = await client.getFileContent('kadragon', 'knue-policy-hub', entry.sha);
    return parseMarkdown(content, entry.path);
  })),
  modified: [],
  deleted: []
};
```

### Incremental Sync (With Previous Commit)
```typescript
const previousCommit = 'abc123...';
const currentCommit = 'def456...';

// Fetch diff
const diff = await client.getCommitDiff('kadragon', 'knue-policy-hub', previousCommit, currentCommit);

// added: status === 'added'
// modified: status === 'modified'
// deleted: status === 'removed'
```

### No Changes
```typescript
const previousCommit = 'abc123...';
const currentCommit = 'abc123...'; // Same commit

// Short-circuit: no API calls needed
const changeSet = { added: [], modified: [], deleted: [] };
```

---

## References

- GitHub REST API v3: https://docs.github.com/en/rest
- Rate Limiting: https://docs.github.com/en/rest/overview/rate-limits-for-the-rest-api
- Git Data API: https://docs.github.com/en/rest/git
