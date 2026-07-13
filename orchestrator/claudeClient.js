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

  if (jsonOnly) {
    // strip accidental markdown fences just in case
    text = text.replace(/```json|```/g, '').trim();
  }

  return text;
}

module.exports = { callClaude };
