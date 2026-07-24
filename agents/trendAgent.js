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
  const { brand, category = 'diagnostic imaging', region = 'Ahmedabad, Gujarat, India', avoid_topics = [] } = input;

  const avoidBlock = avoid_topics.length
    ? `\n\nIMPORTANT — DO NOT repeat these recently covered topics (find genuinely FRESH angles,
not rewordings of these):\n${avoid_topics.slice(0, 15).map((t) => `- ${t}`).join('\n')}`
    : '';

  const prompt = `Search the web for what is currently being discussed in health, wellness, and
${category} in ${region} and India generally — health awareness days, seasonal health issues
(dengue/flu season, heat waves, pollution), viral health topics, new screening guidelines,
or recent health news.

Then propose 3 Instagram content angles a diagnostic imaging & pathology centre could post
about THIS WEEK that would feel timely and relevant, not generic.${avoidBlock}

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
      max_tokens: 8000,
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

  const truncated = data.stop_reason === 'max_tokens';
  const parsed = parseJsonLoose(text);
  if (!parsed) {
    throw new Error(
      `Trend agent got unparseable JSON${truncated ? ' (response hit max_tokens and was cut off)' : ''}: ${text.slice(0, 200)}`
    );
  }
  if (truncated) console.warn('[trend_agent] response was truncated at max_tokens — recovered partial JSON');

  return {
    output: { brand, region, trends: parsed.trends || [] },
    confidence: 0.75,
    cost: { tokens: 3000, usd: 0.04 },
  };
});


/**
 * Parse JSON that may have a narration preamble AND may be truncated
 * mid-string (max_tokens). Strategy: grab from the first '{', try parsing;
 * on failure, progressively cut back to the previous '}' and close any
 * unbalanced brackets, so a cut-off trends array still yields the complete
 * trend objects that DID finish.
 */
function parseJsonLoose(text) {
  let t = String(text || '').replace(/```json|```/g, '');
  const start = t.indexOf('{');
  if (start === -1) return null;
  t = t.slice(start);

  const attempt = (s) => { try { return JSON.parse(s); } catch { return null; } };

  let direct = attempt(t);
  if (direct) return direct;

  // Truncation repair: walk back through closing braces, balance brackets.
  let cut = t.length;
  for (let tries = 0; tries < 12; tries++) {
    cut = t.lastIndexOf('}', cut - 1);
    if (cut <= 0) break;
    let candidate = t.slice(0, cut + 1);
    let opens = 0, opensSq = 0, inStr = false, escaped = false;
    for (const ch of candidate) {
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === '"') inStr = !inStr;
      if (inStr) continue;
      if (ch === '{') opens++; else if (ch === '}') opens--;
      else if (ch === '[') opensSq++; else if (ch === ']') opensSq--;
    }
    if (inStr) continue; // cut point landed inside a string — walk further back
    candidate += ']'.repeat(Math.max(0, opensSq)) + '}'.repeat(Math.max(0, opens));
    const parsed = attempt(candidate);
    if (parsed) return parsed;
  }
  return null;
}
