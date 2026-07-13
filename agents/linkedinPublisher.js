const { defineAgent } = require('../orchestrator/agentContract');

/**
 * LINKEDIN PUBLISHER
 * Input:  { brand, caption, media_url }
 * Output: { external_post_id, permalink }
 *
 * TODO: LinkedIn Marketing API (ugcPosts endpoint) — useful for B2B content
 * (referring doctors, corporate health screening tie-ups) rather than consumer reels.
 */
module.exports = defineAgent('linkedin_publisher', async (input) => {
  return {
    output: { external_post_id: 'stub-li-post-id', permalink: 'https://linkedin.com/feed/stub' },
    confidence: 0.85,
    cost: { tokens: 0, usd: 0 },
  };
});
