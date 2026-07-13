const { defineAgent } = require('../orchestrator/agentContract');

/**
 * HASHTAG AGENT
 * Input:  { brand, topic, region }
 * Output: { hashtags: [] }
 *
 * TODO: replace static list with a real hashtag-research API or a maintained
 * per-brand/per-city hashtag bank you curate in Postgres.
 */
module.exports = defineAgent('hashtag_agent', async (input) => {
  const { region = 'Ahmedabad' } = input;
  const hashtags = [
    '#HealthCheckup', `#${region}Health`, '#RadiologyMatters', '#EarlyDetectionSavesLives',
    '#DiagnosticCentre', '#MRI', '#CTScan', '#PathologyLab',
  ];
  return { output: { hashtags }, confidence: 0.5, cost: { tokens: 0, usd: 0 } };
});
