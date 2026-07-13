const { defineAgent } = require('../orchestrator/agentContract');
const { query } = require('../db/db');

/**
 * ANALYTICS AGENT — Meta Insights API
 * Scheduled daily. Pulls real metrics for recently published posts and writes
 * them back into published_posts.metrics, so Revenue Optimization has data.
 *
 * Env: META_GRAPH_API_TOKEN
 */
const GRAPH = 'https://graph.facebook.com/v21.0';

module.exports = defineAgent('analytics_agent', async (input) => {
  const rawDays = Number(input?.since_days);
  const since_days = Number.isFinite(rawDays) && rawDays > 0 ? rawDays : 7;

  const res = await query(
    `SELECT id, platform, external_post_id FROM published_posts
     WHERE published_at > now() - ($1 || ' days')::interval
       AND external_post_id IS NOT NULL`,
    [since_days]
  );

  const token = process.env.META_GRAPH_API_TOKEN;
  const updated = [];
  const failed = [];

  for (const post of res.rows) {
    // Only Meta platforms are wired here; YT/LI use different APIs.
    if (!['instagram', 'facebook'].includes(post.platform) || !token) continue;

    try {
      const metricList = 'likes,comments,shares,saved,reach,views';
      const r = await fetch(
        `${GRAPH}/${post.external_post_id}/insights?metric=${metricList}&access_token=${token}`
      );
      if (!r.ok) throw new Error(`(${r.status}) ${(await r.text()).slice(0, 120)}`);

      const data = await r.json();
      const metrics = {};
      for (const m of data.data || []) {
        metrics[m.name] = m.values?.[0]?.value ?? 0;
      }

      // Engagement rate is the number that actually matters for comparing posts.
      const engagements = (metrics.likes || 0) + (metrics.comments || 0) + (metrics.shares || 0) + (metrics.saved || 0);
      metrics.engagement_rate = metrics.reach ? engagements / metrics.reach : null;
      metrics.fetched_at = new Date().toISOString();

      await query(`UPDATE published_posts SET metrics = $1 WHERE id = $2`, [JSON.stringify(metrics), post.id]);
      updated.push({ post_id: post.id, platform: post.platform, engagement_rate: metrics.engagement_rate });
    } catch (err) {
      // One bad post shouldn't abort the whole daily run.
      failed.push({ post_id: post.id, error: err.message });
    }
  }

  const ranked = updated
    .filter((u) => u.engagement_rate != null)
    .sort((a, b) => b.engagement_rate - a.engagement_rate);

  return {
    output: {
      posts_analyzed: updated.length,
      failed: failed.length,
      failures: failed.slice(0, 5),
      top_performers: ranked.slice(0, 3),
      underperformers: ranked.slice(-3).reverse(),
    },
    confidence: 0.9,
    cost: { tokens: 0, usd: 0 },
  };
});
