const { defineAgent } = require('../orchestrator/agentContract');
const { query } = require('../db/db');
const { callClaudeJSON } = require('../orchestrator/claudeClient');

/**
 * REVENUE OPTIMIZATION AGENT
 * Scheduled weekly. This is the agent that closes the loop:
 *   content -> agent cost -> leads -> conversions
 * and tells you where to spend more (and where to stop).
 *
 * It joins REAL data: agent_runs.cost_usd (what each pipeline actually cost),
 * published_posts.metrics (how it performed), leads.status (what converted).
 */
module.exports = defineAgent('revenue_optimization_agent', async (input) => {
  const { period_days = 7 } = input || {};

  // Cost + performance per pipeline run
  const perf = await query(
    `SELECT
        cpr.id,
        cpr.brand,
        pp.platform,
        (pp.metrics->>'engagement_rate')::numeric AS engagement_rate,
        (pp.metrics->>'reach')::numeric          AS reach,
        COALESCE(SUM(ar.cost_usd), 0)            AS pipeline_cost_usd
     FROM content_pipeline_runs cpr
     JOIN published_posts pp ON pp.pipeline_run_id = cpr.id
     LEFT JOIN agent_runs ar ON ar.pipeline_run_id = cpr.id
     WHERE cpr.created_at > now() - ($1 || ' days')::interval
     GROUP BY cpr.id, cpr.brand, pp.platform, pp.metrics
     ORDER BY engagement_rate DESC NULLS LAST`,
    [period_days]
  );

  // Lead funnel over the same window
  const leadStats = await query(
    `SELECT
        source_platform,
        COUNT(*)                                             AS total_leads,
        COUNT(*) FILTER (WHERE status = 'converted')         AS converted,
        AVG(qualification_score)                             AS avg_score
     FROM leads
     WHERE created_at > now() - ($1 || ' days')::interval
     GROUP BY source_platform`,
    [period_days]
  );

  const totalCost = perf.rows.reduce((s, r) => s + Number(r.pipeline_cost_usd || 0), 0);
  const totalLeads = leadStats.rows.reduce((s, r) => s + Number(r.total_leads || 0), 0);
  const totalConverted = leadStats.rows.reduce((s, r) => s + Number(r.converted || 0), 0);

  const costPerLead = totalLeads > 0 ? totalCost / totalLeads : null;
  const costPerConversion = totalConverted > 0 ? totalCost / totalConverted : null;

  // Not enough signal yet? Say so honestly rather than inventing a recommendation.
  if (perf.rows.length < 3 || totalLeads === 0) {
    return {
      output: {
        status: 'insufficient_data',
        recommendation:
          `Only ${perf.rows.length} published post(s) and ${totalLeads} lead(s) in the last ${period_days} days. ` +
          `Need at least ~3 posts and some lead flow before cost-per-conversion means anything.`,
        metrics: { totalCost, totalLeads, totalConverted, costPerLead, costPerConversion },
      },
      confidence: 0.3,
      cost: { tokens: 0, usd: 0 },
    };
  }

  const prompt = `You are a growth analyst for an Indian diagnostic imaging chain.

Last ${period_days} days of REAL data:
Posts: ${JSON.stringify(perf.rows.slice(0, 20))}
Lead funnel by platform: ${JSON.stringify(leadStats.rows)}
Total content cost: $${totalCost.toFixed(2)} | Leads: ${totalLeads} | Converted: ${totalConverted}
Cost per lead: ${costPerLead ? '$' + costPerLead.toFixed(2) : 'n/a'}
Cost per conversion: ${costPerConversion ? '$' + costPerConversion.toFixed(2) : 'n/a'}

Identify which platform/content is actually generating qualified leads per rupee spent,
and which is burning budget. Be specific and concrete. If the data is too thin to
support a conclusion, say so rather than guessing.

Return JSON only:
{"recommendation":"", "content_mix_adjustment":{}, "budget_reallocation":{}, "warning":""}`;

  const parsed = await callClaudeJSON(prompt, { maxTokens: 1500 });

  return {
    output: {
      status: 'ok',
      ...parsed,
      metrics: { totalCost, totalLeads, totalConverted, costPerLead, costPerConversion },
    },
    confidence: 0.75,
    cost: { tokens: 1500, usd: 0.015 },
  };
});
