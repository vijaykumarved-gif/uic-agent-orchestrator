const { defineAgent } = require('../orchestrator/agentContract');
const { callClaude } = require('../orchestrator/claudeClient');

/**
 * CAPTION AGENT
 * Input:  { brand, script, platform }
 * Output: { caption }
 */
module.exports = defineAgent('caption_agent', async (input) => {
  const { brand, script, platform = 'instagram' } = input;

  const prompt = `Write a ${platform} caption for ${brand} based on this script: ${JSON.stringify(script)}.
Keep it under 150 words, warm and trustworthy tone, include a clear CTA. Return plain text only.`;

  // 800 (not 300) — a 150-word caption plus any lead-in needs headroom,
  // otherwise it gets cut off mid-sentence.
  const caption = await callClaude(prompt, { maxTokens: 800 });

  return { output: { caption }, confidence: 0.8, cost: { tokens: 800, usd: 0.008 } };
});
