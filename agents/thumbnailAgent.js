const { defineAgent } = require('../orchestrator/agentContract');
const { uploadFromUrl, uploadBuffer } = require('../orchestrator/storage');

/**
 * THUMBNAIL AGENT — OpenAI
 * Input:  { script, brand, format }
 * Output: { thumbnail_url }
 *
 * A thumbnail is a DIFFERENT job from the main image: high contrast, a clear
 * focal point, and composed to be legible at small size in a grid/feed.
 */
module.exports = defineAgent('thumbnail_agent', async (input) => {
  const { script, brand } = input;
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not set');

  const hook = script?.hook || 'health awareness';
  const prompt = `Eye-catching thumbnail for a healthcare reel about: "${hook}".
High contrast, single clear focal subject, bold composition that stays legible as a small
thumbnail in an Instagram grid. Calm medical palette. No text, no logos, no distorted faces.`;

  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({ model: 'gpt-image-1', prompt, size: '1024x1536', n: 1 }),
  });

  if (!res.ok) throw new Error(`OpenAI thumbnail error (${res.status}): ${await res.text()}`);

  const item = (await res.json()).data?.[0];
  if (!item) throw new Error('OpenAI returned no thumbnail');

  const thumbnail_url = item.b64_json
    ? await uploadBuffer(item.b64_json, 'image', `uic/${brand}/thumbs`)
    : await uploadFromUrl(item.url, 'image', `uic/${brand}/thumbs`);

  return { output: { thumbnail_url }, confidence: 0.8, cost: { tokens: 0, usd: 0.04 } };
});
