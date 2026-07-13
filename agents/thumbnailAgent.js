const { defineAgent } = require('../orchestrator/agentContract');

/**
 * THUMBNAIL AGENT
 * Input:  { script, brand, format }
 * Output: { thumbnail_url, alt_variants: [] }
 *
 * TODO: wire to an image generation API (or your existing Image Agent) with a
 * thumbnail-specific prompt template (bold text overlay, high contrast, face/eye focus).
 */
module.exports = defineAgent('thumbnail_agent', async (input) => {
  const { script } = input;
  return {
    output: {
      thumbnail_url: 'https://stub-cdn.example.com/thumb/placeholder.jpg',
      alt_variants: [],
      note: `TODO: generate real thumbnail from hook: "${(script?.hook || '').slice(0, 60)}"`,
    },
    confidence: 0.4,
    cost: { tokens: 0, usd: 0 },
  };
});
