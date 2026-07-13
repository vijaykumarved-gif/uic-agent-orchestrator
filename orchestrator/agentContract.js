const { v4: uuidv4 } = require('uuid');
const { logAgentRun } = require('../db/db');

/**
 * Wraps an agent's core logic function with the standard contract:
 * - consistent request/response shape
 * - automatic timing
 * - automatic logging to agent_runs table
 * - automatic error capture (agent errors never crash the worker)
 *
 * @param {string} agentName - e.g. 'trend_agent'
 * @param {function} coreFn - async (input, context) => output   (your actual agent logic)
 */
function defineAgent(agentName, coreFn) {
  return async function runAgent(request) {
    const { task_id = uuidv4(), input, context = {} } = request;
    const startedAt = Date.now();
    let response;

    try {
      const result = await coreFn(input, context);
      const durationMs = Date.now() - startedAt;

      response = {
        task_id,
        agent: agentName,
        status: 'success',
        output: result.output ?? result,
        confidence: result.confidence ?? null,
        cost: result.cost ?? { tokens: 0, usd: 0 },
        duration_ms: durationMs,
        error: null,
      };
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      response = {
        task_id,
        agent: agentName,
        status: 'failed',
        output: null,
        confidence: null,
        cost: { tokens: 0, usd: 0 },
        duration_ms: durationMs,
        error: err.message || String(err),
      };
    }

    // Best-effort logging — never let a logging failure break the agent response
    if (context.pipelineRunId) {
      try {
        await logAgentRun({
          pipelineRunId: context.pipelineRunId,
          agentName,
          input,
          output: response.output,
          status: response.status,
          confidence: response.confidence,
          costUsd: response.cost?.usd,
          durationMs: response.duration_ms,
          error: response.error,
        });
      } catch (logErr) {
        console.error(`[${agentName}] failed to log agent_run:`, logErr.message);
      }
    }

    return response;
  };
}

module.exports = { defineAgent };
