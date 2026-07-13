/**
 * Thin wrapper around the Anthropic Messages API, shared by every agent that
 * needs Claude (Script, Caption, Viral Prediction, Lead Qualification, etc.)
 * so the model name / retry logic / JSON-mode handling lives in one place.
 */

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-6'; // update as needed

async function callClaude(prompt, { maxTokens = 500, jsonOnly = false } = {}) {
  const systemPrompt = jsonOnly
    ? 'Respond with ONLY valid JSON. No markdown code fences, no preamble, no explanation.'
    : undefined;

  const res = await fetch(CLAUDE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.CLAUDE_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      ...(systemPrompt ? { system: systemPrompt } : {}),
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Claude API error (${res.status}): ${errText}`);
  }

  const data = await res.json();
  const textBlock = data.content.find((b) => b.type === 'text');
  let text = textBlock?.text || '';

  // If Claude hit the token ceiling, the response is cut off mid-sentence —
  // for jsonOnly calls that means invalid, unparseable JSON. Fail with a clear
  // message instead of a cryptic "Unterminated string in JSON at position N".
  if (data.stop_reason === 'max_tokens') {
    throw new Error(
      `Claude response was truncated (hit max_tokens=${maxTokens}). Increase maxTokens for this agent.`
    );
  }

  if (jsonOnly) {
    // strip accidental markdown fences just in case
    text = text.replace(/```json|```/g, '').trim();
  }

  return text;
}

/**
 * Call Claude and parse the result as JSON, with a clear error if it isn't valid.
 * Use this instead of `JSON.parse(await callClaude(...))` so a malformed
 * response gives a useful message (and shows the raw text) rather than a
 * bare parser error.
 */
async function callClaudeJSON(prompt, { maxTokens = 1000 } = {}) {
  const raw = await callClaude(prompt, { maxTokens, jsonOnly: true });
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Claude did not return valid JSON (${err.message}). Raw response: ${raw.slice(0, 300)}...`
    );
  }
}

module.exports = { callClaude, callClaudeJSON };
