import { GitHubClient, type GitHubClientOptions } from './github/client';
import { ChangeTracker } from './github/tracker';
import {
  writePoliciestoR2ByPolicyNameV2,
  deletePoliciesFromR2,
  type WriteResultV2,
  type DeleteResultV2
} from './storage/r2-writer';
import { KVManager } from './kv/manager';
import { PolicySynchronizer } from './kv/synchronizer';
import type { ApiPolicy, SyncMetadata } from './kv/types';
import type { ChangeSet } from './github/types';

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
      if (previousCommitSHA && previousCommitSHA === latestCommit) {
        console.log(`⏭️  No changes detected (commit ${latestCommit.substring(0, 7)}). Skipping synchronization.`);
        return;
      }

      let changeSet: ChangeSet;
      if (previousCommitSHA) {
        console.log(`🔄 Detecting changes between commits...`);
        changeSet = await changeTracker.detectChanges(owner, repo, latestCommit, previousCommitSHA);
        console.log(
          `✓ Detected changes: ${changeSet.added.length} added, ${changeSet.modified.length} modified, ${changeSet.deleted.length} deleted`
        );
      } else {
        console.log(`📝 First run: will fetch all policy files...`);
        changeSet = await changeTracker.detectChanges(owner, repo, latestCommit);
        console.log(`✓ Found ${changeSet.added.length + changeSet.modified.length} policies`);
      }

      console.log(`\n🔄 Loading current policy set from GitHub...`);
      const prefetchedPolicies = [...changeSet.added, ...changeSet.modified];
      const allPolicies = await changeTracker.getAllPolicies(owner, repo, latestCommit, prefetchedPolicies);
      const apiPolicies: ApiPolicy[] = allPolicies.map(policy => ({
        policyName: policy.policyName,
        title: policy.title,
        sha: policy.sha,
        path: policy.path,
        content: policy.content
      }));
      console.log(`✓ Loaded ${apiPolicies.length} policies from commit ${latestCommit.substring(0, 7)}`);

      const changedPolicyNames = new Set(prefetchedPolicies.map(policy => policy.policyName));

      // ==================== Phase 2: KV Synchronization ====================
      console.log(`\n🔄 Starting KV synchronization...`);
      const synchronizer = new PolicySynchronizer(kvManager);

      // Validate policies
      const validPolicies = synchronizer.validateAndFilterPolicies(apiPolicies);
      console.log(`✓ Validated ${validPolicies.length}/${apiPolicies.length} policies`);

      const validPoliciesMap = new Map(validPolicies.map(policy => [policy.policyName, policy]));
      const r2Policies =
        changedPolicyNames.size > 0
          ? Array.from(changedPolicyNames, policyName => validPoliciesMap.get(policyName)).filter(
              (policy): policy is ApiPolicy => Boolean(policy)
            )
          : [];
      console.log(`✓ Prepared ${r2Policies.length} changed policies for R2 export`);

      // Run synchronization
      const syncResult = await synchronizer.synchronize(validPolicies);

      const deletedPolicyNames = syncResult.toDelete;

      // Record sync metadata with commit tracking
      const newSyncMetadata: SyncMetadata = {
        timestamp: now.toISOString(),
        totalProcessed: syncResult.stats.totalScanned,
        added: syncResult.stats.added,
        updated: syncResult.stats.updated,
        deleted: syncResult.stats.deleted,
        status: 'success',
        errorCount: 0,
        commitSHA: latestCommit,
        previousCommitSHA
      };
      await kvManager.setSyncMetadata(newSyncMetadata);
      console.log(`✓ Sync metadata recorded`);

      // ==================== Phase 3: Save to R2 ====================
      let r2Result: WriteResultV2;
      if (r2Policies.length > 0) {
        console.log(`\n🔄 Saving ${r2Policies.length} changed policies to R2...`);
        r2Result = await writePoliciestoR2ByPolicyNameV2(env.POLICY_STORAGE, r2Policies, now);
      } else {
        console.log(`\n⏭️  No policy content changes to export to R2`);
        r2Result = { saved: false, skipped: true };
      }

      const savedCount = r2Result.savedPolicies?.length ?? 0;
      console.log(`✓ R2 save result: saved ${savedCount} policies`);

      let r2DeleteResult: DeleteResultV2 | null = null;
      if (deletedPolicyNames.length > 0) {
        console.log(`\n🗑️  Removing ${deletedPolicyNames.length} policies from R2...`);
        r2DeleteResult = await deletePoliciesFromR2(env.POLICY_STORAGE, deletedPolicyNames);
      } else {
        console.log(`\n⏭️  No policy deletions to process in R2`);
      }

      // ==================== Summary ====================
      const duration = Date.now() - startTime;

      console.log(`\n${'='.repeat(60)}`);
      console.log(`✅ Policy sync completed in ${duration}ms`);
      console.log(`📊 Sync Results:`);
      console.log(`   • Total processed: ${syncResult.stats.totalScanned}`);
      console.log(`   • Added: ${syncResult.stats.added}`);
      console.log(`   • Updated: ${syncResult.stats.updated}`);
      console.log(`   • Deleted: ${syncResult.stats.deleted}`);
      console.log(`📦 R2: Saved ${savedCount} policies`);
      if (r2DeleteResult) {
        console.log(
          `🗑️ R2: Deleted ${r2DeleteResult.deleted.length}/${
            deletedPolicyNames.length
          } policies`
        );
      } else {
        console.log('🗑️ R2: Deleted 0 policies');
      }
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
