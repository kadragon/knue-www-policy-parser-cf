---
id: SPEC-KV-SYNC-ALGO-001
version: 2.0.0
scope: global
status: active
supersedes: [SPEC-KV-SYNC-ALGO-001 v1.1.0]
depends: [SPEC-GITHUB-INTEGRATION-001, SPEC-POLICY-NAME-MIGRATION-001]
last-updated: 2025-10-20
owner: project-admin
---
# KV Synchronization Algorithm Specification

## Overview

This document defines the schema, data structures, and synchronization algorithm for managing policy regulations using Cloudflare KV as a centralized registry.

**Key Principle (v2.0.0):** `policyName` (markdown filename) is the canonical identifier; `fileNo` is deprecated. Git `sha` is used for version tracking.

**Breaking Change from v1.x:** Primary key changed from `title` to `policyName`. See `SPEC-POLICY-NAME-MIGRATION-001` for migration strategy.

---

## 1. KV Schema

### Namespace
- **Name:** `policy-registry`
- **Binding:** `POLICY_REGISTRY`
- **Purpose:** Centralized source of truth for all regulations

### Data Structures

#### 1.1 Policy Entry (v2.0.0)
**Key:** `policy:${policyName}`
**Value:** JSON object

```json
{
  "policyName": "학칙",
  "title": "한국교원대학교 학칙",
  "status": "active",
  "lastUpdated": "2025-10-20T16:00:00Z",
  "sha": "abc123def456789...",
  "path": "policies/학칙.md",

  // Deprecated fields (optional, for backward compatibility)
  "fileNo": "868",
  "previewUrl": "https://www.knue.ac.kr/www/previewMenuCntFile.do?key=392&fileNo=868",
  "downloadUrl": "https://www.knue.ac.kr/downloadContentsFile.do?key=392&fileNo=868"
}
```

**Required Fields:**
- `policyName`: Markdown filename without `.md` extension (PRIMARY KEY)
- `title`: Human-readable title extracted from markdown `# heading`
- `status`: Always `'active'` (future: `'archived'`)
- `lastUpdated`: ISO 8601 timestamp
- `sha`: Git blob SHA for version tracking
- `path`: Relative path in GitHub repository

**Deprecated Fields (optional):**
- `fileNo`: Legacy numeric ID from KNUE website (optional, for 90-day transition)
- `previewUrl`: Legacy preview URL (optional)
- `downloadUrl`: Legacy download URL (optional)

#### 1.2 Sync Metadata
**Key:** `metadata:sync:lastRun`
**Value:** JSON object

```json
{
  "timestamp": "2025-10-20T16:00:00Z",
  "totalProcessed": 45,
  "added": 2,
  "updated": 3,
  "deleted": 1,
  "status": "success",
  "errorCount": 0,
  "commitSHA": "def456abc789...",
  "previousCommitSHA": "abc123def456..."
}
```

**New in v2.0.0:**
- `commitSHA`: Current Git commit SHA
- `previousCommitSHA`: Previous commit SHA (for comparison)

#### 1.3 Last Commit SHA (NEW in v2.0.0)
**Key:** `metadata:sync:lastCommit`
**Value:** String (commit SHA)

```
"abc123def456789..."
```

**Purpose:** Track the last processed GitHub commit for incremental diff detection.

#### 1.4 Processing Queue (Optional)
**Key:** `queue:${policyName}`
**Value:** JSON object (for retry logic)

```json
{
  "policyName": "학칙",
  "sha": "abc123def456...",
  "operation": "add|update",
  "retryCount": 0,
  "createdAt": "2025-10-20T16:00:00Z",
  "errorMessage": null,

  // Deprecated (optional)
  "fileNo": "868"
}
```

**Changed in v2.0.0:**
- Key format: `queue:${title}` → `queue:${policyName}`
- Primary identifier: `title` → `policyName`
- Add `sha` field for version tracking

---

## 2. Synchronization Algorithm (v2.0.0)

### Input Data
1. **currentPolicies**: Array of policies fetched from GitHub repository
   ```typescript
   {
     policyName: string;  // Filename without .md
     title: string;       // First # heading
     sha: string;         // Git blob SHA
     path: string;        // Relative path in repo
     content: string;     // Full markdown content
   }[]
   ```

2. **kvRegistry**: Existing policies in KV
   ```typescript
   Map<string, PolicyEntry>  // Map<policyName, PolicyEntry>
   ```

**Changed from v1.x:**
- Source: Preview API → GitHub repository
- Key field: `title` → `policyName`
- Version tracking: `fileNo` → `sha`

### Output Data
```typescript
interface SyncResult {
  toAdd: PolicyEntry[];      // New policies
  toUpdate: PolicyEntry[];   // Policies with changed sha
  toDelete: string[];        // Policy names to remove from KV
  stats: {
    totalScanned: number;
    added: number;
    updated: number;
    deleted: number;
  };
}
```

### Algorithm Steps

#### Phase 1: Load Current State
1. Fetch changed markdown files from GitHub → `currentPolicies` (keyed by `policyName`)
   - On first run: Fetch all .md files from repository tree
   - On subsequent runs: Fetch diff between last commit and current commit
2. Read all entries from KV `policy:*` → `kvRegistry` (keyed by `policyName`)
3. Initialize result containers: `toAdd`, `toUpdate`, `toDelete`

#### Phase 2: Detect Changes
For each **policyName** in `currentPolicies`:
- **If policyName NOT in kvRegistry:**
  - Action: ADD
  - Push to `toAdd` with `status: 'active'`, `lastUpdated: now`, `sha`, `path`

- **If policyName IN kvRegistry AND sha is different:**
  - Action: UPDATE
  - Push to `toUpdate` with new `sha`, `title`, `lastUpdated: now`

- **If policyName IN kvRegistry AND sha is identical:**
  - Action: NO-OP
  - Skip (no change needed)

**Changed from v1.x:**
- Comparison key: `title` → `policyName`
- Change detection: Compare `fileNo` → Compare `sha`

#### Phase 3: Detect Deletions
For each **policyName** in `kvRegistry`:
- **If policyName NOT in currentPolicies:**
  - Action: DELETE
  - Push `policyName` to `toDelete`

**Changed from v1.x:**
- Deletion key: `title` → `policyName`

#### Phase 4: Persist Changes
1. **For each entry in `toAdd`:**
   - Write to KV: `policy:${policyName}` = PolicyEntry
   - Enqueue for processing: Push to `queue:${policyName}` with `operation: 'add'`

2. **For each entry in `toUpdate`:**
   - Update KV: `policy:${policyName}` = PolicyEntry (with new `sha`)
   - Enqueue for processing: Push to `queue:${policyName}` with `operation: 'update'`

3. **For each policyName in `toDelete`:**
   - Delete from KV: Remove `policy:${policyName}`
   - Delete from queue: Remove `queue:${policyName}` if exists

4. **Write metadata:**
   - Update `metadata:sync:lastRun` with timestamp, counts, status, commit SHAs
   - Update `metadata:sync:lastCommit` with current commit SHA

**Changed from v1.x:**
- Key format: Use `policyName` instead of `title`
- Add commit SHA tracking

---

## 3. Error Handling

### Retry Logic
- If KV write fails: Increment `retryCount` in queue entry
- If `retryCount >= 3`: Move to `dead-letter:${policyName}` for manual review
- Log all errors to CloudFlare Logs

### Validation
- Ensure `policyName` is not empty
- Ensure `sha` is valid Git SHA format (40 hex characters)
- Ensure `path` is valid relative path
- Ensure `title` is not empty

**Changed from v1.x:**
- Remove `fileNo` digit validation (deprecated field)
- Add `sha` format validation

---

## 4. Cron Trigger Configuration

### Timing
- **Schedule:** Every day at 01:00 KST (16:00 UTC)
- **Cron Expression:** `0 16 * * *`
- **Rationale:** KST = UTC + 9, so 1 AM KST = 16:00 UTC previous day

**Unchanged from v1.x**

---

## 5. Example Scenarios

### Scenario 1: New Policy Added
```
Current GitHub: [{ policyName: "신규규정", sha: "abc123...", title: "신규 규정", ... }]
KV State:       (empty for this policyName)

Result: ADD
Action: Create policy:신규규정, enqueue for processing
```

### Scenario 2: Policy Revised (Content Changed)
```
Current GitHub: [{ policyName: "학칙", sha: "def456...", title: "한국교원대학교 학칙", ... }]
KV State:       { policyName: "학칙", sha: "abc123...", title: "한국교원대학교 학칙", ... }

Result: UPDATE
Action: Update policy:학칙 with new sha (def456...), enqueue for processing
```

### Scenario 3: Policy Removed from Repository
```
Current GitHub: (does not include "폐기된규정")
KV State:       { policyName: "폐기된규정", sha: "xyz789...", ... }

Result: DELETE
Action: Remove policy:폐기된규정 from KV
```

### Scenario 4: Policy Renamed in Repository
```
GitHub: File renamed from "old-name.md" to "new-name.md"

Result:
- DELETE: "old-name" (not in current policies)
- ADD: "new-name" (new policyName)

Note: This is treated as delete + add, not an atomic rename.
Content will be preserved but considered a new policy.
```

---

## 6. TypeScript Interfaces (v2.0.0)

```typescript
// KV Entry
interface PolicyEntry {
  policyName: string;     // REQUIRED: Primary key (filename without .md)
  title: string;          // REQUIRED: Display title
  status: 'active' | 'archived'; // REQUIRED
  lastUpdated: string;    // REQUIRED: ISO 8601
  sha: string;            // REQUIRED: Git blob SHA
  path: string;           // REQUIRED: Relative path in repo

  // Deprecated fields (optional, for backward compatibility)
  fileNo?: string;
  previewUrl?: string;
  downloadUrl?: string;
}

// Sync Metadata
interface SyncMetadata {
  timestamp: string;
  totalProcessed: number;
  added: number;
  updated: number;
  deleted: number;
  status: 'success' | 'partial' | 'failed';
  errorCount: number;

  // New in v2.0.0
  commitSHA?: string;          // Current commit
  previousCommitSHA?: string;  // Previous commit
}

// Queue Entry
interface QueueEntry {
  policyName: string;     // REQUIRED: Primary identifier
  sha: string;            // REQUIRED: Git SHA
  operation: 'add' | 'update'; // REQUIRED
  retryCount: number;     // REQUIRED
  createdAt: string;      // REQUIRED: ISO 8601
  errorMessage: string | null; // OPTIONAL

  // Deprecated (optional)
  fileNo?: string;
}

// Sync Result
interface SyncResult {
  toAdd: PolicyEntry[];
  toUpdate: PolicyEntry[];
  toDelete: string[];      // Policy names
  stats: {
    totalScanned: number;
    added: number;
    updated: number;
    deleted: number;
  };
}
```

---

## 7. Implementation Notes

- All timestamps use ISO 8601 format with timezone
- KV operations are atomic; no transactions needed for simple read-write
- Batch KV operations in chunks of ≤50 items and execute each batch concurrently via `Promise.allSettled`
- On partial failures, log each affected `policyName` (or queue key) and throw an aggregated error describing the batch
- Metadata should be written last to ensure atomicity of sync
- Commit SHA tracking enables incremental diff detection (only process changed files)
- On first run (no previous commit), all files are treated as "added"

---

## 8. Migration from v1.x

### Backward Compatibility
- v2.0.0 can read both old (`title`-based) and new (`policyName`-based) entries
- Old entries are migrated on first write
- Deprecated fields (`fileNo`, `previewUrl`, `downloadUrl`) are preserved for 90 days

### Migration Steps
1. Deploy v2.0.0 code
2. First sync populates `policyName`, `sha`, `path` fields
3. Old entries coexist with new entries during transition
4. After 90 days, deprecated fields can be removed

See `SPEC-POLICY-NAME-MIGRATION-001` for full migration strategy.

---

## 9. References

- `SPEC-GITHUB-INTEGRATION-001`: GitHub API client behavior
- `SPEC-POLICY-NAME-MIGRATION-001`: Data model migration strategy
- `src/kv/types.ts`: TypeScript type definitions
- `src/kv/synchronizer.ts`: Implementation of this algorithm
