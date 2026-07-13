const { defineAgent } = require('../orchestrator/agentContract');

/**
 * SUBTITLE AGENT
 * Input:  { audio_url, language }
 * Output: { srt_url, captions: [{ start, end, text }] }
 *
 * TODO: wire to a speech-to-text API (Whisper API, AssemblyAI) for real
 * timestamped captions — critical for silent-scroll viewers on Instagram.
 */
module.exports = defineAgent('subtitle_agent', async (input) => {
  return {
    output: { srt_url: 'https://stub-cdn.example.com/subs/placeholder.srt', captions: [] },
    confidence: 0.4,
    cost: { tokens: 0, usd: 0 },
  };
});
