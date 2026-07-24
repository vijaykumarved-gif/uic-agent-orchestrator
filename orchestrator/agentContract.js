const { v4: uuidv4 } = require('uuid');
const { logAgentRun, markAgentRunning, completeAgentRun } = require('../db/db');

/**
 * Wraps an agent's core logic function with the standard contract:
 * - consistent request/response shape
 * - automatic timing
 * - LIVE status: inserts a 'running' row when the agent starts, updates it on
 *   finish — this is what powers the dashboard's real-time activity panel
 * - automatic error capture (agent errors never crash the worker)
 */
function defineAgent(agentName, coreFn) {
  return async function runAgent(request) {
    const { task_id = uuidv4(), input, context = {} } = request;
    const startedAt = Date.now();

    // Mark as running FIRST so the dashboard sees it live.
    let rowId = null;
    if (context.pipelineRunId) {
      try {
        rowId = await markAgentRunning({ pipelineRunId: context.pipelineRunId, agentName, input });
      } catch (e) {
        console.error(`[${agentName}] failed to mark running:`, e.message);
      }
    }

    let response;
    try {
      const result = await coreFn(input, context);
      const durationMs = Date.now() - startedAt;
      response = {
        task_id, agent: agentName, status: 'success',
        output: result.output ?? result,
        confidence: result.confidence ?? null,
        cost: result.cost ?? { tokens: 0, usd: 0 },
        duration_ms: durationMs, error: null,
      };
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      response = {
        task_id, agent: agentName, status: 'failed',
        output: null, confidence: null,
        cost: { tokens: 0, usd: 0 },
        duration_ms: durationMs, error: err.message || String(err),
      };
    }

    // Best-effort logging — never let a logging failure break the agent response
    if (context.pipelineRunId) {
      try {
        const payload = {
          output: response.output, status: response.status,
          confidence: response.confidence, costUsd: response.cost?.usd,
          durationMs: response.duration_ms, error: response.error,
        };
        if (rowId) await completeAgentRun({ id: rowId, ...payload });
        else await logAgentRun({ pipelineRunId: context.pipelineRunId, agentName, input, ...payload });
      } catch (logErr) {
        console.error(`[${agentName}] failed to log agent_run:`, logErr.message);
      }
    }

    return response;
  };
}

module.exports = { defineAgent };
