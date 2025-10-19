import { fetchPolicyPage } from './page/fetcher';
import { parsePolicyLinks, enrichLinksWithTitles } from './page/parser';
import { writeLinksToR2 } from './storage/r2-writer';

interface Env {
  POLICY_STORAGE: R2Bucket;
  POLICY_PAGE_URL: string;
  POLICY_PAGE_KEY: string;
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
      console.log(`[${now.toISOString()}] Starting policy link collection job...`);

      // Fetch the policy page
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

      // Save to R2
      const result = await writeLinksToR2(
        env.POLICY_STORAGE,
        enrichedLinks,
        env.POLICY_PAGE_KEY,
        now
      );

      const duration = Date.now() - startTime;

      if (result.saved) {
        console.log(`\n✅ Policy link collection completed in ${duration}ms`);
        console.log(`📊 Saved ${enrichedLinks.length} links to ${result.path}`);
      } else if (result.skipped) {
        console.log(`\n⏭ Policy link collection skipped in ${duration}ms`);
        console.log(`📊 ${enrichedLinks.length} links already exist for today`);
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`❌ Policy link collection job failed after ${duration}ms:`, error);

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
