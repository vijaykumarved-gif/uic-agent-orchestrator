const { defineAgent } = require('../orchestrator/agentContract');
const { uploadFromUrl, uploadBuffer } = require('../orchestrator/storage');

/**
 * IMAGE AGENT — OpenAI (gpt-image-1)
 * Input:  { brand, prompt, aspect_ratio: 'square'|'portrait' }
 * Output: { image_urls: [] }   <- permanent Cloudinary URLs
 *
 * NOTE: OpenAI image URLs expire (~1hr) and gpt-image-1 returns base64.
 * Either way we re-host on Cloudinary so publishers get a stable public URL.
 * Env: OPENAI_API_KEY
 */
module.exports = defineAgent('image_agent', async (input) => {
  const { brand, prompt, aspect_ratio = 'portrait' } = input;
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not set');

  // 1024x1536 = portrait, best for IG reels/stories. 1024x1024 = feed square.
  const size = aspect_ratio === 'square' ? '1024x1024' : '1024x1536';

  const fullPrompt = `Professional, clean, trustworthy healthcare marketing visual for an Indian
diagnostic imaging centre. ${prompt}.
Style: modern medical, calm blues and whites, real-feeling (not cartoonish), no text overlays,
no fake logos, no distorted anatomy. Suitable for an Instagram post.`;

  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({ model: 'gpt-image-1', prompt: fullPrompt, size, n: 1 }),
  });

  if (!res.ok) throw new Error(`OpenAI image error (${res.status}): ${await res.text()}`);

  const data = await res.json();
  const item = data.data?.[0];
  if (!item) throw new Error('OpenAI returned no image');

  // gpt-image-1 returns b64_json; dall-e-3 returns a temporary url. Handle both.
  const publicUrl = item.b64_json
    ? await uploadBuffer(item.b64_json, 'image', `uic/${brand}`)
    : await uploadFromUrl(item.url, 'image', `uic/${brand}`);

  return {
    output: { image_urls: [publicUrl] },
    confidence: 0.85,
    cost: { tokens: 0, usd: 0.04 },
  };
});
