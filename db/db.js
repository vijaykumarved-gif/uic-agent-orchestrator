const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

async function query(text, params) {
  return pool.query(text, params);
}

/** Create a new pipeline run row, returns its id */
async function createPipelineRun({ brand, platformsTargeted = [], format = 'reel' }) {
  const res = await query(
    `INSERT INTO content_pipeline_runs (brand, platforms_targeted, format, stage, status)
     VALUES ($1, $2, $3, 'queued', 'pending') RETURNING id`,
    [brand, platformsTargeted, format]
  );
  return res.rows[0].id;
}

async function updatePipelineStage(pipelineRunId, stage, status, extra = {}) {
  const fields = ['stage', 'status', 'updated_at'];
  const values = [stage, status, new Date()];
  let setClauses = ['stage = $1', 'status = $2', 'updated_at = $3'];
  let idx = 4;
  for (const [key, val] of Object.entries(extra)) {
    setClauses.push(`${key} = $${idx}`);
    values.push(JSON.stringify(val));
    idx++;
  }
  values.push(pipelineRunId);
  await query(
    `UPDATE content_pipeline_runs SET ${setClauses.join(', ')} WHERE id = $${idx}`,
    values
  );
}

/** Log a single agent execution — call this from every agent wrapper */
async function logAgentRun({ pipelineRunId, agentName, input, output, status, confidence, costUsd, durationMs, error }) {
  await query(
    `INSERT INTO agent_runs (pipeline_run_id, agent_name, input, output, status, confidence, cost_usd, duration_ms, error)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [pipelineRunId, agentName, input ? JSON.stringify(input) : null, output ? JSON.stringify(output) : null,
      status, confidence ?? null, costUsd ?? 0, durationMs ?? null, error ?? null]
  );
}

/**
 * Insert a 'running' row the moment an agent starts, so the dashboard can show
 * live "what is executing right now". Returns the row id for completeAgentRun.
 */
async function markAgentRunning({ pipelineRunId, agentName, input }) {
  const res = await query(
    `INSERT INTO agent_runs (pipeline_run_id, agent_name, input, status)
     VALUES ($1, $2, $3, 'running') RETURNING id`,
    [pipelineRunId, agentName, input ? JSON.stringify(input) : null]
  );
  return res.rows[0].id;
}

/** Update the 'running' row with the final result once the agent finishes. */
async function completeAgentRun({ id, output, status, confidence, costUsd, durationMs, error }) {
  await query(
    `UPDATE agent_runs
     SET output = $1, status = $2, confidence = $3, cost_usd = $4, duration_ms = $5, error = $6
     WHERE id = $7`,
    [output ? JSON.stringify(output) : null, status, confidence ?? null,
      costUsd ?? 0, durationMs ?? null, error ?? null, id]
  );
}

module.exports = { pool, query, createPipelineRun, updatePipelineStage, logAgentRun, markAgentRunning, completeAgentRun };
