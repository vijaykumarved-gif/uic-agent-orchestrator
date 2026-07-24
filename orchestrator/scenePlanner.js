const { callClaudeJSON } = require('./claudeClient');

/**
 * Veo generates 8-second clips. A 25-40s reel therefore needs several clips
 * that read as ONE continuous ad, not disconnected stock shots.
 *
 * Claude acts as the director: it splits the script into shots, keeps the
 * subject/wardrobe/location consistent across them for visual continuity, and
 * writes each shot as a self-contained cinematic prompt (Veo has no memory
 * between clips, so every prompt must restate who/where).
 *
 * Critically it also enforces MODALITY ACCURACY — a DEXA scanner is an open
 * flat table with a scanning arm, not an X-ray box — the same problem we
 * already fixed for still images.
 */

const MODALITY_GUIDE = `EQUIPMENT ACCURACY (critical — wrong machines destroy credibility):
- DEXA / bone density: open flat padded table, patient lying on back fully clothed, a slim
  horizontal scanning arm gliding above the body. NOT a tube, NOT an X-ray cabinet.
- MRI: large deep cylindrical tube, motorised table sliding in, control room glass.
- CT: shorter donut-shaped ring gantry (much thinner than MRI).
- X-ray: standing wall detector / overhead tube arm.
- Ultrasound / sonography: handheld probe with gel on skin, monitor showing greyscale image.
- Mammography: upright unit with compression paddles.
- Pathology / blood test: phlebotomist, vacutainer tubes, automated lab analyser.
- ECG / cardiac: chest electrodes and a trace on a monitor.`;

async function planScenes({ script, brand, maxScenes = 3 }) {
  const brandName = (brand || 'a diagnostic centre').replace(/_/g, ' ');

  const prompt = `You are directing a ${maxScenes * 8}-second vertical (9:16) Instagram ad for
"${brandName}", an Indian diagnostic imaging & pathology centre in Ahmedabad.

THE SCRIPT (this will be the voiceover — the visuals must match its beats):
Hook: ${script?.hook || ''}
Body: ${script?.body || ''}
CTA: ${script?.cta || ''}

Break this into exactly ${maxScenes} shots of about 8 seconds each, in order.

Rules for each shot's prompt:
- Write it as a standalone cinematic film direction — the video model has NO memory of the
  other shots, so restate the subject, wardrobe, and location every time to keep continuity.
- Keep the SAME main character across all shots (describe her/him identically each time:
  e.g. "a warm, professional Indian woman doctor in her 30s, navy scrubs and white coat").
- Real Indian people, modern clean Indian diagnostic centre, natural warm lighting,
  shallow depth of field, smooth slow camera movement (slow push-in, gentle pan).
- NO SPOKEN DIALOGUE and no on-screen text — a separate voiceover and subtitles are added
  later. Describe ambience only (soft room tone, quiet equipment hum).
- Fully clothed, respectful, clinically accurate. No fake logos, no gore, no distress.

${MODALITY_GUIDE}

Return JSON only:
{"scenes":[{"shot":1,"prompt":"...","covers":"which part of the script this visualises"}]}`;

  const parsed = await callClaudeJSON(prompt, { maxTokens: 2000 });
  const scenes = (parsed.scenes || []).slice(0, maxScenes);
  if (!scenes.length) throw new Error('Scene planner returned no scenes');
  return scenes;
}

module.exports = { planScenes };
