const { defineAgent } = require('../orchestrator/agentContract');
const { uploadBuffer } = require('../orchestrator/storage');

/**
 * VOICE AGENT — Google Cloud Text-to-Speech
 * Input:  { script_text, language: 'en'|'hi'|'gu' }
 * Output: { audio_url, duration_seconds, language }
 *
 * Google TTS chosen because it's the only major provider with real GUJARATI
 * (gu-IN) voices — relevant for UIC's Ahmedabad/Gujarat audience.
 *
 * Env: GOOGLE_TTS_API_KEY  (Cloud Console -> APIs -> Text-to-Speech -> API key)
 */
const VOICES = {
  en: { languageCode: 'en-IN', name: 'en-IN-Neural2-A' },   // Indian English
  hi: { languageCode: 'hi-IN', name: 'hi-IN-Neural2-A' },   // Hindi
  gu: { languageCode: 'gu-IN', name: 'gu-IN-Standard-A' },  // Gujarati (no Neural2 yet)
};

module.exports = defineAgent('voice_agent', async (input) => {
  const { script_text, language = 'en' } = input;
  if (!process.env.GOOGLE_TTS_API_KEY) throw new Error('GOOGLE_TTS_API_KEY not set');
  if (!script_text) throw new Error('voice_agent got empty script_text');

  const voice = VOICES[language] || VOICES.en;

  const res = await fetch(
    `https://texttospeech.googleapis.com/v1/text:synthesize?key=${process.env.GOOGLE_TTS_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: { text: script_text },
        voice: { languageCode: voice.languageCode, name: voice.name },
        audioConfig: { audioEncoding: 'MP3', speakingRate: 1.0 },
      }),
    }
  );

  if (!res.ok) throw new Error(`Google TTS error (${res.status}): ${await res.text()}`);

  const { audioContent } = await res.json();
  if (!audioContent) throw new Error('Google TTS returned no audio');

  // Cloudinary treats audio under the 'video' resource type.
  const audio_url = await uploadBuffer(audioContent, 'video', 'uic/audio');

  // ~150 wpm is a reasonable spoken-pace estimate for a rough duration.
  const words = script_text.split(/\s+/).length;
  const duration_seconds = Math.max(1, Math.round((words / 150) * 60));

  return {
    output: { audio_url, duration_seconds, language },
    confidence: 0.9,
    cost: { tokens: 0, usd: 0.004 },
  };
});
