const { Queue, FlowProducer, QueueEvents } = require('bullmq');
const IORedis = require('ioredis');

const connection = new IORedis(process.env.REDIS_URL, {
  maxRetriesPerRequest: null, // required by BullMQ
});

const AGENT_QUEUE_NAME = 'agent-tasks';

// Every agent job goes on this one queue; the worker looks up which agent to
// run from job.name. Keeping one queue (rather than 20) keeps concurrency /
// scaling config in one place — you scale workers, not queues.
const agentQueue = new Queue(AGENT_QUEUE_NAME, { connection });

// FlowProducer lets us define parent/child job trees: children run first,
// their results are available to the parent. This is how we encode
// "Distribution depends on Creation depends on Intelligence".
const flowProducer = new FlowProducer({ connection });

// QueueEvents is the correct BullMQ mechanism for a producer process to await
// job completion (job.waitUntilFinished needs this). A plain Job object
// returned from .add() does NOT refresh its own state/returnvalue as the
// worker processes it elsewhere — polling job.getState() on that stale
// instance will loop forever without this.
const queueEvents = new QueueEvents(AGENT_QUEUE_NAME, { connection });

module.exports = { connection, agentQueue, flowProducer, queueEvents, AGENT_QUEUE_NAME };
