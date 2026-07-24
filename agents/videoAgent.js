const { defineAgent } = require('../orchestrator/agentContract');
const { uploadFromUrl, uploadBuffer } = require('../orchestrator/storage');
const { planScenes } = require('../orchestrator/scenePlanner');

/**
 * VIDEO AGENT — three modes, auto-selected by which key is configured:
 *
 *   1. VEO (Google Gemini)  — REAL generated footage, cinematic. Claude storyboards
 *      the script into 8-second shots, Veo renders each, Creatomate stitches them
 *      with the ElevenLabs voiceover + subtitles. Used when GEMINI_API_KEY is set.
 *
 *   2. AVATAR (HeyGen)      — an AI presenter lip-syncs the voiceover.
 *
 *   3. SLIDESHOW (Creatomate) — single image + slow zoom + voiceover + subtitles.
 *
 * Fallback chain: whichever mode is chosen, if it fails and a cheaper mode is
 * available, we fall back rather than losing the whole run.
 *
 * Env:
 *   GEMINI_API_KEY      — aistudio.google.com -> Get API key  (Veo)
 *   VEO_MODEL           — veo-3.1-fast-generate-preview (default) | veo-3.1-generate-preview
 *   VEO_SCENES          — how many 8s shots to generate (default 3 => ~24s reel)
 *   VEO_RESOLUTION      — 720p (default) | 1080p
 *   HEYGEN_API_KEY, HEYGEN_AVATAR_ID
 *   CREATOMATE_API_KEY  — required to stitch Veo clips; also the slideshow renderer
 */
module.exports = defineAgent('video_agent', async (input) => {
  const hasFal = !!process.env.FAL_KEY;
  const hasVeo = !!process.env.GEMINI_API_KEY;
  const hasHeygen = !!process.env.HEYGEN_API_KEY;
  const hasCreatomate = !!process.env.CREATOMATE_API_KEY;

  if (!hasFal && !hasVeo && !hasHeygen && !hasCreatomate) {
    throw new Error('No video provider configured: set FAL_KEY (cheap models), GEMINI_API_KEY (Veo), HEYGEN_API_KEY (avatar), or CREATOMATE_API_KEY (slideshow)');
  }

  const tryFallback = async (err, label) => {
    if (hasHeygen) {
      console.warn(`[video_agent] ${label} — falling back to HeyGen avatar`);
      try {
        const r = await heygenAvatarVideo(input);
        r.output.fallback_reason = label;
        return r;
      } catch (e2) {
        if (!hasCreatomate) throw e2;
        console.warn(`[video_agent] HeyGen also failed — falling back to Creatomate slideshow`);
        const r2 = await creatomateSlideshow(input);
        r2.output.fallback_reason = `${label}; HeyGen also failed`;
        return r2;
      }
    }
    if (hasCreatomate) {
      console.warn(`[video_agent] ${label} — falling back to Creatomate slideshow`);
      const r = await creatomateSlideshow(input);
      r.output.fallback_reason = label;
      return r;
    }
    throw err;
  };

  if (hasFal) {
    try {
      return await falVideo(input, { hasCreatomate });
    } catch (err) {
      const label = /quota|429|balance|payment|402/i.test(err.message)
        ? `fal.ai unavailable (${err.message.slice(0, 100)})`
        : `fal.ai failed (${err.message.slice(0, 120)})`;
      if (hasVeo) {
        console.warn(`[video_agent] ${label} — falling back to Veo`);
        try {
          const r = await veoVideo(input, { hasCreatomate });
          r.output.fallback_reason = label;
          return r;
        } catch (e2) { return await tryFallback(e2, `${label}; Veo also failed`); }
      }
      return await tryFallback(err, label);
    }
  }

  if (hasVeo) {
    if (!hasCreatomate) {
      console.warn('[video_agent] Veo needs CREATOMATE_API_KEY to stitch shots + voiceover — using single-shot mode');
    }
    try {
      return await veoVideo(input, { hasCreatomate });
    } catch (err) {
      const label = /quota|429|exhausted|billing|permission/i.test(err.message)
        ? `Veo unavailable (${err.message.slice(0, 100)})`
        : `Veo failed (${err.message.slice(0, 120)})`;
      return await tryFallback(err, label);
    }
  }

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

/* ===================== FAL.AI (cheap models, one key) =====================
 * fal.ai is an aggregator: one key gives access to Kling, Wan, Seedance,
 * Hailuo, LTX and others — typically $0.03-0.05 per second, i.e. several times
 * cheaper than Veo. Model IDs on aggregators change often, so the model is an
 * env var (FAL_MODEL) rather than hard-coded: you can switch to whatever is
 * cheapest/best that month without touching this code.
 */

const FAL_QUEUE = 'https://queue.fal.run';

async function falVideo({ script, brand, audio_url }, { hasCreatomate }) {
  const key = process.env.FAL_KEY;
  const model = process.env.FAL_MODEL || 'fal-ai/kling-video/v2/standard/text-to-video';
  const maxScenes = hasCreatomate ? Math.max(1, parseInt(process.env.FAL_SCENES || process.env.VEO_SCENES || '3', 10)) : 1;

  const scenes = await planScenes({ script, brand, maxScenes });
  console.log(`[video_agent] fal.ai: storyboarded ${scenes.length} shot(s) with ${model}`);

  const clipUrls = [];
  for (const scene of scenes) {
    const url = await generateFalClip({ prompt: scene.prompt, model, key, brand });
    clipUrls.push(url);
    console.log(`[video_agent] fal.ai shot ${clipUrls.length}/${scenes.length} done`);
  }

  if (clipUrls.length === 1 && !hasCreatomate) {
    return {
      output: { video_url: clipUrls[0], mode: 'fal', shots: 1, model },
      confidence: 0.8,
      cost: { tokens: 0, usd: estimateFalCost(1) },
    };
  }

  const video_url = await stitchWithCreatomate({ clipUrls, audio_url });

  return {
    output: { video_url, mode: 'fal', shots: clipUrls.length, model,
      scene_prompts: scenes.map((s) => s.prompt?.slice(0, 160)) },
    confidence: 0.85,
    cost: { tokens: 2000, usd: estimateFalCost(clipUrls.length) + 0.05 },
  };
}

function estimateFalCost(shots) {
  // Rough guidance only — actual rate depends on FAL_MODEL. Budget models sit
  // around $0.03-0.05/s; check fal.ai/pricing for the model you pick.
  const perSecond = Number(process.env.FAL_COST_PER_SECOND || '0.04');
  return Number((shots * 5 * perSecond).toFixed(2));
}

async function generateFalClip({ prompt, model, key, brand }) {
  const submitRes = await fetch(`${FAL_QUEUE}/${model}`, {
    method: 'POST',
    headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      aspect_ratio: '9:16',
      duration: process.env.FAL_DURATION || '5',
      negative_prompt: 'text overlays, watermarks, logos, subtitles, distorted anatomy, extra fingers',
    }),
  });

  if (!submitRes.ok) {
    throw new Error(`fal.ai submit error (${submitRes.status}): ${(await submitRes.text()).slice(0, 250)}`);
  }

  const job = await submitRes.json();
  const statusUrl = job.status_url || `${FAL_QUEUE}/${model}/requests/${job.request_id}/status`;
  const responseUrl = job.response_url || `${FAL_QUEUE}/${model}/requests/${job.request_id}`;

  await pollFal(statusUrl, key);

  const resultRes = await fetch(responseUrl, { headers: { Authorization: `Key ${key}` } });
  if (!resultRes.ok) throw new Error(`fal.ai result fetch failed (${resultRes.status})`);
  const result = await resultRes.json();

  // Result shape varies by model — check the common paths.
  const clipUrl = result?.video?.url || result?.videos?.[0]?.url || result?.output?.video?.url || result?.url;
  if (!clipUrl) throw new Error(`fal.ai returned no video URL: ${JSON.stringify(result).slice(0, 250)}`);

  // Re-host so the URL is permanent and Creatomate/Instagram can always fetch it.
  return await uploadFromUrl(clipUrl, 'video', `uic/${brand || 'fal'}/clips`);
}

async function pollFal(statusUrl, key, timeoutMs = 300000, intervalMs = 6000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, intervalMs));
    const res = await fetch(statusUrl, { headers: { Authorization: `Key ${key}` } });
    if (!res.ok) throw new Error(`fal.ai status check failed (${res.status})`);
    const s = await res.json();
    if (s.status === 'COMPLETED') return;
    if (s.status === 'FAILED' || s.error) {
      throw new Error(`fal.ai generation failed: ${JSON.stringify(s.error || s).slice(0, 200)}`);
    }
    // IN_QUEUE / IN_PROGRESS -> keep polling
  }
  throw new Error('fal.ai clip generation timed out after 5 minutes');
}

/* ============================ VEO (Gemini API) ============================ */

const GENAI = 'https://generativelanguage.googleapis.com/v1beta';

async function veoVideo({ script, brand, audio_url, captions = [] }, { hasCreatomate }) {
  const key = process.env.GEMINI_API_KEY;
  // NOTE: the veo-3.0-* model IDs were shut down on 2026-06-30 — 3.1 only.
  const model = process.env.VEO_MODEL || 'veo-3.1-lite-generate-preview';
  const resolution = process.env.VEO_RESOLUTION || '720p';
  const maxScenes = hasCreatomate ? Math.max(1, parseInt(process.env.VEO_SCENES || '3', 10)) : 1;

  // 1. Storyboard the script into 8-second shots
  const scenes = await planScenes({ script, brand, maxScenes });
  console.log(`[video_agent] Veo: storyboarded ${scenes.length} shot(s) with ${model}`);

  // 2. Render each shot. Sequential on purpose — Veo is heavily rate-limited and
  //    parallel requests tend to 429 on standard keys.
  const clipUrls = [];
  for (const scene of scenes) {
    const url = await generateVeoClip({ prompt: scene.prompt, model, resolution, key, brand });
    clipUrls.push(url);
    console.log(`[video_agent] Veo shot ${scene.shot || clipUrls.length}/${scenes.length} done`);
  }

  // 3. Single shot and no stitcher: ship the clip as-is (it has native audio).
  if (clipUrls.length === 1 && !hasCreatomate) {
    return {
      output: { video_url: clipUrls[0], mode: 'veo', shots: 1, model },
      confidence: 0.8,
      cost: { tokens: 0, usd: estimateVeoCost(1, model) },
    };
  }

  // 4. Stitch shots + our voiceover + burned-in subtitles via Creatomate.
  const video_url = await stitchWithCreatomate({ clipUrls, audio_url });

  return {
    output: {
      video_url,
      mode: 'veo',
      shots: clipUrls.length,
      model,
      scene_prompts: scenes.map((s) => s.prompt?.slice(0, 160)),
    },
    confidence: 0.85,
    cost: { tokens: 2000, usd: estimateVeoCost(clipUrls.length, model) + 0.05 },
  };
}

function estimateVeoCost(shots, model) {
  // Rough list-price guidance so the dashboard's spend figure stays honest.
  const perSecond = /lite/i.test(model) ? 0.05 : /fast/i.test(model) ? 0.15 : 0.4;
  return Number((shots * 8 * perSecond).toFixed(2));
}

async function generateVeoClip({ prompt, model, resolution, key, brand }) {
  const body = JSON.stringify({
    instances: [{ prompt }],
    parameters: {
      aspectRatio: '9:16',        // vertical for reels
      resolution,
      personGeneration: 'allow_adult',
      negativePrompt: 'text overlays, watermarks, logos, subtitles, distorted anatomy, extra fingers, medical gore',
    },
  });
  const call = (m) =>
    fetch(`${GENAI}/models/${m}:predictLongRunning`, {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
      body,
    });

  let startRes = await call(model);

  // Google renames/retires Veo model IDs fairly often (the veo-3.0-* IDs were
  // removed in June 2026). Rather than dying on a stale env value, ask the API
  // which Veo models this key can actually use and retry with one of those.
  if (!startRes.ok && [404, 400].includes(startRes.status)) {
    const errText = await startRes.text();
    if (/not found|not supported|invalid.*model/i.test(errText)) {
      const discovered = await discoverVeoModel(key, model);
      if (discovered) {
        console.warn(`[video_agent] Veo model "${model}" unavailable — using "${discovered}" instead`);
        startRes = await call(discovered);
      }
    }
    if (!startRes.ok) throw new Error(`Veo start error (${startRes.status}): ${errText.slice(0, 250)}`);
  } else if (!startRes.ok) {
    throw new Error(`Veo start error (${startRes.status}): ${(await startRes.text()).slice(0, 250)}`);
  }

  const op = await startRes.json();
  if (!op.name) throw new Error(`Veo returned no operation name: ${JSON.stringify(op).slice(0, 200)}`);

  const fileUri = await pollVeo(op.name, key);

  // The file lives behind the API and needs the key to download, so Cloudinary
  // cannot fetch it by URL — pull the bytes here and upload them ourselves.
  const dl = await fetch(fileUri.includes('alt=media') ? fileUri : `${fileUri}&alt=media`, {
    headers: { 'x-goog-api-key': key },
  });
  if (!dl.ok) throw new Error(`Veo clip download failed (${dl.status})`);
  const buf = Buffer.from(await dl.arrayBuffer());
  if (!buf.length) throw new Error('Veo clip download was empty');

  return await uploadBuffer(buf, 'video', `uic/${brand || 'veo'}/clips`);
}

async function pollVeo(operationName, key, timeoutMs = 300000, intervalMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, intervalMs));

    const res = await fetch(`${GENAI}/${operationName}`, { headers: { 'x-goog-api-key': key } });
    if (!res.ok) throw new Error(`Veo poll failed (${res.status}): ${(await res.text()).slice(0, 200)}`);

    const op = await res.json();
    if (op.error) throw new Error(`Veo generation failed: ${op.error.message || JSON.stringify(op.error).slice(0, 200)}`);
    if (!op.done) continue;

    // Response shape has shifted between Veo versions — check the known paths.
    const uri =
      op.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri ||
      op.response?.generatedSamples?.[0]?.video?.uri ||
      op.response?.videos?.[0]?.uri ||
      op.response?.predictions?.[0]?.videoUri;

    if (!uri) throw new Error(`Veo finished but no video URI found: ${JSON.stringify(op.response || {}).slice(0, 250)}`);
    return uri;
  }
  throw new Error('Veo clip generation timed out after 5 minutes');
}

/**
 * Ask the Gemini API which Veo models this key can use, preferring the same
 * tier the user configured (lite -> lite, fast -> fast) so a rename doesn't
 * silently upgrade them onto a much more expensive model.
 */
async function discoverVeoModel(key, preferred = '') {
  try {
    const res = await fetch(`${GENAI}/models`, { headers: { 'x-goog-api-key': key } });
    if (!res.ok) return null;
    const list = (await res.json()).models || [];
    const veo = list
      .map((m) => (m.name || '').replace(/^models\//, ''))
      .filter((n) => /^veo-/i.test(n));
    if (!veo.length) return null;

    const tier = /lite/i.test(preferred) ? 'lite' : /fast/i.test(preferred) ? 'fast' : null;
    if (tier) {
      const sameTier = veo.find((n) => n.includes(tier));
      if (sameTier) return sameTier;
      // Don't silently jump to a pricier tier — surface it instead.
      console.warn(`[video_agent] no "${tier}" Veo model available; candidates: ${veo.join(', ')}`);
    }
    return veo[0];
  } catch {
    return null;
  }
}

/** Concatenate clips and lay our voiceover + auto subtitles over the top. */
async function stitchWithCreatomate({ clipUrls, audio_url }) {
  const elements = [];
  let t = 0;

  clipUrls.forEach((url) => {
    elements.push({
      type: 'video',
      source: url,
      track: 1,
      time: t,
      duration: 8,
      fit: 'cover',
      volume: 0,   // mute Veo's native audio — our ElevenLabs voiceover is the narration
    });
    t += 8;
  });

  if (audio_url) {
    elements.push({ type: 'audio', source: audio_url, track: 2, time: 0 });
    elements.push({
      type: 'text',
      track: 3,
      transcript_source: audio_url,   // Creatomate transcribes for burned-in captions
      y: '78%',
      width: '86%',
      font_family: 'Montserrat',
      font_weight: '700',
      font_size: '7 vmin',
      fill_color: '#ffffff',
      stroke_color: '#000000',
      stroke_width: '0.6 vmin',
      text_align: 'center',
    });
  }

  const startRes = await fetch('https://api.creatomate.com/v1/renders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.CREATOMATE_API_KEY}` },
    body: JSON.stringify({ source: { output_format: 'mp4', width: 1080, height: 1920, elements } }),
  });
  if (!startRes.ok) throw new Error(`Creatomate stitch error (${startRes.status}): ${(await startRes.text()).slice(0, 250)}`);

  const renders = await startRes.json();
  const render = Array.isArray(renders) ? renders[0] : renders;
  if (!render?.id) throw new Error('Creatomate returned no render id for stitch');

  return await pollCreatomate(render.id);
}

/* ========================= HEYGEN (talking avatar) ========================= */

const HEYGEN = 'https://api.heygen.com';

async function heygenAvatarVideo({ audio_url, image_urls = [] }) {
  if (!audio_url) throw new Error('avatar video requires audio_url from voice_agent');

  const headers = { 'X-Api-Key': process.env.HEYGEN_API_KEY, 'Content-Type': 'application/json' };

  let avatarId = process.env.HEYGEN_AVATAR_ID;
  if (!avatarId) {
    const listRes = await fetch(`${HEYGEN}/v2/avatars`, { headers });
    if (!listRes.ok) throw new Error(`HeyGen avatars list error (${listRes.status}): ${(await listRes.text()).slice(0, 200)}`);
    const list = await listRes.json();
    avatarId = list?.data?.avatars?.[0]?.avatar_id;
    if (!avatarId) throw new Error('No HeyGen avatars available on this account — set HEYGEN_AVATAR_ID');
  }

  const background = image_urls[0]
    ? { type: 'image', url: image_urls[0], fit: 'cover' }
    : { type: 'color', value: '#E4F4F5' };

  const buildBody = (character) => ({
    video_inputs: [{ character, voice: { type: 'audio', audio_url }, background }],
    dimension: { width: 1080, height: 1920 },
  });

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

  const heygenUrl = await pollHeygen(videoId, headers);
  const video_url = await uploadFromUrl(heygenUrl, 'video', 'uic/video');

  return { output: { video_url, mode: 'avatar', avatar_id: avatarId }, confidence: 0.85, cost: { tokens: 0, usd: 0.5 } };
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
  return { output: { video_url, mode: 'slideshow' }, confidence: 0.8, cost: { tokens: 0, usd: 0.05 } };
}

async function pollCreatomate(renderId, timeoutMs = 420000, intervalMs = 5000) {
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
  throw new Error('Creatomate render timed out');
}
