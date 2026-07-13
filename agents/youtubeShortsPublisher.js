const { defineAgent } = require('../orchestrator/agentContract');

/**
 * YOUTUBE SHORTS PUBLISHER
 * Input:  { brand, title, description, video_url, tags }
 * Output: { external_post_id, permalink }
 *
 * TODO: YouTube Data API v3 (videos.insert) — needs OAuth2 refresh token per
 * channel, and video must be <=60s vertical to qualify as a Short.
 */
module.exports = defineAgent('youtube_shorts_publisher', async (input) => {
  return {
    output: { external_post_id: 'stub-yt-video-id', permalink: 'https://youtube.com/shorts/stub' },
    confidence: 0.85,
    cost: { tokens: 0, usd: 0 },
  };
});
