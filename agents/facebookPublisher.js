const { defineAgent } = require('../orchestrator/agentContract');

/**
 * FACEBOOK PUBLISHER
 * Input:  { brand, caption, media_url }
 * Output: { external_post_id, permalink }
 *
 * TODO: Meta Graph API /me/feed or /{page-id}/photos endpoint — reuses same
 * FACEBOOK/META auth token as Instagram (if same Business Manager).
 */
module.exports = defineAgent('facebook_publisher', async (input) => {
  return {
    output: { external_post_id: 'stub-fb-post-id', permalink: 'https://facebook.com/stub' },
    confidence: 0.9,
    cost: { tokens: 0, usd: 0 },
  };
});
