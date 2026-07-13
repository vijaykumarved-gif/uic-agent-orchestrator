const { defineAgent } = require('../orchestrator/agentContract');

/**
 * TREND AGENT — Claude + web search
 * Input:  { brand, category, region }
 * Output: { trends: [{ topic, angle, why_now, momentum_score }] }
 *
 * There is no clean public "what's trending on Instagram" API — Meta doesn't
 * expose one. So instead of pretending, we use Claude's web_search tool to find
 * what's actually being discussed in health/diagnostics right now, and turn
 * that into content angles. Honest and genuinely useful, vs a fake trends feed.
 *
 * Env: CLAUDE_API_KEY
 */
module.exports = defineAgent('trend_agent', async (input) => {
  const { brand, category = 'diagnostic imaging', region = 'Ahmedabad, Gujarat, India' } = input;

  const prompt = `Search the web for what is currently being discussed in health, wellness, and
${category} in ${region} and India generally — health awareness days, seasonal health issues
(dengue/flu season, heat waves, pollution), viral health topics, new screening guidelines,
or recent health news.

Then propose 4 Instagram content angles a diagnostic imaging & pathology centre could post
about THIS WEEK that would feel timely and relevant, not generic.

Return JSON only:
{"trends":[{"topic":"","angle":"","why_now":"","momentum_score":0.0-1.0}]}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.CLAUDE_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 3000,
      system: 'Respond with ONLY valid JSON. No markdown fences, no preamble.',
      messages: [{ role: 'user', content: prompt }],
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
    }),
  });

  if (!res.ok) throw new Error(`Trend agent Claude error (${res.status}): ${await res.text()}`);

  const data = await res.json();

  // With tools enabled the response has multiple blocks (tool_use, tool_result,
  // text). Collect the TEXT blocks only — the final answer is the last one.
  const text = data.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .replace(/```json|```/g, '')
    .trim();

  let parsed;
  try {
    // Claude may narrate before the JSON when tools are used — grab the JSON object.
    const match = text.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(match ? match[0] : text);
  } catch (err) {
    throw new Error(`Trend agent got unparseable JSON: ${text.slice(0, 250)}`);
  }

  return {
    output: { brand, region, trends: parsed.trends || [] },
    confidence: 0.75,
    cost: { tokens: 3000, usd: 0.04 },
  };
});
