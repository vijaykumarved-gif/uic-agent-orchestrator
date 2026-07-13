const { defineAgent } = require('../orchestrator/agentContract');
const { query } = require('../db/db');

/**
 * ANALYTICS AGENT
 * Scheduled (e.g. daily) — pulls metrics for posts published in the last N days.
 * Input:  { since_days: 7 }
 * Output: { posts_analyzed: n, top_performers: [], underperformers: [] }
 *
 * TODO: pull real metrics via Meta Graph API /insights, YouTube Analytics API,
 * LinkedIn API, and write them into published_posts.metrics.
 */
module.exports = defineAgent('analytics_agent', async (input) => {
  const rawDays = Number(input?.since_days);
  const since_days = Number.isFinite(rawDays) && rawDays > 0 ? rawDays : 7; // validated + parameterized — never interpolate input into SQL directly

  const res = await query(
    `SELECT id, platform, external_post_id FROM published_posts
     WHERE published_at > now() - ($1 || ' days')::interval`,
    [since_days]
  );

  // STUB — replace with real per-platform insights fetch, then UPDATE published_posts.metrics
  const posts_analyzed = res.rows.length;

  return {
    output: { posts_analyzed, top_performers: [], underperformers: [], note: 'TODO: wire real platform insights APIs' },
    confidence: 0.5,
    cost: { tokens: 0, usd: 0 },
  };
});
