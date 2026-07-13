const { defineAgent } = require('../orchestrator/agentContract');

/**
 * IMAGE AGENT
 * Input:  { brand, prompt, style, aspect_ratio }
 * Output: { image_urls: [] }
 *
 * TODO: wire to an image generation API (e.g. Stability, Ideogram, or your
 * preferred provider) or Meta's asset library for stock medical imagery.
 */
module.exports = defineAgent('image_agent', async (input) => {
  const { prompt } = input;
  return {
    output: { image_urls: ['https://stub-cdn.example.com/img/placeholder.jpg'], note: `TODO: generate from prompt: "${prompt}"` },
    confidence: 0.4,
    cost: { tokens: 0, usd: 0 },
  };
});
