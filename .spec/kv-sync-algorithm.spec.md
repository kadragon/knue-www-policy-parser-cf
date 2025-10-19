---
id: SPEC-KV-SYNC-ALGO-001
version: 1.1.0
scope: global
status: active
supersedes: []
depends: []
last-updated: 2025-10-19
owner: project-admin
---
# KV Synchronization Algorithm Specification

## Overview

This document defines the schema, data structures, and synchronization algorithm for managing policy regulations using Cloudflare KV as a centralized registry.

**Key Principle:** `title` (regulation name) is the canonical identifier; `fileNo` is the volatile document identifier that may change when regulations are revised.

---

## 1. KV Schema

### Namespace
- **Name:** `policy-registry`
- **Binding:** `POLICY_REGISTRY`
- **Purpose:** Centralized source of truth for all regulations

### Data Structures

#### 1.1 Policy Entry
**Key:** `policy:${title}`
**Value:** JSON object

```json
{
  "title": "한국교원대학교 학칙",
  "fileNo": "868",
  "status": "active",
  "lastUpdated": "2025-10-19T12:00:00Z",
  "previewUrl": "https://www.knue.ac.kr/www/previewMenuCntFile.do?key=392&fileNo=868",
  "downloadUrl": "https://www.knue.ac.kr/downloadContentsFile.do?key=392&fileNo=868"
}
```

#### 1.2 Sync Metadata
**Key:** `metadata:sync:lastRun`
**Value:** JSON object

```json
{
  "timestamp": "2025-10-19T16:00:00Z",
  "totalProcessed": 45,
  "added": 2,
  "updated": 3,
  "deleted": 1,
  "status": "success",
  "errorCount": 0
}
```

#### 1.3 Processing Queue (Optional)
**Key:** `queue:${title}`
**Value:** JSON object (for retry logic)

```json
{
  "title": "한국교원대학교 학칙",
  "fileNo": "868",
  "operation": "add|update",
  "retryCount": 0,
  "createdAt": "2025-10-19T16:00:00Z",
  "errorMessage": null
}
```

---

## 2. Synchronization Algorithm

### Input Data
1. **currentPolicies**: Array of policies fetched from previewUrls
   ```typescript
   {
     title: string;
     fileNo: string;
     previewUrl: string;
     downloadUrl: string;
   }[]
   ```

2. **kvRegistry**: Existing policies in KV
   ```typescript
   Map<string, PolicyEntry>  // Map<title, PolicyEntry>
   ```

### Output Data
```typescript
interface SyncResult {
  toAdd: PolicyEntry[];      // New regulations
  toUpdate: PolicyEntry[];   // Regulations with changed fileNo
  toDelete: string[];        // Titles to remove from KV
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
1. Fetch all policies from previewUrls API → `currentPolicies` (keyed by title)
2. Read all entries from KV `policy:*` → `kvRegistry` (keyed by title)
3. Initialize result containers: `toAdd`, `toUpdate`, `toDelete`

#### Phase 2: Detect Changes
For each **title** in `currentPolicies`:
- **If title NOT in kvRegistry:**
  - Action: ADD
  - Push to `toAdd` with `status: 'active'`, `lastUpdated: now`

- **If title IN kvRegistry AND fileNo is different:**
  - Action: UPDATE
  - Push to `toUpdate` with new fileNo, `lastUpdated: now`

- **If title IN kvRegistry AND fileNo is identical:**
  - Action: NO-OP
  - Skip (no change needed)

#### Phase 3: Detect Deletions
For each **title** in `kvRegistry`:
- **If title NOT in currentPolicies:**
  - Action: DELETE
  - Push title to `toDelete`

#### Phase 4: Persist Changes
1. **For each entry in `toAdd`:**
   - Write to KV: `policy:${title}` = PolicyEntry
   - Enqueue for parsing: Push to `queue:${title}` with `operation: 'add'`

2. **For each entry in `toUpdate`:**
   - Update KV: `policy:${title}` = PolicyEntry (with new fileNo)
   - Enqueue for parsing: Push to `queue:${title}` with `operation: 'update'`

3. **For each title in `toDelete`:**
   - Delete from KV: Remove `policy:${title}`
   - Delete from queue: Remove `queue:${title}` if exists

4. **Write metadata:**
   - Update `metadata:sync:lastRun` with timestamp, counts, status

---

## 3. Error Handling

### Retry Logic
- If KV write fails: Increment `retryCount` in queue entry
- If `retryCount >= 3`: Move to `dead-letter:${title}` for manual review
- Log all errors to CloudFlare Logs

### Validation
- Ensure `title` is not empty
- Ensure `fileNo` contains only digits
- Ensure URLs are valid and reachable (optional)

---

## 4. Cron Trigger Configuration

### Timing
- **Schedule:** Every day at 01:00 KST (16:00 UTC)
- **Cron Expression:** `0 16 * * *`
- **Rationale:** KST = UTC + 9, so 1 AM KST = 16:00 UTC previous day (or 16:00 UTC current day depending on timezone interpretation)

**Note:** Verify with user—if 01:00 KST means morning (01:00 local time), then:
- 01:00 KST = 16:00 UTC (previous day)
- Or expressed as: 1 AM = 16:00 UTC

Use Cron expression: `0 16 * * *`

---

## 5. Example Scenarios

### Scenario 1: New Regulation Added
```
Current API: [{ title: "신규 규정", fileNo: "999", ... }]
KV State:     (empty for this title)

Result: ADD
Action: Create policy:신규 규정, enqueue for parsing
```

### Scenario 2: Regulation Revised (fileNo Changed)
```
Current API: [{ title: "한국교원대학교 학칙", fileNo: "870", ... }]
KV State:    { title: "한국교원대학교 학칙", fileNo: "868", ... }

Result: UPDATE
Action: Update policy:한국교원대학교 학칙 with new fileNo (870), enqueue for parsing
```

### Scenario 3: Regulation Removed from API
```
Current API: (does not include "폐기된 규정")
KV State:    { title: "폐기된 규정", fileNo: "500", ... }

Result: DELETE
Action: Remove policy:폐기된 규정 from KV
```

---

## 6. TypeScript Interfaces

```typescript
// KV Entry
interface PolicyEntry {
  title: string;
  fileNo: string;
  status: 'active' | 'archived';
  lastUpdated: string;  // ISO 8601
  previewUrl: string;
  downloadUrl: string;
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
}

// Queue Entry
interface QueueEntry {
  title: string;
  fileNo: string;
  operation: 'add' | 'update';
  retryCount: number;
  createdAt: string;
  errorMessage: string | null;
}

// Sync Result
interface SyncResult {
  toAdd: PolicyEntry[];
  toUpdate: PolicyEntry[];
  toDelete: string[];
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
- Consider batching KV operations to avoid rate limits
- Metadata should be written last to ensure atomicity of sync
