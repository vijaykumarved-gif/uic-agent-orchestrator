require('dotenv').config();
const express = require('express');
const path = require('path');
const { runContentPipeline } = require('./orchestrator/contentPipeline');
const { handleEngagementEvent } = require('./orchestrator/engagementWorkflow');
const { requireAuth, handleLogin, handleLogout } = require('./orchestrator/auth');
const { query } = require('./db/db');

const app = express();
app.use(express.json());

// Auth gate. Everything below this line requires a session except /health,
// /login, and the login page itself (handled inside requireAuth).
app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.post('/login', handleLogin);
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.use(requireAuth);
app.post('/logout', handleLogout);

// Dashboard
app.use(express.static(path.join(__dirname, 'public')));

// ---------------- Dashboard API ----------------

// Live activity: active runs, their agent statuses (including 'running' rows),
// and historical average durations per agent so the UI can estimate time left.
app.get('/api/live', async (req, res, next) => {
  try {
    const runs = await query(
      `SELECT id, brand, stage, status, script, trend_source, format, created_at
       FROM content_pipeline_runs
       WHERE status IN ('pending','running')
       ORDER BY created_at DESC LIMIT 3`
    );

    let agents = [];
    if (runs.rows.length) {
      const ids = runs.rows.map((r) => r.id);
      const ar = await query(
        `SELECT pipeline_run_id, agent_name, status, duration_ms, created_at
         FROM agent_runs WHERE pipeline_run_id = ANY($1) ORDER BY created_at`,
        [ids]
      );
      agents = ar.rows;
    }

    // Successful historical durations -> per-agent averages for ETA math.
    const avg = await query(
      `SELECT agent_name, ROUND(AVG(duration_ms)) AS avg_ms
       FROM agent_runs WHERE status = 'success' AND duration_ms IS NOT NULL
       GROUP BY agent_name`
    );
    const avg_durations = Object.fromEntries(avg.rows.map((r) => [r.agent_name, Number(r.avg_ms)]));

    res.json({
      runs: runs.rows, agents, avg_durations,
      configured: {
        video: !!(process.env.FAL_KEY || process.env.GEMINI_API_KEY || process.env.HEYGEN_API_KEY || process.env.CREATOMATE_API_KEY),
        videoEngine: process.env.FAL_KEY ? 'fal' : process.env.GEMINI_API_KEY ? 'veo' : process.env.HEYGEN_API_KEY ? 'avatar' : process.env.CREATOMATE_API_KEY ? 'slideshow' : null,
        veoImageSkipped: !!(process.env.FAL_KEY || process.env.GEMINI_API_KEY),
      },
      now: new Date().toISOString(),
    });
  } catch (err) { next(err); }
});

// Rolls up recent agent failures into per-provider alerts ("OpenAI balance
// khatam") so users don't have to diagnose raw errors run-by-run.
app.get('/api/service-health', async (req, res, next) => {
  try {
    const { getServiceHealth } = require('./orchestrator/serviceHealth');
    res.json(await getServiceHealth());
  } catch (err) { next(err); }
});

app.get('/api/stats', async (req, res, next) => {
  try {
    const runs = await query(`
      SELECT
        COUNT(*)                                          AS total_runs,
        COUNT(*) FILTER (WHERE stage = 'done')            AS published,
        COUNT(*) FILTER (WHERE status = 'needs_review')   AS needs_review,
        COUNT(*) FILTER (WHERE status = 'failed')         AS failed
      FROM content_pipeline_runs`);
    const cost = await query(`SELECT COALESCE(SUM(cost_usd),0) AS total_cost FROM agent_runs`);
    const leads = await query(`SELECT COUNT(*) AS leads FROM leads`);

    res.json({ ...runs.rows[0], ...cost.rows[0], ...leads.rows[0] });
  } catch (err) { next(err); }
});

app.get('/api/runs', async (req, res, next) => {
  try {
    // One query, with the per-run agent tallies rolled up — the dashboard needs
    // cost + pass/fail counts per row, and N+1 queries would be silly here.
    const { rows } = await query(`
      SELECT
        cpr.id, cpr.brand, cpr.stage, cpr.status, cpr.script, cpr.trend_source, cpr.created_at,
        COALESCE(SUM(ar.cost_usd), 0)                             AS cost,
        COUNT(ar.id)                                              AS total_agents,
        COUNT(ar.id) FILTER (WHERE ar.status = 'success')         AS ok_agents,
        COUNT(ar.id) FILTER (WHERE ar.status = 'failed')          AS failed_agents
      FROM content_pipeline_runs cpr
      LEFT JOIN agent_runs ar ON ar.pipeline_run_id = cpr.id
      GROUP BY cpr.id
      ORDER BY cpr.created_at DESC
      LIMIT 50`);
    res.json(rows);
  } catch (err) { next(err); }
});

app.get('/api/runs/:id', async (req, res, next) => {
  try {
    const run = await query(`SELECT * FROM content_pipeline_runs WHERE id = $1`, [req.params.id]);
    if (!run.rows.length) return res.status(404).json({ error: 'Run not found' });

    const agents = await query(
      `SELECT agent_name, status, output, confidence, cost_usd, duration_ms, error, created_at
       FROM agent_runs WHERE pipeline_run_id = $1 ORDER BY created_at`,
      [req.params.id]
    );
    const posts = await query(
      `SELECT platform, external_post_id, published_at, metrics
       FROM published_posts WHERE pipeline_run_id = $1`,
      [req.params.id]
    );

    res.json({ run: run.rows[0], agents: agents.rows, posts: posts.rows });
  } catch (err) { next(err); }
});

// ---------------- Pipeline ----------------

// Approve a needs_review run -> publish it now with whatever assets exist.
app.post('/pipeline/:id/approve', async (req, res, next) => {
  try {
    const { approvePipelineRun } = require('./orchestrator/contentPipeline');
    const result = await approvePipelineRun(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Stop a running/pending run. Agents already in flight finish, but the
// pipeline aborts at its next checkpoint and nothing gets published.
app.post('/pipeline/:id/cancel', async (req, res, next) => {
  try {
    const r = await query(
      `UPDATE content_pipeline_runs SET status = 'cancelled', updated_at = now()
       WHERE id = $1 AND status IN ('pending','running') RETURNING id`,
      [req.params.id]
    );
    if (!r.rows.length) return res.status(400).json({ error: 'Run not found or not currently running' });
    res.json({ id: req.params.id, status: 'cancelled' });
  } catch (err) { next(err); }
});

// Reject a needs_review run -> mark rejected, never publishes.
app.post('/pipeline/:id/reject', async (req, res, next) => {
  try {
    const r = await query(
      `UPDATE content_pipeline_runs SET status = 'rejected', updated_at = now()
       WHERE id = $1 AND status = 'needs_review' RETURNING id`,
      [req.params.id]
    );
    if (!r.rows.length) return res.status(400).json({ error: 'Run not found or not in needs_review' });
    res.json({ id: req.params.id, status: 'rejected' });
  } catch (err) { next(err); }
});

app.post('/pipeline/run', async (req, res, next) => {
  try {
    const { brand, topic, region, platforms, format } = req.body || {};
    if (!brand) return res.status(400).json({ error: 'brand is required' });

    // A full run takes minutes (image gen, video render, IG container processing),
    // so don't hold the HTTP connection open — return the id and let the
    // dashboard poll.
    runContentPipeline({ brand, topic, region, platforms, format }).catch((err) =>
      console.error('[pipeline] run failed:', err.message)
    );

    res.json({ status: 'started' });
  } catch (err) { next(err); }
});

app.get('/pipeline/:id', async (req, res, next) => {
  try {
    const r = await query('SELECT * FROM content_pipeline_runs WHERE id = $1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Run not found' });
    res.json(r.rows[0]);
  } catch (err) { next(err); }
});

// ---------------- Webhooks ----------------
// NOTE: this sits behind requireAuth, so Meta cannot reach it as-is. When you
// wire the real Meta webhook, move this route ABOVE `app.use(requireAuth)` and
// verify Meta's X-Hub-Signature-256 header instead of using a session.
app.post('/webhook/engagement', async (req, res, next) => {
  try {
    const result = await handleEngagementEvent(req.body || {});
    res.json(result);
  } catch (err) { next(err); }
});

// Central error handler — no route should leak a stack trace to the browser.
app.use((err, req, res, _next) => {
  console.error('[server]', err.message);
  res.status(500).json({ error: err.message });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`[server] listening on port ${PORT}`));
