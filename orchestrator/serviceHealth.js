const { query } = require('../db/db');

/**
 * SERVICE HEALTH
 * Scans recent agent failures and rolls them up per PROVIDER (OpenAI,
 * ElevenLabs, Claude, ...) so the dashboard can say "OpenAI balance khatam"
 * instead of making the user read raw errors agent-by-agent.
 *
 * Classification is by error text pattern; each provider reports its most
 * severe recent issue: balance > invalid_key > missing_key > rate_limit > error.
 */

// Which agent talks to which paid service
const AGENT_PROVIDER = {
  image_agent: 'openai',
  thumbnail_agent: 'openai',
  subtitle_agent: 'openai',
  voice_agent: 'elevenlabs',
  script_agent: 'claude',
  caption_agent: 'claude',
  hashtag_agent: 'claude',
  viral_prediction_agent: 'claude',
  trend_agent: 'claude',
  lead_qualification_agent: 'claude',
  revenue_optimization_agent: 'claude',
  video_agent: 'video',
  instagram_publisher: 'meta',
  facebook_publisher: 'meta',
  competitor_agent: 'meta',
  analytics_agent: 'meta',
  youtube_shorts_publisher: 'youtube',
  linkedin_publisher: 'linkedin',
  whatsapp_agent: 'wati',
};

const PROVIDER_LABELS = {
  openai: 'OpenAI (images + subtitles)',
  elevenlabs: 'ElevenLabs (voiceover)',
  claude: 'Claude (scripts + captions)',
  video: 'Video generation (HeyGen / Creatomate)',
  meta: 'Meta / Instagram',
  youtube: 'YouTube',
  linkedin: 'LinkedIn',
  wati: 'WATI (WhatsApp)',
  cloudinary: 'Cloudinary (media storage)',
};

// Where to go to fix each provider's billing/keys
const PROVIDER_FIX_URLS = {
  openai: 'platform.openai.com → Settings → Billing / Limits',
  elevenlabs: 'elevenlabs.io → Subscription',
  claude: 'console.anthropic.com → Billing',
  video: 'heygen.com or creatomate.com → Billing',
  meta: 'business.facebook.com (token may have expired)',
  youtube: 'Google Cloud Console → OAuth credentials',
  linkedin: 'linkedin.com/developers (token may have expired)',
  wati: 'app.wati.io → Subscription',
  cloudinary: 'cloudinary.com → Settings',
};

/** Order matters: first match wins; listed most-specific first. */
const ISSUE_PATTERNS = [
  ['balance',     /billing.hard.limit|billing_limit|insufficient.funds|insufficient_quota|exceeded.*quota|quota.*exceeded|credit.*(exhaust|insufficient|depleted)|payment.required|402|out of credits|character.*limit.*reached|usage.*limit/i],
  ['invalid_key', /invalid.*(api.)?key|incorrect api key|401|unauthoriz|authentication.failed|invalid x-api-key|token.*(expired|invalid)/i],
  ['missing_key', /not set|not configured/i],
  ['rate_limit',  /429|rate.limit|too many requests/i],
];

const SEVERITY = { balance: 4, invalid_key: 3, missing_key: 2, rate_limit: 1, error: 0 };

// Which env var(s) satisfy each provider — used to auto-clear "missing key"
// alerts the moment the key is actually added (no need to wait for a new run).
const PROVIDER_ENV = {
  openai: ['OPENAI_API_KEY'],
  elevenlabs: ['ELEVENLABS_API_KEY'],
  claude: ['CLAUDE_API_KEY'],
  
  meta: ['META_GRAPH_API_TOKEN'],
  youtube: ['YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET', 'YOUTUBE_REFRESH_TOKEN'],
  linkedin: ['LINKEDIN_ACCESS_TOKEN'],
  wati: ['WATI_API_KEY'],
  cloudinary: ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'],
};

function envNowSet(provider) {
  // Video is satisfied by EITHER provider's key.
  if (provider === 'video') return !!(process.env.HEYGEN_API_KEY || process.env.CREATOMATE_API_KEY);
  const vars = PROVIDER_ENV[provider];
  if (!vars) return false;
  return vars.every((v) => !!process.env[v]);
}

const ISSUE_MESSAGES = {
  balance:     (p) => `${PROVIDER_LABELS[p]} is out of credits/balance. Recharge at: ${PROVIDER_FIX_URLS[p]}`,
  invalid_key: (p) => `${PROVIDER_LABELS[p]} API key is invalid or expired. Check: ${PROVIDER_FIX_URLS[p]}, then update it in Render → Environment.`,
  missing_key: (p) => `${PROVIDER_LABELS[p]} API key is not set in Render → Environment.`,
  rate_limit:  (p) => `${PROVIDER_LABELS[p]} hit a rate limit. This usually recovers on its own shortly.`,
  error:       (p) => `${PROVIDER_LABELS[p]} is failing in recent runs.`,
};

function classify(errText) {
  for (const [issue, re] of ISSUE_PATTERNS) {
    if (re.test(errText)) return issue;
  }
  return 'error';
}

/**
 * Returns { alerts: [{provider, label, issue, message, last_seen, agent_names, sample_error}] }
 * Only providers whose MOST RECENT run failed are alerted — if a later run of
 * any of that provider's agents succeeded, the problem is considered resolved.
 */
async function getServiceHealth() {
  // Latest outcome per agent over the last 24h, plus its error if failed.
  const { rows } = await query(`
    SELECT DISTINCT ON (agent_name)
      agent_name, status, error, created_at
    FROM agent_runs
    WHERE created_at > now() - interval '24 hours'
    ORDER BY agent_name, created_at DESC
  `);

  // Roll up to provider level
  const byProvider = {};
  for (const r of rows) {
    const provider = AGENT_PROVIDER[r.agent_name];
    if (!provider) continue;

    if (!byProvider[provider]) byProvider[provider] = { failed: [], okAt: null };
    if (r.status === 'failed' && r.error) {
      byProvider[provider].failed.push(r);
    } else if (r.status === 'success') {
      const t = new Date(r.created_at);
      if (!byProvider[provider].okAt || t > byProvider[provider].okAt) byProvider[provider].okAt = t;
    }
  }

  // Cloudinary shows up inside other agents' errors, not as its own agent.
  const cloudinaryFails = rows.filter(
    (r) => r.status === 'failed' && r.error && /cloudinary/i.test(r.error)
  );
  if (cloudinaryFails.length) {
    byProvider.cloudinary = { failed: cloudinaryFails, okAt: null };
  }

  const alerts = [];
  for (const [provider, info] of Object.entries(byProvider)) {
    if (!info.failed.length) continue;

    // If a success is newer than every failure, treat as recovered.
    const newestFail = info.failed.reduce(
      (max, f) => (new Date(f.created_at) > max ? new Date(f.created_at) : max),
      new Date(0)
    );
    if (info.okAt && info.okAt > newestFail) continue;

    // Pick the most severe issue among this provider's failing agents.
    let top = null;
    for (const f of info.failed) {
      const issue = classify(f.error);
      if (!top || SEVERITY[issue] > SEVERITY[top.issue]) {
        top = { issue, sample: f };
      }
    }

    // "Missing key" resolves itself the moment the key is added to the
    // environment — no need to wait for the next run to prove it.
    if (top.issue === 'missing_key' && envNowSet(provider)) continue;

    alerts.push({
      provider,
      label: PROVIDER_LABELS[provider] || provider,
      issue: top.issue,
      message: ISSUE_MESSAGES[top.issue](provider),
      last_seen: top.sample.created_at,
      agent_names: info.failed.map((f) => f.agent_name),
      sample_error: (top.sample.error || '').slice(0, 220),
    });
  }

  // Most severe first
  alerts.sort((a, b) => SEVERITY[b.issue] - SEVERITY[a.issue]);
  return { alerts };
}

module.exports = { getServiceHealth };
