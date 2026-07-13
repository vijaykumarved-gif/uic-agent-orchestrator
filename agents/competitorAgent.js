const { defineAgent } = require('../orchestrator/agentContract');

/**
 * COMPETITOR AGENT — Meta Business Discovery API
 * Input:  { competitors: ['handle_without_at', ...] }
 * Output: { insights: [{ handle, followers, top_posts, avg_engagement_rate }] }
 *
 * Meta's business_discovery edge lets a Business account read PUBLIC data of
 * other Business/Creator accounts — this is the legitimate, ToS-compliant way
 * to do competitor analysis (no scraping).
 *
 * Limitation worth knowing: it only works on Business/Creator accounts, not
 * personal ones, and returns no data for private accounts.
 *
 * Env: META_GRAPH_API_TOKEN, META_IG_BUSINESS_ID
 * Configure competitor handles via COMPETITOR_HANDLES (comma-separated).
 */
const GRAPH = 'https://graph.facebook.com/v21.0';

module.exports = defineAgent('competitor_agent', async (input) => {
  const token = process.env.META_GRAPH_API_TOKEN;
  const igId = process.env.META_IG_BUSINESS_ID;

  const handles =
    input.competitors?.length
      ? input.competitors
      : (process.env.COMPETITOR_HANDLES || '').split(',').map((h) => h.trim()).filter(Boolean);

  if (!handles.length) {
    return {
      output: { insights: [], note: 'No competitor handles configured. Set COMPETITOR_HANDLES env var.' },
      confidence: 0.2,
      cost: { tokens: 0, usd: 0 },
    };
  }
  if (!token || !igId) throw new Error('META_GRAPH_API_TOKEN / META_IG_BUSINESS_ID not set');

  const insights = [];
  const failed = [];

  for (const raw of handles) {
    const handle = raw.replace('@', '');
    try {
      const fields = `business_discovery.username(${handle}){followers_count,media_count,media.limit(10){caption,like_count,comments_count,media_type,permalink,timestamp}}`;
      const res = await fetch(`${GRAPH}/${igId}?fields=${encodeURIComponent(fields)}&access_token=${token}`);

      if (!res.ok) throw new Error(`(${res.status}) ${(await res.text()).slice(0, 120)}`);

      const bd = (await res.json()).business_discovery;
      const media = bd?.media?.data || [];

      const withEng = media.map((m) => ({
        permalink: m.permalink,
        media_type: m.media_type,
        engagements: (m.like_count || 0) + (m.comments_count || 0),
        caption: (m.caption || '').slice(0, 120),
      }));

      const avgEng = withEng.length
        ? withEng.reduce((s, m) => s + m.engagements, 0) / withEng.length
        : 0;

      insights.push({
        handle,
        followers: bd?.followers_count ?? null,
        media_count: bd?.media_count ?? null,
        avg_engagements_per_post: Math.round(avgEng),
        engagement_rate: bd?.followers_count ? avgEng / bd.followers_count : null,
        top_posts: withEng.sort((a, b) => b.engagements - a.engagements).slice(0, 3),
      });
    } catch (err) {
      // A private/personal competitor account shouldn't kill the whole run.
      failed.push({ handle, error: err.message });
    }
  }

  return {
    output: { insights, failed },
    confidence: insights.length ? 0.85 : 0.3,
    cost: { tokens: 0, usd: 0 },
  };
});
