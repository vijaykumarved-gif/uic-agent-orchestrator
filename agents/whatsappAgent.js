const { defineAgent } = require('../orchestrator/agentContract');

/**
 * WHATSAPP AGENT — WATI
 * Input:  { contact_phone, template_name, params: {name: 'x'} }
 * Output: { message_id, status }
 *
 * Env: WATI_API_KEY, WATI_BASE_URL  (e.g. https://live-server-xxxxx.wati.io)
 *
 * NOTE: WhatsApp only allows TEMPLATE messages to people who haven't messaged
 * you in the last 24h — and templates must be pre-approved in the WATI dashboard.
 * So `lead_followup_v1` must exist and be APPROVED there, or this returns an error.
 */
module.exports = defineAgent('whatsapp_agent', async (input) => {
  const { contact_phone, template_name = 'lead_followup_v1', params = {} } = input;
  const apiKey = process.env.WATI_API_KEY;
  const baseUrl = (process.env.WATI_BASE_URL || '').replace(/\/$/, '');

  if (!apiKey || !baseUrl) throw new Error('WATI_API_KEY / WATI_BASE_URL not set');
  if (!contact_phone) throw new Error('whatsapp_agent requires contact_phone');

  // WATI wants the number without '+' or spaces
  const phone = String(contact_phone).replace(/[^0-9]/g, '');

  const parameters = Object.entries(params).map(([name, value]) => ({ name, value: String(value) }));

  const res = await fetch(
    `${baseUrl}/api/v1/sendTemplateMessage?whatsappNumber=${phone}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: apiKey.startsWith('Bearer') ? apiKey : `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ template_name, broadcast_name: `agent_${Date.now()}`, parameters }),
    }
  );

  if (!res.ok) throw new Error(`WATI error (${res.status}): ${await res.text()}`);

  const data = await res.json();
  if (data.result === false || data.ok === false) {
    throw new Error(`WATI rejected message: ${JSON.stringify(data).slice(0, 200)}`);
  }

  return {
    output: { message_id: data.id || data.messageId || 'sent', status: 'sent', to: phone, template: template_name },
    confidence: 0.9,
    cost: { tokens: 0, usd: 0 },
  };
});
