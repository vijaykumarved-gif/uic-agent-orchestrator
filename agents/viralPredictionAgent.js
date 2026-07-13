const { defineAgent } = require('../orchestrator/agentContract');
const { callClaudeJSON } = require('../orchestrator/claudeClient');

/**
 * VIRAL PREDICTION AGENT
 * Input:  { script, format, trend_context }
 * Output: { predicted_score: 0-1, reasoning, recommended_changes: [] }
 *
 * Scores the script with Claude against a simple rubric. If the score comes
 * back below 0.5, contentPipeline.js holds the run for human review instead
 * of publishing.
 */
module.exports = defineAgent('viral_prediction_agent', async (input) => {
  const { script = '', format = 'reel' } = input;

  const prompt = `Score this ${format} script for a diagnostic imaging centre's Instagram.

Script: "${script}"

Rate on: hook strength (first 3 seconds), watch-time likelihood, shareability, and clarity of CTA.
Return JSON only: {"predicted_score": 0.0-1.0, "reasoning": "", "recommended_changes": []}`;

  const parsed = await callClaudeJSON(prompt, { maxTokens: 800 });

  return {
    output: parsed,
    confidence: 0.7,
    cost: { tokens: 800, usd: 0.008 },
  };
});
