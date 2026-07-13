require('dotenv').config();
const cron = require('node-cron');
const { getAgent } = require('./agentRegistry');

/**
 * SCHEDULER — Stage 5, batch/scheduled (not triggered by pipeline events).
 * Deploy this as its own small Render service (or a Render Cron Job if you
 * prefer their native scheduler instead of node-cron).
 */

// Daily at 8:00 AM IST — pull metrics for posts published in the last 24h
cron.schedule('0 8 * * *', async () => {
  console.log('[scheduler] running analytics_agent...');
  const analyticsAgent = getAgent('analytics_agent');
  const result = await analyticsAgent({ input: { since_days: 1 }, context: {} });
  console.log('[scheduler] analytics_agent result:', JSON.stringify(result.output));
}, { timezone: 'Asia/Kolkata' });

// Weekly on Monday at 9:00 AM IST — revenue/budget reallocation recommendation
cron.schedule('0 9 * * 1', async () => {
  console.log('[scheduler] running revenue_optimization_agent...');
  const revenueAgent = getAgent('revenue_optimization_agent');
  const result = await revenueAgent({ input: { period: 'last_7_days' }, context: {} });
  console.log('[scheduler] revenue_optimization_agent result:', JSON.stringify(result.output));

  // TODO: pipe result.output.recommendation to WhatsApp/email so Abhishek/Amit
  // see it without logging into a dashboard — matches your WhatsApp-first style.
}, { timezone: 'Asia/Kolkata' });

console.log('[scheduler] cron jobs registered (analytics: daily 8am IST, revenue: weekly Mon 9am IST)');
