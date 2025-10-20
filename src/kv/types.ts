/**
 * KV Registry Data Types (v2.0.0)
 *
 * Defines the structure of data stored in Cloudflare KV for policy synchronization.
 *
 * Breaking changes from v1.x:
 * - Primary key: title → policyName
 * - Version tracking: fileNo → sha
 * - Source: Preview API → GitHub repository
 */

/**
 * Policy Entry - represents a single regulation in the registry
 *
 * v2.0.0: policyName is now the primary identifier
 */
export interface PolicyEntry {
  // v2.0.0: New required fields
  policyName: string;    // Primary key: filename without .md extension
  title: string;         // Display title from markdown # heading
  status: 'active' | 'archived';
  lastUpdated: string;   // ISO 8601 format
  sha: string;           // Git blob SHA for version tracking
  path: string;          // Relative path in GitHub repository

  // v1.x: Deprecated fields (optional for backward compatibility)
  fileNo?: string;       // Legacy numeric ID from KNUE website
  previewUrl?: string;   // Legacy preview URL
  downloadUrl?: string;  // Legacy download URL
}

/**
 * Sync Metadata - tracks synchronization execution
 *
 * v2.0.0: Added commit SHA tracking
 */
export interface SyncMetadata {
  timestamp: string;     // ISO 8601 format
  totalProcessed: number;
  added: number;
  updated: number;
  deleted: number;
  status: 'success' | 'partial' | 'failed';
  errorCount: number;

  // v2.0.0: New fields for GitHub sync
  commitSHA?: string;         // Current commit SHA
  previousCommitSHA?: string; // Previous commit SHA
}

/**
 * Queue Entry - tracks policies pending processing
 *
 * v2.0.0: policyName is now the primary identifier
 */
export interface QueueEntry {
  policyName: string;    // Primary identifier (was: title)
  sha: string;           // Git blob SHA
  operation: 'add' | 'update';
  retryCount: number;
  createdAt: string;     // ISO 8601 format
  errorMessage: string | null;

  // v1.x: Deprecated (optional)
  fileNo?: string;       // Legacy numeric ID
}

/**
 * Sync Result - output of synchronization algorithm
 *
 * v2.0.0: toDelete now contains policy names (not titles)
 */
export interface SyncResult {
  toAdd: PolicyEntry[];
  toUpdate: PolicyEntry[];
  toDelete: string[];    // Policy names to delete (was: titles)
  stats: {
    totalScanned: number;
    added: number;
    updated: number;
    deleted: number;
  };
}

/**
 * API Policy Response - structure from GitHub source
 *
 * v2.0.0: Replaces preview API structure with GitHub-sourced data
 */
export interface ApiPolicy {
  policyName: string;    // Filename without .md extension
  title: string;         // First # heading from markdown
  sha: string;           // Git blob SHA
  path: string;          // Relative path in repository
  content: string;       // Full markdown content

  // v1.x: Optional backward compatibility
  fileNo?: string;       // If available from migration
  previewUrl?: string;   // If available from migration
  downloadUrl?: string;  // If available from migration
}
