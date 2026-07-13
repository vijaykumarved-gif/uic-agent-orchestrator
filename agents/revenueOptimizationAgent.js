const { defineAgent } = require('../orchestrator/agentContract');

/**
 * REVENUE OPTIMIZATION AGENT
 * Scheduled (e.g. weekly) — closes the loop from content -> leads -> conversion -> revenue.
 * Input:  { brand, period: 'last_7_days' }
 * Output: { recommendation: string, budget_reallocation: {}, content_mix_adjustment: {} }
 *
 * TODO: join leads.status='converted' with published_posts + agent_runs.cost_usd
 * to compute real cost-per-lead and cost-per-conversion by content type/platform,
 * then recommend where to shift effort (e.g. "carousel posts on Instagram are
 * driving 3x the qualified leads per rupee of Video Agent cost this week").
 */
module.exports = defineAgent('revenue_optimization_agent', async (input) => {
  return {
    output: {
      recommendation: 'stub — insufficient data yet; needs >=2 weeks of leads.status history to compute cost-per-conversion by content type',
      budget_reallocation: {},
      content_mix_adjustment: {},
    },
    confidence: 0.3,
    cost: { tokens: 0, usd: 0 },
  };
});
