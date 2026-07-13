const { defineAgent } = require('../orchestrator/agentContract');

/**
 * VIDEO AGENT — Creatomate (template-based render API)
 * Input:  { image_urls, audio_url, captions, script, brand }
 * Output: { video_url, duration_seconds }
 *
 * Assembles the generated image + voiceover + burned-in subtitles into a
 * 9:16 reel. Creatomate renders ASYNCHRONOUSLY, so we poll until it's done.
 *
 * Env: CREATOMATE_API_KEY, CREATOMATE_TEMPLATE_ID (optional)
 *
 * SETUP NOTE: build a 1080x1920 template in the Creatomate editor with three
 * named elements — "Image", "Voiceover", "Subtitles" — then put its ID in
 * CREATOMATE_TEMPLATE_ID. Without a template ID we fall back to a simple
 * inline composition defined below.
 */
module.exports = defineAgent('video_agent', async (input) => {
  const { image_urls = [], audio_url, captions = [], script } = input;
  if (!process.env.CREATOMATE_API_KEY) throw new Error('CREATOMATE_API_KEY not set');
  if (!audio_url) throw new Error('video_agent requires audio_url from voice_agent');
  if (!image_urls.length) throw new Error('video_agent requires image_urls from image_agent');

  const body = process.env.CREATOMATE_TEMPLATE_ID
    ? {
        template_id: process.env.CREATOMATE_TEMPLATE_ID,
        modifications: {
          Image: image_urls[0],
          Voiceover: audio_url,
          Subtitles: script?.hook || '',
        },
      }
    : {
        // Fallback inline composition: 9:16, image with slow zoom, voiceover,
        // auto-generated subtitles burned in.
        source: {
          output_format: 'mp4',
          width: 1080,
          height: 1920,
          elements: [
            {
              type: 'image',
              source: image_urls[0],
              fit: 'cover',
              animations: [{ type: 'scale', scope: 'element', start_scale: '100%', end_scale: '115%', easing: 'linear' }],
            },
            { type: 'audio', source: audio_url },
            {
              type: 'text',
              transcript_source: audio_url,   // Creatomate auto-transcribes for burned-in captions
              y: '78%',
              width: '86%',
              font_family: 'Montserrat',
              font_weight: '700',
              font_size: '7 vmin',
              fill_color: '#ffffff',
              stroke_color: '#000000',
              stroke_width: '0.6 vmin',
              text_align: 'center',
            },
          ],
        },
      };

  const startRes = await fetch('https://api.creatomate.com/v1/renders', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.CREATOMATE_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!startRes.ok) throw new Error(`Creatomate error (${startRes.status}): ${await startRes.text()}`);

  const renders = await startRes.json();
  const render = Array.isArray(renders) ? renders[0] : renders;
  if (!render?.id) throw new Error('Creatomate returned no render id');

  // Poll — rendering a 30s reel typically takes 20-60s.
  const video_url = await pollRender(render.id);

  return {
    output: { video_url, duration_seconds: null },
    confidence: 0.85,
    cost: { tokens: 0, usd: 0.05 },
  };
});

async function pollRender(renderId, timeoutMs = 300000, intervalMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, intervalMs));

    const res = await fetch(`https://api.creatomate.com/v1/renders/${renderId}`, {
      headers: { Authorization: `Bearer ${process.env.CREATOMATE_API_KEY}` },
    });
    if (!res.ok) throw new Error(`Creatomate poll failed (${res.status})`);

    const r = await res.json();
    if (r.status === 'succeeded') return r.url;
    if (r.status === 'failed') throw new Error(`Creatomate render failed: ${r.error_message || 'unknown'}`);
    // else: 'planned' | 'waiting' | 'transcribing' | 'rendering' -> keep polling
  }
  throw new Error(`Creatomate render timed out after ${timeoutMs}ms`);
}
