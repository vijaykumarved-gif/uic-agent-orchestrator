const { flowProducer, queueEvents, AGENT_QUEUE_NAME } = require('./queue');
const { createPipelineRun, updatePipelineStage, query } = require('../db/db');

/**
 * CONTENT PIPELINE — Stages 1→2→3
 *
 * Design choice: rather than one giant nested BullMQ flow tree (which forces
 * a strict single-parent tree and gets unreadable fast), each STAGE is its
 * own small flow, and stages hand off to each other via Postgres
 * (content_pipeline_runs). This is easier to debug, easier to re-run a single
 * stage if it fails, and matches how you already think about this as a
 * pipeline with checkpoints, not one monolithic job.
 *
 * Call runContentPipeline({ brand, topic, platforms }) to kick off a full run.
 */

function job(agentName, input, context) {
  return { name: agentName, queueName: AGENT_QUEUE_NAME, data: { input, context } };
}

async function runIntelligenceStage(pipelineRunId, { brand, region }) {
  await updatePipelineStage(pipelineRunId, 'intelligence', 'running');

  const flow = await flowProducer.add({
    name: '__stage_root__',
    queueName: AGENT_QUEUE_NAME,
    data: { input: {}, context: { pipelineRunId } },
    children: [
      job('trend_agent', { brand, region }, { pipelineRunId }),
      job('competitor_agent', { competitors: [] }, { pipelineRunId }), // TODO: populate per-brand competitor handles
    ],
  });

  const results = await waitForFlowChildren(flow.job);
  const trend_source = results.find((r) => r.agent === 'trend_agent')?.output || null;

  await updatePipelineStage(pipelineRunId, 'intelligence', 'done', { trend_source });
  return { trend_source };
}

async function runCreationStage(pipelineRunId, { brand, topic, format = 'reel' }) {
  await updatePipelineStage(pipelineRunId, 'creation', 'running');

  // Script first (everything else depends on it), then fan out in parallel.
  const scriptFlow = await flowProducer.add(
    job('script_agent', { brand, topic, format }, { pipelineRunId })
  );
  const scriptResult = await waitForJob(scriptFlow.job);

  if (scriptResult.status !== 'success' || !scriptResult.output) {
    await updatePipelineStage(pipelineRunId, 'creation', 'failed');
    throw new Error(`script_agent failed, cannot continue creation stage: ${scriptResult.error || 'no output returned'}`);
  }
  const script = scriptResult.output;

  await query(`UPDATE content_pipeline_runs SET script = $1 WHERE id = $2`, [JSON.stringify(script), pipelineRunId]);

  const creationFlow = await flowProducer.add({
    name: '__stage_root__',
    queueName: AGENT_QUEUE_NAME,
    data: { input: {}, context: { pipelineRunId } },
    children: [
      job('caption_agent', { brand, script }, { pipelineRunId }),
      job('hashtag_agent', { brand, topic }, { pipelineRunId }),
      job('thumbnail_agent', { script, brand, format }, { pipelineRunId }),
      job('image_agent', { brand, prompt: script.hook }, { pipelineRunId }),
      job('video_agent', { script, brand }, { pipelineRunId }),
      job('voice_agent', { script_text: script.full_script, language: 'en' }, { pipelineRunId }),
      job('subtitle_agent', { audio_url: null, language: 'en' }, { pipelineRunId }),
      job('viral_prediction_agent', { script: script.full_script, format }, { pipelineRunId }),
    ],
  });

  const results = await waitForFlowChildren(creationFlow.job);
  const assets = {};
  const failedAgents = [];
  for (const r of results) {
    assets[r.agent] = r.output;
    if (r.status !== 'success') failedAgents.push({ agent: r.agent, error: r.error });
  }

  const viralScore = assets.viral_prediction_agent?.predicted_score ?? null;
  const lowScore = viralScore !== null && viralScore < 0.5;
  // caption_agent is required by every publisher downstream — if it failed,
  // don't silently publish with a missing caption; force human review instead.
  const captionMissing = !assets.caption_agent?.caption;
  const needsReview = lowScore || captionMissing || failedAgents.length > 0;

  if (failedAgents.length > 0) {
    console.warn(`[contentPipeline] creation stage had ${failedAgents.length} failed agent(s):`, failedAgents);
  }

  await updatePipelineStage(pipelineRunId, 'creation', needsReview ? 'needs_review' : 'done', { assets });
  return { script, assets, needsReview, failedAgents };
}

async function runDistributionStage(pipelineRunId, { brand, script, assets, platforms }) {
  await updatePipelineStage(pipelineRunId, 'distribution', 'running');

  const publisherMap = {
    instagram: 'instagram_publisher',
    facebook: 'facebook_publisher',
    youtube_shorts: 'youtube_shorts_publisher',
    linkedin: 'linkedin_publisher',
  };

  const children = platforms
    .filter((p) => publisherMap[p])
    .map((p) =>
      job(
        publisherMap[p],
        {
          brand,
          caption: assets.caption_agent?.caption,
          hashtags: assets.hashtag_agent?.hashtags || [],
          media_url: assets.video_agent?.video_url || assets.image_agent?.image_urls?.[0],
        },
        { pipelineRunId }
      )
    );

  const flow = await flowProducer.add({
    name: '__stage_root__',
    queueName: AGENT_QUEUE_NAME,
    data: { input: {}, context: { pipelineRunId } },
    children,
  });

  const results = await waitForFlowChildren(flow.job);

  for (const r of results) {
    if (r.status === 'success') {
      await query(
        `INSERT INTO published_posts (pipeline_run_id, platform, external_post_id, published_at)
         VALUES ($1, $2, $3, now())`,
        [pipelineRunId, r.agent.replace('_publisher', ''), r.output?.external_post_id]
      );
    }
  }

  await updatePipelineStage(pipelineRunId, 'done', 'success');
  return results;
}

/** Full pipeline entry point */
async function runContentPipeline({ brand, topic, region = 'Ahmedabad', platforms = ['instagram'], format = 'reel' }) {
  const pipelineRunId = await createPipelineRun({ brand, platformsTargeted: platforms });

  const { trend_source } = await runIntelligenceStage(pipelineRunId, { brand, region });
  const { script, assets, needsReview } = await runCreationStage(pipelineRunId, {
    brand,
    topic: topic || trend_source?.trends?.[0]?.topic || 'general health awareness',
    format,
  });

  if (needsReview) {
    // Stop here — a human should approve low-scoring content before it publishes.
    // This matches your existing draft/approval workflow pattern.
    return { pipelineRunId, status: 'needs_review', script, assets };
  }

  const publishResults = await runDistributionStage(pipelineRunId, { brand, script, assets, platforms });
  return { pipelineRunId, status: 'published', script, assets, publishResults };
}

// --- helpers for waiting on BullMQ flow jobs ---
// IMPORTANT: a Job instance returned by flowProducer.add()/queue.add() does
// NOT update its own .state/.returnvalue as the worker (a separate process)
// processes it — polling job.getState() on that same instance loops forever.
// job.waitUntilFinished(queueEvents) is the correct BullMQ API for a
// producer to await completion; it subscribes to the queue's event stream.

async function waitForJob(bullJob, timeoutMs = 120000) {
  try {
    const result = await bullJob.waitUntilFinished(queueEvents, timeoutMs);
    return result;
  } catch (err) {
    throw new Error(`Job "${bullJob.name}" (${bullJob.id}) did not complete: ${err.message}`);
  }
}

async function waitForFlowChildren(parentBullJob, timeoutMs = 180000) {
  // Wait for the parent (which BullMQ holds in "waiting-children" until every
  // child completes) — then read back each child's return value.
  await waitForJob(parentBullJob, timeoutMs);
  const values = await parentBullJob.getChildrenValues();
  return Object.values(values || {});
}

module.exports = { runContentPipeline };
