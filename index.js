require('dotenv').config();
const express = require('express');
const { runContentPipeline } = require('./orchestrator/contentPipeline');
const { handleEngagementEvent } = require('./orchestrator/engagementWorkflow');

const app = express();
app.use(express.json());

/**
 * Kick off a full content pipeline run.
 * Body: { brand: 'usmanpura_imaging', topic?: string, platforms: ['instagram','facebook'] }
 *
 * Fire-and-check pattern: returns immediately with pipelineRunId; poll
 * GET /pipeline/:id for status, or check WhatsApp/dashboard once "done".
 */
app.post('/pipeline/run', async (req, res) => {
  try {
    const { brand, topic, region, platforms, format } = req.body;
    if (!brand) return res.status(400).json({ error: 'brand is required' });

    // Don't block the HTTP response on a multi-minute pipeline run
    runContentPipeline({ brand, topic, region, platforms, format }).catch((err) => {
      console.error('[pipeline] run failed:', err.message);
    });

    res.json({ status: 'started', message: 'Pipeline running in background — check logs or Postgres content_pipeline_runs for status.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/pipeline/:id', async (req, res) => {
  const { query } = require('./db/db');
  const result = await query('SELECT * FROM content_pipeline_runs WHERE id = $1', [req.params.id]);
  if (result.rows.length === 0) return res.status(404).json({ error: 'not found' });
  res.json(result.rows[0]);
});

/**
 * Webhook receiver for platform comment/DM events.
 * TODO: wire this to your actual Meta Graph API webhook subscription
 * (comments/messages) — this route is the entry point Meta will POST to.
 * Verify Meta's webhook signature here before trusting the payload.
 */
app.post('/webhook/engagement', async (req, res) => {
  try {
    const { platform, message_text, contact_handle, contact_phone, contact_name } = req.body;
    const result = await handleEngagementEvent({ platform, message_text, contact_handle, contact_phone, contact_name });
    res.json(result);
  } catch (err) {
    console.error('[webhook] engagement handling failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`[server] listening on port ${PORT}`));
