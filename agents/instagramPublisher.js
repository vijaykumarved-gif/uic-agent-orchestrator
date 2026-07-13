const { defineAgent } = require('../orchestrator/agentContract');

/**
 * INSTAGRAM PUBLISHER
 * Input:  { brand, caption, hashtags, media_url, media_type: 'reel'|'image'|'carousel' }
 * Output: { external_post_id, permalink }
 *
 * This should reuse the exact Meta Graph API posting logic already live in
 * your Instagram-agent repo — move that function here unchanged, just wrap
 * it with defineAgent() so it logs to agent_runs and follows the contract.
 */
module.exports = defineAgent('instagram_publisher', async (input) => {
  const { caption, hashtags = [], media_url } = input;
  const fullCaption = `${caption}\n\n${hashtags.join(' ')}`;

  // TODO: replace with your existing Meta Graph API call:
  // const res = await postToInstagram({ media_url, caption: fullCaption });

  return {
    output: { external_post_id: 'stub-ig-post-id', permalink: 'https://instagram.com/p/stub', caption_used: fullCaption },
    confidence: 0.9,
    cost: { tokens: 0, usd: 0 },
  };
});
