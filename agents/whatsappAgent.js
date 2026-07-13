const { defineAgent } = require('../orchestrator/agentContract');

/**
 * WHATSAPP AGENT
 * Input:  { contact_phone, template_name, params }
 * Output: { message_id, status }
 *
 * This should reuse your existing WATI integration (you already have WATI
 * wired for TaskFlow/notifications) — same API key, just a different template
 * for "thanks for your interest, here's how to book a scan" style follow-ups.
 */
module.exports = defineAgent('whatsapp_agent', async (input) => {
  const { contact_phone, template_name } = input;

  // TODO: replace with your existing WATI send-template call:
  // const res = await watiClient.sendTemplateMessage({ phone: contact_phone, template_name, params });

  return {
    output: { message_id: 'stub-wati-msg-id', status: 'sent', to: contact_phone, template: template_name },
    confidence: 0.9,
    cost: { tokens: 0, usd: 0 },
  };
});
