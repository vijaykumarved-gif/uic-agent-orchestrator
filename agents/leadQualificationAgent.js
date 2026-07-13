const { defineAgent } = require('../orchestrator/agentContract');
const { callClaudeJSON } = require('../orchestrator/claudeClient');

/**
 * LEAD QUALIFICATION AGENT
 * Event-driven — fires when a comment/DM comes in via webhook.
 * Input:  { platform, message_text, contact_handle }
 * Output: { is_lead: bool, qualification_score: 0-1, intent: string, suggested_reply }
 */
module.exports = defineAgent('lead_qualification_agent', async (input) => {
  const { message_text } = input;

  const prompt = `A person commented/messaged: "${message_text}" on a diagnostic centre's
Instagram post. Classify: is this a genuine lead (interested in booking a scan/test)?
Return JSON only: {"is_lead": true|false, "qualification_score": 0.0-1.0, "intent": "", "suggested_reply": ""}`;

  const parsed = await callClaudeJSON(prompt, { maxTokens: 600 });

  return { output: parsed, confidence: parsed.qualification_score, cost: { tokens: 600, usd: 0.006 } };
});
