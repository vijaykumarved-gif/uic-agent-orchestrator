const { defineAgent } = require('../orchestrator/agentContract');
const { callClaudeJSON } = require('../orchestrator/claudeClient');

/**
 * HASHTAG AGENT — Claude-generated, mix-aware
 * Input:  { brand, topic, region }
 * Output: { hashtags: [] }
 *
 * A good hashtag set is a MIX of reach tiers — a few big/broad, several
 * mid-size niche, and some local. All-broad tags get buried instantly;
 * all-niche gets no reach. That balance is the whole job here.
 */
module.exports = defineAgent('hashtag_agent', async (input) => {
  const { brand, topic, region = 'Ahmedabad' } = input;

  const prompt = `Generate Instagram hashtags for a diagnostic imaging & pathology centre in
${region}, India, posting about: "${topic}".

Give a strategic MIX (not all broad, not all niche):
- 3 broad health hashtags (high volume)
- 6 mid-size niche hashtags (radiology/pathology/preventive health)
- 4 local hashtags (${region} / Gujarat)
- 2 branded

Rules: no banned/spammy tags, no medical misinformation tags, max 15 total.
Return JSON only: {"hashtags": ["#tag1", "#tag2", ...]}`;

  const parsed = await callClaudeJSON(prompt, { maxTokens: 700 });

  return {
    output: { hashtags: parsed.hashtags || [] },
    confidence: 0.8,
    cost: { tokens: 700, usd: 0.007 },
  };
});
