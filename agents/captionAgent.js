const { defineAgent } = require('../orchestrator/agentContract');
const { callClaude } = require('../orchestrator/claudeClient');

/**
 * CAPTION AGENT
 * Input:  { brand, script, platform }
 * Output: { caption }
 * (This is closest to what your existing Instagram-agent already does —
 * this stub keeps the same Claude-based approach, just wrapped in the contract.)
 */
module.exports = defineAgent('caption_agent', async (input) => {
  const { brand, script, platform = 'instagram' } = input;

  const prompt = `Write a ${platform} caption for ${brand} based on this script: ${JSON.stringify(script)}.
Keep it under 150 words, warm and trustworthy tone, include a clear CTA. Return plain text only.`;

  const caption = await callClaude(prompt, { maxTokens: 300 });

  return { output: { caption }, confidence: 0.8, cost: { tokens: 300, usd: 0.005 } };
});
