const { defineAgent } = require('../orchestrator/agentContract');

/**
 * SUBTITLE AGENT — OpenAI Whisper
 * Input:  { audio_url, language }
 * Output: { captions: [{start,end,text}], srt }
 *
 * Transcribes the generated voiceover to get REAL word timings. Critical for
 * Instagram, where most people watch on mute — no captions, no watch time.
 *
 * Env: OPENAI_API_KEY
 */
module.exports = defineAgent('subtitle_agent', async (input) => {
  const { audio_url, language = 'en' } = input;
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not set');
  if (!audio_url) throw new Error('subtitle_agent requires audio_url from voice_agent');

  // Fetch the audio we just uploaded, and hand the bytes to Whisper.
  const audioRes = await fetch(audio_url);
  if (!audioRes.ok) throw new Error(`Could not fetch audio_url (${audioRes.status})`);
  const audioBuf = Buffer.from(await audioRes.arrayBuffer());

  const form = new FormData();
  form.append('file', new Blob([audioBuf], { type: 'audio/mpeg' }), 'audio.mp3');
  form.append('model', 'whisper-1');
  form.append('language', language);
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'segment');

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: form,
  });

  if (!res.ok) throw new Error(`Whisper error (${res.status}): ${await res.text()}`);

  const data = await res.json();
  const captions = (data.segments || []).map((s) => ({
    start: s.start,
    end: s.end,
    text: s.text.trim(),
  }));

  const srt = captions
    .map((c, i) => `${i + 1}\n${toSrtTime(c.start)} --> ${toSrtTime(c.end)}\n${c.text}\n`)
    .join('\n');

  return {
    output: { captions, srt, transcript: data.text },
    confidence: 0.9,
    cost: { tokens: 0, usd: 0.006 },
  };
});

function toSrtTime(sec) {
  const h = String(Math.floor(sec / 3600)).padStart(2, '0');
  const m = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
  const s = String(Math.floor(sec % 60)).padStart(2, '0');
  const ms = String(Math.round((sec % 1) * 1000)).padStart(3, '0');
  return `${h}:${m}:${s},${ms}`;
}
