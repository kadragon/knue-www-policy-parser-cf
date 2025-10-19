/**
 * KV Registry Data Types
 *
 * Defines the structure of data stored in Cloudflare KV for policy synchronization.
 */

/**
 * Policy Entry - represents a single regulation in the registry
 */
export interface PolicyEntry {
  title: string;
  fileNo: string;
  status: 'active' | 'archived';
  lastUpdated: string; // ISO 8601 format
  previewUrl: string;
  downloadUrl: string;
}

/**
 * Sync Metadata - tracks synchronization execution
 */
export interface SyncMetadata {
  timestamp: string; // ISO 8601 format
  totalProcessed: number;
  added: number;
  updated: number;
  deleted: number;
  status: 'success' | 'partial' | 'failed';
  errorCount: number;
}

/**
 * Queue Entry - tracks policies pending processing
 */
export interface QueueEntry {
  title: string;
  fileNo: string;
  operation: 'add' | 'update';
  retryCount: number;
  createdAt: string; // ISO 8601 format
  errorMessage: string | null;
}

/**
 * Sync Result - output of synchronization algorithm
 */
export interface SyncResult {
  toAdd: PolicyEntry[];
  toUpdate: PolicyEntry[];
  toDelete: string[]; // titles to delete
  stats: {
    totalScanned: number;
    added: number;
    updated: number;
    deleted: number;
  };
}

/**
 * API Policy Response - structure from previewUrls API
 */
export interface ApiPolicy {
  title: string;
  fileNo: string;
  previewUrl: string;
  downloadUrl: string;
}
