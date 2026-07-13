const { defineAgent } = require('../orchestrator/agentContract');
const { query } = require('../db/db');

/**
 * CRM AGENT
 * Input:  { lead: { contact_name, contact_phone, contact_handle, intent_signal, qualification_score, source_platform } }
 * Output: { lead_id, status }
 *
 * TODO: if you use an external CRM (Zoho, Salesforce, or a custom one), push
 * to it here too and store the external id in crm_ref_id.
 */
module.exports = defineAgent('crm_agent', async (input) => {
  const { lead } = input;

  const res = await query(
    `INSERT INTO leads (source_platform, contact_name, contact_phone, contact_handle, intent_signal, qualification_score, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'qualified') RETURNING id`,
    [lead.source_platform, lead.contact_name || null, lead.contact_phone || null,
      lead.contact_handle || null, lead.intent_signal || null, lead.qualification_score || null]
  );

  return { output: { lead_id: res.rows[0].id, status: 'qualified' }, confidence: 0.9, cost: { tokens: 0, usd: 0 } };
});
