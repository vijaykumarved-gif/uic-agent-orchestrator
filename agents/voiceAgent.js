const { defineAgent } = require('../orchestrator/agentContract');

/**
 * VOICE AGENT
 * Input:  { script_text, language: 'en'|'gu'|'hi', voice_profile }
 * Output: { audio_url, duration_seconds }
 *
 * TODO: wire to a TTS API (ElevenLabs supports Hindi/Gujarati-adjacent voices,
 * or Google Cloud TTS for Gujarati specifically).
 */
module.exports = defineAgent('voice_agent', async (input) => {
  const { language = 'en' } = input;
  return {
    output: { audio_url: 'https://stub-cdn.example.com/audio/placeholder.mp3', duration_seconds: 25, language },
    confidence: 0.4,
    cost: { tokens: 0, usd: 0 },
  };
});
