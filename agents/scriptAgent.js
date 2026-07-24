const { defineAgent } = require('../orchestrator/agentContract');
const { callClaudeJSON } = require('../orchestrator/claudeClient');

/**
 * SCRIPT AGENT
 * Input:  { brand, topic, format: 'reel'|'carousel'|'static', tone }
 * Output: { hook, body, cta, full_script }
 */
module.exports = defineAgent('script_agent', async (input) => {
  const { brand, topic, format = 'reel', tone = 'friendly, expert, Hinglish-aware', avoid_hooks = [] } = input;

  const avoidBlock = avoid_hooks.length
    ? `\nIMPORTANT — your hook and framing must be CLEARLY DIFFERENT from these recent posts
(different opening, different angle, not a reworded copy):\n${avoid_hooks.slice(0, 12).map((h) => `- ${h}`).join('\n')}\n`
    : '';

  const prompt = `Write a ${format} script for ${brand}'s Instagram about: "${topic}".
Tone: ${tone}. Structure: 3-second hook, body (educate/build trust), clear CTA to book a scan/test.
${avoidBlock}
Keep the total script concise — suitable for a 30-45 second reel.
Return JSON only, with exactly these keys: {"hook":"", "body":"", "cta":"", "full_script":""}`;

  // 2000 tokens: a full reel script (hook + body + cta + the full_script repeat)
  // does not fit in 600 — that truncation was what broke the first live run.
  const parsed = await callClaudeJSON(prompt, { maxTokens: 2000 });

  return { output: parsed, confidence: 0.8, cost: { tokens: 2000, usd: 0.02 } };
});
