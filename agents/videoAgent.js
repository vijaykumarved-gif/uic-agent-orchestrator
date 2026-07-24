const { defineAgent } = require('../orchestrator/agentContract');
const { uploadFromUrl } = require('../orchestrator/storage');

/**
 * VIDEO AGENT — two modes, picked automatically by which key is configured:
 *
 *   1. AVATAR MODE (HeyGen) — a real-looking AI presenter SPEAKS the script,
 *      lip-synced to the ElevenLabs voiceover. This is the "human talking"
 *      style. Used when HEYGEN_API_KEY is set (takes priority).
 *
 *   2. SLIDESHOW MODE (Creatomate) — generated image with slow zoom +
 *      voiceover + burned-in subtitles. Used when only CREATOMATE_API_KEY set.
 *
 * Input:  { image_urls, audio_url, captions, script, brand }
 * Output: { video_url, mode }
 *
 * Env:
 *   HEYGEN_API_KEY      — heygen.com -> Settings -> API
 *   HEYGEN_AVATAR_ID    — optional; pick any avatar in HeyGen and copy its ID.
 *                         If not set, the first available avatar is used.
 *   CREATOMATE_API_KEY  — fallback slideshow renderer
 */
module.exports = defineAgent('video_agent', async (input) => {
  const hasHeygen = !!process.env.HEYGEN_API_KEY;
  const hasCreatomate = !!process.env.CREATOMATE_API_KEY;

  if (!hasHeygen && !hasCreatomate) {
    throw new Error('No video provider configured: set HEYGEN_API_KEY (talking avatar) or CREATOMATE_API_KEY (slideshow)');
  }

  // Prefer the talking avatar; if HeyGen fails for ANY reason (out of credits,
  // API error, render failure) and Creatomate is available, fall back to the
  // slideshow so the run still ships a video instead of dying.
  if (hasHeygen) {
    try {
      return await heygenAvatarVideo(input);
    } catch (err) {
      if (!hasCreatomate) throw err;
      const reason = /insufficient_credit|402|credit/i.test(err.message)
        ? 'HeyGen credits exhausted'
        : `HeyGen failed (${err.message.slice(0, 120)})`;
      console.warn(`[video_agent] ${reason} — falling back to Creatomate slideshow`);
      const result = await creatomateSlideshow(input);
      result.output.fallback_reason = reason;
      return result;
    }
  }

  return await creatomateSlideshow(input);
});

/* ========================= HEYGEN (talking avatar) ========================= */

const HEYGEN = 'https://api.heygen.com';

async function heygenAvatarVideo({ audio_url, image_urls = [] }) {
  if (!audio_url) throw new Error('avatar video requires audio_url from voice_agent');

  const headers = { 'X-Api-Key': process.env.HEYGEN_API_KEY, 'Content-Type': 'application/json' };

  // Which presenter? Explicit env wins; otherwise grab the first avatar on the account.
  let avatarId = process.env.HEYGEN_AVATAR_ID;
  if (!avatarId) {
    const listRes = await fetch(`${HEYGEN}/v2/avatars`, { headers });
    if (!listRes.ok) throw new Error(`HeyGen avatars list error (${listRes.status}): ${(await listRes.text()).slice(0, 200)}`);
    const list = await listRes.json();
    avatarId = list?.data?.avatars?.[0]?.avatar_id;
    if (!avatarId) throw new Error('No HeyGen avatars available on this account — set HEYGEN_AVATAR_ID');
  }

  // Background matches the topic: the ad image generated for this run sits
  // behind the presenter. Falls back to a clean brand teal if no image exists.
  const background = image_urls[0]
    ? { type: 'image', url: image_urls[0], fit: 'cover' }
    : { type: 'color', value: '#E4F4F5' };

  const buildBody = (character) => ({
    video_inputs: [{ character, voice: { type: 'audio', audio_url }, background }],
    dimension: { width: 1080, height: 1920 }, // Full HD vertical for reels
  });

  // HeyGen has two character kinds: studio "avatar" and photo-based
  // "talking_photo" (which is what a photo upload like the UIC avatar is).
  // Try avatar first; if the ID isn't found there, retry as talking_photo.
  let genRes = await fetch(`${HEYGEN}/v2/video/generate`, {
    method: 'POST', headers,
    body: JSON.stringify(buildBody({ type: 'avatar', avatar_id: avatarId, avatar_style: 'normal' })),
  });

  if (!genRes.ok) {
    const errText = await genRes.text();
    if (/not.?found|invalid|avatar/i.test(errText)) {
      genRes = await fetch(`${HEYGEN}/v2/video/generate`, {
        method: 'POST', headers,
        body: JSON.stringify(buildBody({ type: 'talking_photo', talking_photo_id: avatarId })),
      });
      if (!genRes.ok) throw new Error(`HeyGen generate error, both avatar types tried (${genRes.status}): ${(await genRes.text()).slice(0, 250)}`);
    } else {
      throw new Error(`HeyGen generate error (${genRes.status}): ${errText.slice(0, 250)}`);
    }
  }

  const gen = await genRes.json();
  const videoId = gen?.data?.video_id;
  if (!videoId) throw new Error(`HeyGen returned no video_id: ${JSON.stringify(gen).slice(0, 200)}`);

  // Poll — avatar renders typically take 2-6 minutes for a 30-60s clip.
  const heygenUrl = await pollHeygen(videoId, headers);

  // HeyGen URLs expire — re-host on Cloudinary for a permanent public URL.
  const video_url = await uploadFromUrl(heygenUrl, 'video', 'uic/video');

  return {
    output: { video_url, mode: 'avatar', avatar_id: avatarId },
    confidence: 0.85,
    cost: { tokens: 0, usd: 0.5 },
  };
}

async function pollHeygen(videoId, headers, timeoutMs = 600000, intervalMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, intervalMs));
    const res = await fetch(`${HEYGEN}/v1/video_status.get?video_id=${videoId}`, { headers });
    if (!res.ok) throw new Error(`HeyGen status check failed (${res.status})`);
    const d = await res.json();
    const status = d?.data?.status;
    if (status === 'completed') return d.data.video_url;
    if (status === 'failed') throw new Error(`HeyGen render failed: ${d?.data?.error?.message || 'unknown'}`);
    // processing / pending / waiting -> keep polling
  }
  throw new Error('HeyGen render timed out after 10 minutes');
}

/* ===================== CREATOMATE (slideshow fallback) ===================== */

async function creatomateSlideshow({ image_urls = [], audio_url, script }) {
  if (!audio_url) throw new Error('video_agent requires audio_url from voice_agent');
  if (!image_urls.length) throw new Error('video_agent requires image_urls from image_agent');

  const body = process.env.CREATOMATE_TEMPLATE_ID
    ? {
        template_id: process.env.CREATOMATE_TEMPLATE_ID,
        modifications: { Image: image_urls[0], Voiceover: audio_url, Subtitles: script?.hook || '' },
      }
    : {
        source: {
          output_format: 'mp4', width: 1080, height: 1920,
          elements: [
            { type: 'image', source: image_urls[0], fit: 'cover',
              animations: [{ type: 'scale', scope: 'element', start_scale: '100%', end_scale: '115%', easing: 'linear' }] },
            { type: 'audio', source: audio_url },
            { type: 'text', transcript_source: audio_url, y: '78%', width: '86%',
              font_family: 'Montserrat', font_weight: '700', font_size: '7 vmin',
              fill_color: '#ffffff', stroke_color: '#000000', stroke_width: '0.6 vmin', text_align: 'center' },
          ],
        },
      };

  const startRes = await fetch('https://api.creatomate.com/v1/renders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.CREATOMATE_API_KEY}` },
    body: JSON.stringify(body),
  });
  if (!startRes.ok) throw new Error(`Creatomate error (${startRes.status}): ${await startRes.text()}`);

  const renders = await startRes.json();
  const render = Array.isArray(renders) ? renders[0] : renders;
  if (!render?.id) throw new Error('Creatomate returned no render id');

  const video_url = await pollCreatomate(render.id);
  return { output: { video_url, mode: 'slideshow' }, confidence: 0.85, cost: { tokens: 0, usd: 0.05 } };
}

async function pollCreatomate(renderId, timeoutMs = 300000, intervalMs = 5000) {
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
  }
  throw new Error(`Creatomate render timed out after ${timeoutMs}ms`);
}
