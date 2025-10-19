import { fetchPolicyPage } from './page/fetcher';
import { parsePolicyLinks, enrichLinksWithTitles } from './page/parser';
import { writeLinksToR2, writePoliciestoR2ByTitle } from './storage/r2-writer';
import { KVManager } from './kv/manager';
import { PolicySynchronizer } from './kv/synchronizer';
import type { ApiPolicy, SyncMetadata } from './kv/types';

interface Env {
  POLICY_STORAGE: R2Bucket;
  POLICY_REGISTRY: KVNamespace;
  POLICY_PAGE_URL: string;
  POLICY_PAGE_KEY: string;
  PREVIEW_PARSER_BASE_URL: string;
  BEARER_TOKEN: string;
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
      console.log(`[${now.toISOString()}] Starting policy sync and collection job...`);

      // ==================== Phase 1: Fetch Policy Data ====================
      console.log(`🔄 Fetching policy page: ${env.POLICY_PAGE_URL}`);
      const html = await fetchPolicyPage(env.POLICY_PAGE_URL, {
        timeoutMs: 5000,
        maxRetries: 3,
        backoffMultiplier: 2
      });
      console.log(`✓ Policy page fetched (${html.length} bytes)`);

      // Parse links from HTML
      const links = parsePolicyLinks(html, env.POLICY_PAGE_KEY);
      console.log(`✓ Parsed ${links.length} policy links`);

      // Enrich links with titles
      const enrichedLinks = enrichLinksWithTitles(html, links);
      console.log(`✓ Enriched links with titles`);

      // ==================== Phase 2: KV Synchronization ====================
      console.log(`\n🔄 Starting KV synchronization...`);
      const kvManager = new KVManager(env.POLICY_REGISTRY);
      const synchronizer = new PolicySynchronizer(kvManager);

      // Convert enriched links to API policy format
      const apiPolicies: ApiPolicy[] = enrichedLinks.map(link => ({
        title: link.title || 'Unknown',
        fileNo: link.fileNo,
        previewUrl: link.previewUrl,
        downloadUrl: link.downloadUrl
      }));

      // Validate policies
      const validPolicies = synchronizer.validateAndFilterPolicies(apiPolicies);
      console.log(`✓ Validated ${validPolicies.length}/${apiPolicies.length} policies`);

      // Run synchronization
      const syncResult = await synchronizer.synchronize(validPolicies);

      // Record sync metadata
      const syncMetadata: SyncMetadata = {
        timestamp: now.toISOString(),
        totalProcessed: syncResult.stats.totalScanned,
        added: syncResult.stats.added,
        updated: syncResult.stats.updated,
        deleted: syncResult.stats.deleted,
        status: syncResult.stats.added + syncResult.stats.updated + syncResult.stats.deleted > 0
          ? 'success'
          : 'success',
        errorCount: 0
      };
      await kvManager.setSyncMetadata(syncMetadata);
      console.log(`✓ Sync metadata recorded`);

      // ==================== Phase 3: Save to R2 ====================
      console.log(`\n🔄 Saving policy data to R2...`);

      // Save individual policies by title under /policies/
      const r2ByTitleResult = await writePoliciestoR2ByTitle(
        env.POLICY_STORAGE,
        enrichedLinks,
        now,
        {
          previewParserBaseUrl: env.PREVIEW_PARSER_BASE_URL,
          bearerToken: env.BEARER_TOKEN,
          fetchContent: true
        }
      );

      // Also save combined links file for backward compatibility
      const r2LegacyResult = await writeLinksToR2(
        env.POLICY_STORAGE,
        enrichedLinks,
        env.POLICY_PAGE_KEY,
        now
      );

      // ==================== Summary ====================
      const duration = Date.now() - startTime;

      console.log(`\n${'='.repeat(60)}`);
      console.log(`✅ Policy sync and collection completed in ${duration}ms`);
      console.log(`📊 Sync Results:`);
      console.log(`   • Total policies: ${syncResult.stats.totalScanned}`);
      console.log(`   • Added: ${syncResult.stats.added}`);
      console.log(`   • Updated: ${syncResult.stats.updated}`);
      console.log(`   • Deleted: ${syncResult.stats.deleted}`);

      console.log(`📦 R2 Results:`);
      console.log(`   • By Title: Saved ${r2ByTitleResult.savedPolicies} policies under /policies/`);
      if (r2LegacyResult.saved) {
        console.log(`   • Combined: Saved to ${r2LegacyResult.path}`);
      } else if (r2LegacyResult.skipped) {
        console.log(`   • Combined: Skipped (already exists for today)`);
      }
      console.log(`${'='.repeat(60)}`);
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`\n❌ Policy sync and collection job failed after ${duration}ms:`, error);

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
