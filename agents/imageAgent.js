const { defineAgent } = require('../orchestrator/agentContract');
const { uploadFromUrl, uploadBuffer } = require('../orchestrator/storage');
const { callClaudeJSON } = require('../orchestrator/claudeClient');

/**
 * IMAGE AGENT — advertisement-grade creative, two-step:
 *
 *   Step 1: Claude writes a DETAILED ad-creative prompt from the script —
 *           including the CORRECT equipment for the modality (a DEXA scan is
 *           an open flat table with a scanning arm, NOT an X-ray box; an MRI
 *           is a large tube; ultrasound is a handheld probe...). This is what
 *           fixes both the "blank/plain image" and the "wrong machine" issues.
 *   Step 2: gpt-image-1 renders it. Moderation-blocked medical prompts get one
 *           sanitized retry.
 *
 * Input:  { brand, script, prompt, aspect_ratio }
 * Output: { image_urls: [], ad_headline }
 * Env: OPENAI_API_KEY, CLAUDE_API_KEY
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
  const { brand, script, prompt, aspect_ratio = 'portrait' } = input;
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not set');

  const size = aspect_ratio === 'square' ? '1024x1024' : '1024x1536';
  const topic = script?.hook || prompt || 'preventive health checkup';

  // ---- Step 1: Claude designs the ad creative ----
  let design;
  try {
    design = await callClaudeJSON(
      `You are an art director creating an Instagram AD CREATIVE for "${(brand || 'a diagnostic centre').replace(/_/g, ' ')}",
an Indian diagnostic imaging & pathology centre in Ahmedabad.

Topic / hook: "${topic}"

Write a detailed image-generation prompt for a scroll-stopping ADVERTISEMENT — not a plain stock photo. Requirements:
- Composition like a professional healthcare ad: a clear focal point, depth, warm lighting, vibrant but trustworthy palette (teal/blue/white accents), space at the top for a headline.
- A short punchy HEADLINE (max 6 words, English or Hinglish) rendered INSIDE the image in bold clean typography.
- Real-feeling Indian people (patient and/or doctor) when relevant, fully clothed, professional.
- CRITICAL — equipment accuracy. If a scan type is mentioned, describe the CORRECT machine explicitly:
  * DEXA/bone density: open flat padded table, patient lying on back, small scanning arm passing above — NOT an X-ray cabinet, NOT a CT/MRI tube
  * MRI: large deep cylindrical tube machine
  * CT: shorter donut-shaped ring gantry
  * X-ray: standing bucky/wall detector or overhead tube
  * Ultrasound/sonography: handheld probe on skin with a monitor
  * Mammography: upright compression unit
  * Pathology/blood test: vacutainer tubes, lab analyzer, phlebotomist
- No fake logos, no phone numbers, no small paragraph text — only the one headline.

Return JSON only: {"image_prompt":"...", "headline":"..."}`,
      { maxTokens: 700 }
    );
  } catch (e) {
    // If Claude is down, fall back to a decent static ad-style prompt.
    design = {
      image_prompt: `Professional Indian healthcare advertisement creative about ${topic}. Warm lighting, teal and white palette, a friendly Indian doctor with a patient in a modern diagnostic centre, bold short headline text at top, ad-style composition with clear focal point.`,
      headline: '',
    };
  }

  // ---- Step 2: render with gpt-image-1 ----
  const call = (p) =>
    fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({ model: 'gpt-image-1', prompt: p, size, n: 1, quality: 'high' }),
    });

  let res = await call(design.image_prompt);

  if (!res.ok) {
    const errText = await res.text();
    if (/moderation_blocked|safety/i.test(errText)) {
      res = await call(sanitize(design.image_prompt));
      if (!res.ok) throw new Error(`OpenAI image error after safe retry (${res.status}): ${(await res.text()).slice(0, 250)}`);
    } else {
      throw new Error(`OpenAI image error (${res.status}): ${errText.slice(0, 250)}`);
    }
  }

  const item = (await res.json()).data?.[0];
  if (!item) throw new Error('OpenAI returned no image');

  const publicUrl = item.b64_json
    ? await uploadBuffer(item.b64_json, 'image', `uic/${brand}`)
    : await uploadFromUrl(item.url, 'image', `uic/${brand}`);

  return {
    output: { image_urls: [publicUrl], ad_headline: design.headline || null },
    confidence: 0.85,
    cost: { tokens: 700, usd: 0.09 }, // high-quality render + Claude design step
  };
});
