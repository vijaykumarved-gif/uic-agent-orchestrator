const { defineAgent } = require('../orchestrator/agentContract');

/**
 * VIDEO AGENT
 * Input:  { script, voice_url, images, brand }
 * Output: { video_url, duration_seconds }
 *
 * TODO: wire to a video assembly pipeline — e.g. Remotion (programmatic video
 * in React) or an API like Shotstack/Creatomate for template-based rendering.
 */
module.exports = defineAgent('video_agent', async (input) => {
  return {
    output: { video_url: 'https://stub-cdn.example.com/video/placeholder.mp4', duration_seconds: 30 },
    confidence: 0.4,
    cost: { tokens: 0, usd: 0 },
  };
});
