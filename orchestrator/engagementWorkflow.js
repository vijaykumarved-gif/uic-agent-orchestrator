const { getAgent } = require('./agentRegistry');

/**
 * ENGAGEMENT WORKFLOW — Stage 4, event-driven (not scheduled, not a flow).
 * Fires immediately when a comment/DM webhook arrives (see index.js /webhook route).
 *
 * Lead Qualification -> (if qualified) -> CRM -> WhatsApp follow-up
 * This is intentionally a simple sequential await chain, not a BullMQ flow —
 * it's fast (3 quick calls), latency-sensitive (reply while the person is
 * still engaged), and doesn't need retry/backoff infrastructure.
 */
async function handleEngagementEvent({ platform, message_text, contact_handle, contact_phone, contact_name }) {
  const leadQualificationAgent = getAgent('lead_qualification_agent');
  const crmAgent = getAgent('crm_agent');
  const whatsappAgent = getAgent('whatsapp_agent');

  const qualResult = await leadQualificationAgent({
    input: { platform, message_text, contact_handle },
    context: {},
  });

  if (qualResult.status !== 'success') {
    // The agent itself errored (e.g. Claude API key missing/invalid, rate limit) —
    // this is NOT the same as "not a lead" and should be surfaced/alerted on,
    // not silently treated as normal non-lead traffic.
    console.error('[engagementWorkflow] lead_qualification_agent failed:', qualResult.error);
    return { action: 'error', reason: qualResult.error };
  }

  if (!qualResult.output?.is_lead) {
    return { action: 'ignored', reason: qualResult.output?.intent || 'not a lead' };
  }

  const crmResult = await crmAgent({
    input: {
      lead: {
        source_platform: platform,
        contact_name,
        contact_phone,
        contact_handle,
        intent_signal: message_text,
        qualification_score: qualResult.output.qualification_score,
      },
    },
    context: {},
  });

  let whatsappResult = null;
  if (contact_phone) {
    whatsappResult = await whatsappAgent({
      input: { contact_phone, template_name: 'lead_followup_v1', params: { name: contact_name || 'there' } },
      context: {},
    });
  }

  return {
    action: 'qualified_and_followed_up',
    lead_id: crmResult.output?.lead_id,
    suggested_reply: qualResult.output.suggested_reply,
    whatsapp_sent: !!whatsappResult,
  };
}

module.exports = { handleEngagementEvent };
