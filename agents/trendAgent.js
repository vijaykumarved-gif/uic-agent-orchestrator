const { defineAgent } = require('../orchestrator/agentContract');

/**
 * TREND AGENT
 * Input:  { brand, category: 'radiology'|'pathology'|'wellness', region: 'Ahmedabad' }
 * Output: { trends: [{ topic, platform, momentum_score, source }] }
 *
 * TODO: wire to real sources — Instagram/YouTube trending audio & hashtags via
 * Meta Graph API + a scraping/trends API (e.g. Google Trends, Exploding Topics API).
 */
module.exports = defineAgent('trend_agent', async (input) => {
  const { brand, category = 'diagnostics', region = 'Ahmedabad' } = input;

  // STUB — replace with real trend-source calls
  const trends = [
    { topic: `MRI awareness reels — ${region}`, platform: 'instagram', momentum_score: 0.82, source: 'stub' },
    { topic: `${category} myth-busting carousel`, platform: 'instagram', momentum_score: 0.71, source: 'stub' },
  ];

  return { output: { brand, trends }, confidence: 0.6, cost: { tokens: 0, usd: 0 } };
});
