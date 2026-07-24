const { defineAgent } = require('../orchestrator/agentContract');
const { uploadFromUrl, uploadBuffer } = require('../orchestrator/storage');

/**
 * IMAGE AGENT — OpenAI (gpt-image-1), with moderation-aware retry
 * Input:  { brand, prompt, aspect_ratio: 'square'|'portrait' }
 * Output: { image_urls: [] }   <- permanent Cloudinary URLs
 *
 * Medical topics can trip OpenAI's image moderation as false positives
 * (mammography etc.). On a moderation block we retry once with clinical
 * phrasing substituted for the trigger words.
 * Env: OPENAI_API_KEY
 */
const SANITIZE = [
  [/breast cancer|breast/gi, "women's health screening"],
  [/mammography|mammogram/gi, 'medical imaging checkup'],
  [/prostate/gi, "men's health screening"],
  [/cervical|pap smear/gi, 'preventive health screening'],
  [/pregnan\w+/gi, 'maternal health'],
];
const sanitize = (t) => SANITIZE.reduce((s, [re, r]) => s.replace(re, r), t || '');

module.exports = defineAgent('image_agent', async (input) => {
  const { brand, prompt, aspect_ratio = 'portrait' } = input;
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not set');

  // 1024x1536 = portrait, best for IG reels/stories. 1024x1024 = feed square.
  const size = aspect_ratio === 'square' ? '1024x1024' : '1024x1536';

  const buildPrompt = (topic) => `Professional, clean, trustworthy healthcare marketing visual for an Indian
diagnostic imaging centre. ${topic}.
Style: modern medical, calm blues and whites, real-feeling (not cartoonish), no text overlays,
no fake logos, no distorted anatomy, fully clothed professionals in a clinical setting.
Suitable for an Instagram post.`;

  const call = (p) =>
    fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({ model: 'gpt-image-1', prompt: p, size, n: 1 }),
    });

  let res = await call(buildPrompt(prompt));

  if (!res.ok) {
    const errText = await res.text();
    if (/moderation_blocked|safety/i.test(errText)) {
      // Retry once with trigger words replaced by clinical phrasing.
      res = await call(buildPrompt(sanitize(prompt)));
      if (!res.ok) throw new Error(`OpenAI image error after safe retry (${res.status}): ${(await res.text()).slice(0, 250)}`);
    } else {
      throw new Error(`OpenAI image error (${res.status}): ${errText.slice(0, 250)}`);
    }
  }

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
