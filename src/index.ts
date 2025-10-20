import { GitHubClient, type GitHubClientOptions } from './github/client';
import { extractPolicyName, extractTitle } from './github/markdown';
import { ChangeTracker } from './github/tracker';
import { writePoliciestoR2ByPolicyNameV2 } from './storage/r2-writer';
import { KVManager } from './kv/manager';
import { PolicySynchronizer } from './kv/synchronizer';
import type { ApiPolicy, SyncMetadata } from './kv/types';

interface Env {
  POLICY_STORAGE: R2Bucket;
  POLICY_REGISTRY: KVNamespace;
  GITHUB_REPO: string;        // e.g., "kadragon/knue-policy-hub"
  GITHUB_BRANCH: string;      // e.g., "main"
  GITHUB_TOKEN?: string;      // Optional: for authenticated requests
}

export default {
  async fetch(
    _request: Request,
    _env: Env,
    _ctx: ExecutionContext
  ): Promise<Response> {
    return new Response(
      JSON.stringify({
        error: 'Method Not Allowed',
        message: 'This worker only accepts requests from cron triggers. Direct HTTP requests are not supported.'
      }),
      {
        status: 405,
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );
  },

  async scheduled(
    _controller: ScheduledController,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<void> {
    const startTime = Date.now();
    const now = new Date();

    try {
      console.log(`[${now.toISOString()}] Starting GitHub-based policy sync...`);

      // ==================== Phase 1: GitHub Sync ====================
      console.log(`🔄 Initializing GitHub client for ${env.GITHUB_REPO}...`);
      const githubClientOptions: GitHubClientOptions = { token: env.GITHUB_TOKEN };
      const githubClient = new GitHubClient(githubClientOptions);
      const changeTracker = new ChangeTracker(githubClient);
      const [owner, repo] = env.GITHUB_REPO.split('/');

      // Get latest commit SHA
      const latestCommit = await githubClient.getLatestCommit(owner, repo, env.GITHUB_BRANCH);
      console.log(`✓ Latest commit: ${latestCommit.substring(0, 7)}`);

      // Get KV manager and load last synced commit
      const kvManager = new KVManager(env.POLICY_REGISTRY);
      const syncMetadata = await kvManager.getSyncMetadata();
      const previousCommitSHA = syncMetadata?.commitSHA;

      console.log(`✓ Previous commit: ${previousCommitSHA ? previousCommitSHA.substring(0, 7) : 'None (first run)'}`);

      // Detect changes
      let changeSet = null;
      if (previousCommitSHA && previousCommitSHA !== latestCommit) {
        console.log(`🔄 Detecting changes between commits...`);
        changeSet = await changeTracker.detectChanges(owner, repo, latestCommit, previousCommitSHA);
        console.log(`✓ Detected changes: ${changeSet.added.length} added, ${changeSet.modified.length} modified, ${changeSet.deleted.length} deleted`);
      } else if (!previousCommitSHA) {
        console.log(`📝 First run: will fetch all policy files...`);
        changeSet = await changeTracker.detectChanges(owner, repo, latestCommit);
        console.log(`✓ Found ${changeSet.added.length + changeSet.modified.length} policies`);
      } else {
        console.log(`⏭️  No changes detected (same commit)`);
        changeSet = { added: [], modified: [], deleted: [] };
      }

      // Convert file changes to ApiPolicy objects
      console.log(`\n🔄 Converting changes to ApiPolicy format...`);
      const allChangedFiles = [...changeSet.added, ...changeSet.modified];
      const apiPolicies: ApiPolicy[] = [];

      for (const file of allChangedFiles) {
        try {
          const policyName = extractPolicyName(file.path);
          const content = await githubClient.getFileContent(owner, repo, file.sha);
          const title = extractTitle(content) || policyName;

          apiPolicies.push({
            policyName,
            title,
            sha: file.sha,
            path: file.path,
            content
          });
        } catch (error) {
          console.warn(`⚠️  Failed to process ${file.path}:`, error instanceof Error ? error.message : String(error));
        }
      }

      console.log(`✓ Converted ${apiPolicies.length} files to ApiPolicy format`);

      // ==================== Phase 2: KV Synchronization ====================
      console.log(`\n🔄 Starting KV synchronization...`);
      const synchronizer = new PolicySynchronizer(kvManager);

      // Validate policies
      const validPolicies = synchronizer.validateAndFilterPolicies(apiPolicies);
      console.log(`✓ Validated ${validPolicies.length}/${apiPolicies.length} policies`);

      // Run synchronization
      const syncResult = await synchronizer.synchronize(validPolicies);

      // Track deleted policies
      const deletedCount = changeSet.deleted.length;

      // Record sync metadata with commit tracking
      const newSyncMetadata: SyncMetadata = {
        timestamp: now.toISOString(),
        totalProcessed: syncResult.stats.totalScanned,
        added: syncResult.stats.added,
        updated: syncResult.stats.updated,
        deleted: syncResult.stats.deleted + deletedCount,
        status: 'success',
        errorCount: 0,
        commitSHA: latestCommit,
        previousCommitSHA
      };
      await kvManager.setSyncMetadata(newSyncMetadata);
      console.log(`✓ Sync metadata recorded`);

      // ==================== Phase 3: Save to R2 ====================
      console.log(`\n🔄 Saving policies to R2...`);

      const r2Result = await writePoliciestoR2ByPolicyNameV2(
        env.POLICY_STORAGE,
        validPolicies,
        now
      );

      console.log(`✓ R2 save result: saved ${r2Result.savedPolicies?.length || 0} policies`);

      // ==================== Summary ====================
      const duration = Date.now() - startTime;

      console.log(`\n${'='.repeat(60)}`);
      console.log(`✅ Policy sync completed in ${duration}ms`);
      console.log(`📊 Sync Results:`);
      console.log(`   • Total processed: ${syncResult.stats.totalScanned}`);
      console.log(`   • Added: ${syncResult.stats.added}`);
      console.log(`   • Updated: ${syncResult.stats.updated}`);
      console.log(`   • Deleted: ${syncResult.stats.deleted + deletedCount}`);
      console.log(`📦 R2: Saved ${r2Result.savedPolicies?.length || 0} policies`);
      console.log(`🔗 Commit: ${latestCommit.substring(0, 7)}`);
      console.log(`${'='.repeat(60)}`);
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`\n❌ Policy sync job failed after ${duration}ms:`, error);

      if (error instanceof Error) {
        console.error('Error details:', {
          message: error.message,
          stack: error.stack
        });
      }

      throw error;
    }
  }
};
