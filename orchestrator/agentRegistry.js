/**
 * Single source of truth mapping agent name -> agent function.
 * Adding agent #21 next year = one new file + one new line here.
 * The worker and flow-builders never need to know about individual agents directly.
 */

const registry = {
  // Stage 1 — Intelligence
  trend_agent: require('../agents/trendAgent'),
  competitor_agent: require('../agents/competitorAgent'),
  viral_prediction_agent: require('../agents/viralPredictionAgent'),

  // Stage 2 — Creation
  script_agent: require('../agents/scriptAgent'),
  thumbnail_agent: require('../agents/thumbnailAgent'),
  caption_agent: require('../agents/captionAgent'),
  hashtag_agent: require('../agents/hashtagAgent'),
  image_agent: require('../agents/imageAgent'),
  video_agent: require('../agents/videoAgent'),
  voice_agent: require('../agents/voiceAgent'),
  subtitle_agent: require('../agents/subtitleAgent'),

  // Stage 3 — Distribution
  instagram_publisher: require('../agents/instagramPublisher'),
  facebook_publisher: require('../agents/facebookPublisher'),
  youtube_shorts_publisher: require('../agents/youtubeShortsPublisher'),
  linkedin_publisher: require('../agents/linkedinPublisher'),

  // Stage 4 — Engagement / CRM (event-driven)
  lead_qualification_agent: require('../agents/leadQualificationAgent'),
  crm_agent: require('../agents/crmAgent'),
  whatsapp_agent: require('../agents/whatsappAgent'),

  // Stage 5 — Growth / Finance (scheduled)
  analytics_agent: require('../agents/analyticsAgent'),
  revenue_optimization_agent: require('../agents/revenueOptimizationAgent'),
};

function getAgent(name) {
  const agent = registry[name];
  if (!agent) throw new Error(`Unknown agent: "${name}". Check agentRegistry.js`);
  return agent;
}

module.exports = { registry, getAgent };
