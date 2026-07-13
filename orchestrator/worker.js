require('dotenv').config();
const { Worker } = require('bullmq');
const { connection, AGENT_QUEUE_NAME } = require('./queue');
const { getAgent } = require('./agentRegistry');

/**
 * This is the process that actually runs agents. Deploy this as a SEPARATE
 * Render service (Background Worker type) alongside your existing web
 * service — they share the same Redis + Postgres.
 *
 * Scale this independently: e.g. run 3 instances if Image/Video Agent calls
 * become your bottleneck, without touching the web/API service at all.
 */
const worker = new Worker(
  AGENT_QUEUE_NAME,
  async (bullJob) => {
    // Flow "root" nodes are just aggregation points, not real agent work.
    if (bullJob.name === '__stage_root__') {
      return { agent: '__stage_root__', status: 'success', output: {} };
    }

    const agentFn = getAgent(bullJob.name);
    const { input, context } = bullJob.data;

    const response = await agentFn({ task_id: bullJob.id, input, context });

    // response.agent is set for downstream consumers reading getChildrenValues()
    return { ...response, agent: bullJob.name };
  },
  {
    connection,
    concurrency: parseInt(process.env.WORKER_CONCURRENCY || '5', 10),
  }
);

worker.on('completed', (job) => {
  console.log(`[worker] ${job.name} completed (job ${job.id})`);
});

worker.on('failed', (job, err) => {
  console.error(`[worker] ${job?.name} FAILED (job ${job?.id}):`, err.message);
});

console.log(`[worker] listening on queue "${AGENT_QUEUE_NAME}" (concurrency=${worker.opts.concurrency})`);

module.exports = worker;
