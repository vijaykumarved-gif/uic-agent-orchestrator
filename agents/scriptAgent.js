const { defineAgent } = require('../orchestrator/agentContract');
const { callClaude } = require('../orchestrator/claudeClient');

/**
 * SCRIPT AGENT
 * Input:  { brand, topic, format: 'reel'|'carousel'|'static', tone }
 * Output: { hook, body, cta, full_script }
 */
module.exports = defineAgent('script_agent', async (input) => {
  const { brand, topic, format = 'reel', tone = 'friendly, expert, Hinglish-aware' } = input;

  const prompt = `Write a ${format} script for ${brand}'s Instagram about: "${topic}".
Tone: ${tone}. Structure: 3-second hook, body (educate/build trust), clear CTA to book a scan/test.
Return JSON only: {"hook":"", "body":"", "cta":"", "full_script":""}`;

  const raw = await callClaude(prompt, { maxTokens: 600, jsonOnly: true });
  const parsed = JSON.parse(raw);

  return { output: parsed, confidence: 0.8, cost: { tokens: 600, usd: 0.01 } };
});
