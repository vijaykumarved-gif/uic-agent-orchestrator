const { defineAgent } = require('../orchestrator/agentContract');

/**
 * COMPETITOR AGENT
 * Input:  { competitors: ['@competitor1_handle', '@competitor2_handle'] }
 * Output: { insights: [{ handle, top_performing_post, format, engagement_rate }] }
 *
 * TODO: wire to Meta Graph API (public content on business accounts) or a
 * social listening tool (Social Blade, Phyllo, Hootsuite API) for real data.
 */
module.exports = defineAgent('competitor_agent', async (input) => {
  const { competitors = [] } = input;

  const insights = competitors.map((handle) => ({
    handle,
    top_performing_post: 'stub-post-id',
    format: 'reel',
    engagement_rate: 0.04,
  }));

  return { output: { insights }, confidence: 0.5, cost: { tokens: 0, usd: 0 } };
});
