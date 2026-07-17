const { defineAgent } = require('../orchestrator/agentContract');
const { uploadBuffer } = require('../orchestrator/storage');

/**
 * VOICE AGENT — ElevenLabs Text-to-Speech
 * Input:  { script_text, language: 'en'|'hi' }
 * Output: { audio_url, duration_seconds, language }
 *
 * Uses eleven_multilingual_v2 — handles Hindi, English, and Hinglish (mixed)
 * scripts naturally, which matches how UIC's reel scripts are actually written.
 * NOTE: Gujarati is not officially supported by ElevenLabs; Hindi/Hinglish is
 * the practical choice here.
 *
 * Env:
 *   ELEVENLABS_API_KEY   (required — elevenlabs.io -> Profile -> API key)
 *   ELEVENLABS_VOICE_ID  (optional — defaults to a versatile stock voice;
 *                         pick any voice in the ElevenLabs Voice Library and
 *                         copy its ID to change the speaker)
 */
const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM'; // "Rachel" — clear, neutral stock voice

module.exports = defineAgent('voice_agent', async (input) => {
  const { script_text, language = 'en' } = input;
  if (!process.env.ELEVENLABS_API_KEY) throw new Error('ELEVENLABS_API_KEY not set');
  if (!script_text) throw new Error('voice_agent got empty script_text');

  const voiceId = process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID;

  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': process.env.ELEVENLABS_API_KEY,
      },
      body: JSON.stringify({
        text: script_text,
        model_id: 'eleven_multilingual_v2', // required for Hindi/Hinglish
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    // ElevenLabs sends structured JSON errors; surface the useful part.
    throw new Error(`ElevenLabs error (${res.status}): ${errText.slice(0, 300)}`);
  }

  // Response body is the raw MP3 bytes.
  const audioBuf = Buffer.from(await res.arrayBuffer());
  if (!audioBuf.length) throw new Error('ElevenLabs returned empty audio');

  // Cloudinary treats audio under the 'video' resource type.
  const audio_url = await uploadBuffer(audioBuf, 'video', 'uic/audio');

  // ~150 wpm spoken-pace estimate for a rough duration.
  const words = script_text.split(/\s+/).length;
  const duration_seconds = Math.max(1, Math.round((words / 150) * 60));

  return {
    output: { audio_url, duration_seconds, language },
    confidence: 0.9,
    cost: { tokens: 0, usd: 0.01 },
  };
});
