# Specification - Policy Name Migration

**Spec ID**: `SPEC-POLICY-NAME-MIGRATION-001`
**Version**: 1.0.0
**Date**: 2025-10-20
**Status**: Active
**Related**: `SPEC-KV-SYNC-ALGO-001`, `SPEC-GITHUB-INTEGRATION-001`

---

## Purpose

Define the migration strategy from `fileNo`-centric data model to `policyName`-centric data model, ensuring backward compatibility during the transition period and providing clear guidelines for KV schema updates.

---

## Scope

This specification covers:
- Data model changes (KV, R2, types)
- Backward compatibility strategy
- Migration timeline and process
- Testing requirements for migration

Out of scope:
- Automatic migration of existing KV data (manual script provided if needed)
- Multi-version support beyond 90-day transition period

---

## Acceptance Criteria

### AC-1: New Data Model Structure
**GIVEN** the GitHub-based policy collection system
**WHEN** a policy is processed
**THEN** the following schema is used:

**PolicyDocument (GitHub source)**:
```typescript
interface PolicyDocument {
  policyName: string;    // REQUIRED: Filename without .md extension
  title: string;         // REQUIRED: First # heading (fallback to policyName)
  content: string;       // REQUIRED: Full markdown content
  sha: string;           // REQUIRED: Git blob SHA
  path: string;          // REQUIRED: Relative path in repo
  lastModified?: string; // OPTIONAL: ISO-8601 timestamp
}
```

**PolicyEntry (KV storage)**:
```typescript
interface PolicyEntry {
  policyName: string;    // REQUIRED: Primary key
  title: string;         // REQUIRED: Display name
  status: 'active';      // REQUIRED: Always 'active' for now
  lastUpdated: string;   // REQUIRED: ISO-8601 timestamp
  sha: string;           // REQUIRED: Git SHA for version tracking
  path: string;          // REQUIRED: File path in repo

  // Backward compatibility fields (deprecated, optional)
  fileNo?: string;       // OPTIONAL: Legacy fileNo from KNUE website
  previewUrl?: string;   // OPTIONAL: Legacy preview URL
  downloadUrl?: string;  // OPTIONAL: Legacy download URL
}
```

---

### AC-2: KV Key Format
**GIVEN** a policy with `policyName`
**WHEN** it is stored in KV
**THEN** the key format is `policy:{policyName}`
**AND** `policyName` is used as the primary identifier
**AND** old keys `policy:{title}` coexist during transition period

**Examples**:
```
New format:
  policy:학칙 → { policyName: "학칙", title: "학칙", sha: "...", ... }
  policy:내규 → { policyName: "내규", title: "내규", sha: "...", ... }

Old format (deprecated, but still readable):
  policy:학칙 → { title: "학칙", fileNo: "868", previewUrl: "...", ... }
```

**Collision Handling**:
- If both `policy:{policyName}` and old-style `policy:{title}` exist with same value
- New format takes precedence
- Old format will be overwritten on next sync

---

### AC-3: R2 Path Structure
**GIVEN** a policy with `policyName`
**WHEN** it is exported to R2
**THEN** the path is `policies/{policyName}/policy.md`
**AND** the front matter includes both `policyName` and legacy `fileNo` (if available)

**Example**:
```
Old format:
  policies/868/policy.md

New format:
  policies/학칙/policy.md

Front matter:
---
policyName: 학칙
title: 학칙
sha: abc123def456...
path: policies/학칙.md
savedAt: 2025-10-20T16:00:00.000Z
lastUpdated: 2025-10-20T16:00:00.000Z
fileNo: 868  # Optional, for backward compatibility
---
```

---

### AC-4: Synchronizer Comparison Logic
**GIVEN** current policies from GitHub and existing KV entries
**WHEN** `PolicySynchronizer.synchronize()` is called
**THEN** it compares policies by `policyName` (not `fileNo` or `title`)
**AND** detects:
  - **ADD**: `policyName` not in KV → create new entry
  - **UPDATE**: `policyName` exists but `sha` differs → update entry
  - **DELETE**: `policyName` in KV but not in current policies → remove entry

**Example**:
```typescript
// Current from GitHub
const currentPolicies = [
  { policyName: '학칙', sha: 'new-sha-123', ... },
  { policyName: '신규규정', sha: 'abc-456', ... }
];

// Existing in KV
const kvRegistry = new Map([
  ['학칙', { policyName: '학칙', sha: 'old-sha-789', ... }],
  ['삭제된규정', { policyName: '삭제된규정', sha: 'xyz-000', ... }]
]);

// Result:
// ADD: 신규규정 (not in KV)
// UPDATE: 학칙 (sha changed)
// DELETE: 삭제된규정 (not in current)
```

---

### AC-5: Backward Compatibility During Transition
**GIVEN** the transition period (90 days from deployment)
**WHEN** reading KV entries
**THEN** the system supports both old and new formats
**AND** migrates old entries on first write
**AND** logs migration actions for monitoring

**Migration Logic**:
```typescript
// Read old entry
const oldEntry = {
  title: "학칙",
  fileNo: "868",
  status: "active",
  lastUpdated: "2025-10-19T...",
  previewUrl: "https://...",
  downloadUrl: "https://..."
};

// Migrate to new format
const newEntry = {
  policyName: oldEntry.title, // Use title as policyName initially
  title: oldEntry.title,
  status: oldEntry.status,
  lastUpdated: new Date().toISOString(),
  sha: "", // Will be populated on next sync
  path: "", // Will be populated on next sync
  fileNo: oldEntry.fileNo, // Preserve for compatibility
  previewUrl: oldEntry.previewUrl, // Preserve for compatibility
  downloadUrl: oldEntry.downloadUrl // Preserve for compatibility
};
```

---

### AC-6: Queue Entry Updates
**GIVEN** policies are enqueued for processing
**WHEN** a queue entry is created
**THEN** it uses `policyName` as the identifier
**AND** includes both `policyName` and legacy `fileNo` (if available)

**Queue Entry Format**:
```typescript
interface QueueEntry {
  policyName: string;    // REQUIRED: Primary identifier
  sha: string;           // REQUIRED: Git SHA
  operation: 'add' | 'update'; // REQUIRED
  retryCount: number;    // REQUIRED
  createdAt: string;     // REQUIRED: ISO-8601
  errorMessage: string | null; // OPTIONAL

  // Backward compatibility
  fileNo?: string;       // OPTIONAL: Legacy fileNo
}
```

**KV Key Format**:
```
Old: queue:{title}
New: queue:{policyName}
```

---

### AC-7: Metadata Tracking for Commits
**GIVEN** a successful GitHub sync
**WHEN** metadata is saved
**THEN** it includes the commit SHA
**AND** stores it under `metadata:sync:lastCommit`

**Metadata Format**:
```typescript
interface SyncMetadata {
  timestamp: string;
  totalProcessed: number;
  added: number;
  updated: number;
  deleted: number;
  status: 'success' | 'failure';
  errorCount: number;

  // New fields for GitHub sync
  commitSHA: string;          // Current commit
  previousCommitSHA?: string; // Previous commit (if exists)
}
```

**KV Keys**:
```
metadata:sync:lastRun → SyncMetadata (existing)
metadata:sync:lastCommit → string (commit SHA) (new)
```

---

### AC-8: Handling Name Collisions
**GIVEN** two policies with the same `policyName` but different paths
**WHEN** synchronization runs
**THEN** it logs a warning and keeps the first occurrence
**AND** subsequent duplicates are skipped with warning

**Example**:
```typescript
// Scenario: Two files with same base name in different directories
const files = [
  'policies/학칙.md',      // First occurrence
  'old-policies/학칙.md'   // Duplicate policyName
];

// Action:
// - Process 'policies/학칙.md' → policyName: '학칙'
// - Skip 'old-policies/학칙.md' → Warning: "Duplicate policyName '학칙' detected"
```

**Mitigation**:
- Repository should maintain unique policy names across all directories
- If collision occurs, manual intervention required

---

## Migration Timeline

### Phase 1: Deployment (Day 0)
- Deploy new code with dual-model support
- New syncs use `policyName` as primary key
- Old KV entries remain readable
- No breaking changes

### Phase 2: Observation (Days 1-30)
- Monitor sync performance and correctness
- Validate policyName-based lookups
- Collect metrics on old vs new entry reads
- Identify any issues

### Phase 3: Transition (Days 31-60)
- Optionally run migration script to convert old entries
- Update documentation to reflect new model
- Deprecated fields still present but not actively used

### Phase 4: Cleanup (Days 61-90)
- Remove deprecated fields from code (`fileNo`, `previewUrl`, `downloadUrl`)
- Archive old spec documents
- Update tests to remove backward compatibility checks

### Phase 5: Complete (Day 91+)
- Full migration complete
- Only `policyName`-centric model supported
- Old entries no longer supported

---

## Migration Script (Optional)

If manual KV migration is needed:

```typescript
/**
 * Migrate old KV entries to new policyName-centric format
 * Run manually via wrangler dev or as a one-time worker
 */
async function migrateKVEntries(kv: KVNamespace) {
  const allKeys = await kv.list({ prefix: 'policy:' });
  let migrated = 0;
  let skipped = 0;

  for (const key of allKeys.keys) {
    const entry = await kv.get(key.name, 'json') as PolicyEntry;

    // Check if already migrated
    if (entry.policyName) {
      skipped++;
      continue;
    }

    // Migrate old entry
    const newEntry: PolicyEntry = {
      policyName: entry.title, // Use title as policyName
      title: entry.title,
      status: entry.status,
      lastUpdated: new Date().toISOString(),
      sha: '', // Will be populated on next sync
      path: '', // Will be populated on next sync
      fileNo: entry.fileNo, // Preserve
      previewUrl: entry.previewUrl, // Preserve
      downloadUrl: entry.downloadUrl // Preserve
    };

    await kv.put(key.name, JSON.stringify(newEntry));
    migrated++;
    console.log(`Migrated: ${key.name}`);
  }

  console.log(`Migration complete: ${migrated} migrated, ${skipped} skipped`);
}
```

---

## Testing Requirements

### Unit Tests
- Read old-format KV entries and handle gracefully
- Write new-format entries
- Synchronizer comparison logic with `policyName`
- Queue entry creation with new format
- Migration logic (if script provided)

### Integration Tests
- Full sync with new GitHub source
- Verify KV entries use `policyName` key
- Verify R2 paths use `policyName`
- Read old entries and migrate on write
- Handle duplicates gracefully

### Regression Tests
- Existing KV data remains accessible
- No data loss during migration
- Backward compatibility preserved for 90 days

---

## Rollback Strategy

If migration fails or issues arise:

1. **Code Rollback**:
   - Revert to previous commit
   - Old preview API-based system restored

2. **KV Rollback**:
   - Old entries remain untouched
   - No data loss

3. **R2 Rollback**:
   - Old `policies/{fileNo}/` paths preserved
   - New `policies/{policyName}/` paths can be deleted if needed

4. **Environment Rollback**:
   - Switch back to old environment variables via dashboard

---

## References

- `.tasks/RESEARCH.md` - Migration rationale
- `.tasks/SPEC-DELTA.md` - Acceptance criteria changes
- `src/kv/types.ts` - Type definitions
