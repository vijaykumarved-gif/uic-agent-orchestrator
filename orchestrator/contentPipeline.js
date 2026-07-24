const { flowProducer, queueEvents, AGENT_QUEUE_NAME } = require('./queue');
const { createPipelineRun, updatePipelineStage, query, getRecentContent, logAgentRun } = require('../db/db');
const { closestMatch } = require('./similarity');

// Above this trigram-similarity score, a new hook is considered a repeat of an
// earlier post. Reworded-same-idea lands ~0.45-0.7; unrelated topics < 0.2.
const DUPLICATE_THRESHOLD = 0.45;

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

/**
 * Cancellation: the dashboard's Stop button sets status='cancelled' in the DB.
 * The pipeline checks this between stages/phases — agents already in flight
 * finish, but nothing further is dispatched.
 */
async function isCancelled(pipelineRunId) {
  const r = await query(`SELECT status FROM content_pipeline_runs WHERE id = $1`, [pipelineRunId]);
  return r.rows[0]?.status === 'cancelled';
}

function job(agentName, input, context) {
  return { name: agentName, queueName: AGENT_QUEUE_NAME, data: { input, context } };
}

/**
 * Voiceover language per brand. Defaults to Indian English.
 * Set VOICE_LANGUAGE=hi (or gu) to change globally, or extend this per-brand.
 */
function input_language(brand) {
  return process.env.VOICE_LANGUAGE || 'en';
}

async function runIntelligenceStage(pipelineRunId, { brand, region, recent }) {
  await updatePipelineStage(pipelineRunId, 'intelligence', 'running');

  const flow = await flowProducer.add({
    name: '__stage_root__',
    queueName: AGENT_QUEUE_NAME,
    data: { input: {}, context: { pipelineRunId } },
    children: [
      job('trend_agent', { brand, region, avoid_topics: recent.topics }, { pipelineRunId }),
      job('competitor_agent', { competitors: [] }, { pipelineRunId }), // TODO: populate per-brand competitor handles
    ],
  });

  const results = await waitForFlowChildren(flow.job);
  const trend_source = results.find((r) => r.agent === 'trend_agent')?.output || null;

  await updatePipelineStage(pipelineRunId, 'intelligence', 'done', { trend_source });
  return { trend_source };
}

async function runCreationStage(pipelineRunId, { brand, topic, format = 'reel', recent }) {
  await updatePipelineStage(pipelineRunId, 'creation', 'running');

  const recentHooks = recent?.hooks || [];

  // Script first (everything else depends on it), then fan out in parallel.
  const scriptFlow = await flowProducer.add(
    job('script_agent', { brand, topic, format, avoid_hooks: recentHooks }, { pipelineRunId })
  );
  let scriptResult = await waitForJob(scriptFlow.job);

  if (scriptResult.status !== 'success' || !scriptResult.output) {
    await updatePipelineStage(pipelineRunId, 'creation', 'failed');
    throw new Error(`script_agent failed, cannot continue creation stage: ${scriptResult.error || 'no output returned'}`);
  }
  let script = scriptResult.output;

  // --- Uniqueness check: is this hook a repeat of recent content? ---
  // If too similar, regenerate ONCE with the offending hook explicitly listed;
  // if it's STILL a repeat, let it through but flag the run for human review
  // rather than silently publishing near-duplicate content.
  let duplicateFlag = false;
  if (recentHooks.length) {
    let { max, match } = closestMatch(script.hook, recentHooks);

    if (max >= DUPLICATE_THRESHOLD) {
      console.warn(`[contentPipeline] hook too similar (${max.toFixed(2)}) to: "${match}" — regenerating once`);
      const retryFlow = await flowProducer.add(
        job('script_agent', { brand, topic, format, avoid_hooks: [...recentHooks, script.hook] }, { pipelineRunId })
      );
      const retryResult = await waitForJob(retryFlow.job);
      if (retryResult.status === 'success' && retryResult.output) {
        script = retryResult.output;
        ({ max, match } = closestMatch(script.hook, recentHooks));
      }
      duplicateFlag = max >= DUPLICATE_THRESHOLD;
    }

    // Log the check as its own step so it's visible in the dashboard timeline.
    try {
      await logAgentRun({
        pipelineRunId,
        agentName: 'uniqueness_check',
        input: { hook: script.hook, compared_against: recentHooks.length },
        output: { max_similarity: Number(max.toFixed(3)), closest_previous_hook: match, is_duplicate: duplicateFlag },
        status: duplicateFlag ? 'needs_review' : 'success',
        confidence: 1 - max,
        costUsd: 0,
        durationMs: 0,
        error: duplicateFlag ? `Still ${(max * 100).toFixed(0)}% similar to a recent post after one regeneration` : null,
      });
    } catch (e) { console.error('[contentPipeline] uniqueness log failed:', e.message); }
  }

  await query(`UPDATE content_pipeline_runs SET script = $1 WHERE id = $2`, [JSON.stringify(script), pipelineRunId]);

  // The creation stage is NOT one flat parallel fan-out — the media agents have
  // real data dependencies on each other:
  //     voice -> subtitle (needs the audio to transcribe)
  //     image + voice + subtitle -> video (needs all three to assemble)
  // Running all 8 at once (as the first version did) only "worked" because the
  // agents were stubs returning fake URLs. With real APIs, subtitle would get
  // audio_url: null and fail. So: 3 sequential phases, parallel WITHIN each phase.

  const language = input_language(brand);
  const assets = {};
  const results = [];

  // --- Phase 1: everything that only needs the script ---
  const phase1 = await flowProducer.add({
    name: '__stage_root__',
    queueName: AGENT_QUEUE_NAME,
    data: { input: {}, context: { pipelineRunId } },
    children: [
      job('caption_agent', { brand, script }, { pipelineRunId }),
      job('hashtag_agent', { brand, topic }, { pipelineRunId }),
      job('image_agent', { brand, script, prompt: script.hook }, { pipelineRunId }),
      // Voiceover only matters for video posts — an image post doesn't need it.
      ...(format === 'reel'
        ? [job('voice_agent', { script_text: script.full_script, language }, { pipelineRunId })]
        : []),
      job('viral_prediction_agent', { script: script.full_script, format }, { pipelineRunId }),
    ],
  });
  const p1 = await waitForFlowChildren(phase1.job);
  results.push(...p1);
  for (const r of p1) assets[r.agent] = r.output;

  if (await isCancelled(pipelineRunId)) return { script, assets, needsReview: false, cancelled: true };

  // --- Phase 2: needs Phase 1 outputs (audio for subtitles, image for thumbnail) ---
  const audioUrl = assets.voice_agent?.audio_url;
  const imageUrls = assets.image_agent?.image_urls || [];

  const phase2Children = [];
  if (format === 'reel') phase2Children.push(job('thumbnail_agent', { script, brand, format }, { pipelineRunId }));
  if (format === 'reel' && audioUrl) {
    phase2Children.push(job('subtitle_agent', { audio_url: audioUrl, language }, { pipelineRunId }));
  } else {
    console.warn('[contentPipeline] voice_agent produced no audio_url — skipping subtitle_agent');
  }

  if (phase2Children.length) {
    const phase2 = await flowProducer.add({
      name: '__stage_root__',
      queueName: AGENT_QUEUE_NAME,
      data: { input: {}, context: { pipelineRunId } },
      children: phase2Children,
    });
    const p2 = await waitForFlowChildren(phase2.job);
    results.push(...p2);
    for (const r of p2) assets[r.agent] = r.output;
  }

  // --- Phase 3: video needs image + voice + subtitles ---
  // If Creatomate isn't configured at all, SKIP video rather than running the
  // agent into a guaranteed failure — a missing optional integration should
  // not force every run into needs_review. The post simply ships as an image.
  const videoConfigured = !!(process.env.HEYGEN_API_KEY || process.env.CREATOMATE_API_KEY);
  if (format === 'reel' && !videoConfigured) {
    console.log('[contentPipeline] no video provider configured (HEYGEN_API_KEY / CREATOMATE_API_KEY) — publishing as image post');
  }
  if (format === 'reel' && videoConfigured && audioUrl && imageUrls.length) {
    const phase3 = await flowProducer.add(
      job(
        'video_agent',
        {
          brand,
          script,
          image_urls: imageUrls,
          audio_url: audioUrl,
          captions: assets.subtitle_agent?.captions || [],
        },
        { pipelineRunId }
      )
    );
    const videoResult = await waitForJob(phase3.job, 15 * 60 * 1000); // HeyGen renders take 2-10 min
    results.push(videoResult);
    assets[videoResult.agent] = videoResult.output;
  } else if (format === 'reel' && videoConfigured) {
    console.warn('[contentPipeline] skipping video_agent — missing image or audio');
  }

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
  // duplicateFlag: hook is still too similar to a recent post after one retry.
  const needsReview = lowScore || captionMissing || duplicateFlag || failedAgents.length > 0;

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

  const videoUrl = assets.video_agent?.video_url;
  const imageUrl = assets.image_agent?.image_urls?.[0];
  const caption = assets.caption_agent?.caption;
  const hashtags = assets.hashtag_agent?.hashtags || [];

  // Each platform wants a different asset — YouTube Shorts is video-only, and
  // LinkedIn (a B2B channel for referring doctors) reads better as image+text.
  // Sending the wrong media type here is an instant API error, so pick per platform.
  const mediaFor = {
    instagram: videoUrl ? { media_url: videoUrl, media_type: 'reel' } : { media_url: imageUrl, media_type: 'image' },
    facebook: videoUrl ? { media_url: videoUrl, media_type: 'reel' } : { media_url: imageUrl, media_type: 'image' },
    youtube_shorts: videoUrl ? { media_url: videoUrl, media_type: 'reel' } : null, // no video => cannot post a Short
    linkedin: { media_url: imageUrl, media_type: 'image' },
  };

  const skipped = [];
  const children = [];

  for (const p of platforms) {
    if (!publisherMap[p]) continue;
    const media = mediaFor[p];
    if (!media || !media.media_url) {
      skipped.push({ platform: p, reason: 'required media asset was not generated' });
      continue;
    }
    children.push(
      job(publisherMap[p], { brand, script, caption, hashtags, ...media }, { pipelineRunId })
    );
  }

  if (skipped.length) console.warn('[contentPipeline] skipped platforms:', skipped);
  if (!children.length) {
    await updatePipelineStage(pipelineRunId, 'distribution', 'failed');
    throw new Error('No platform could be published to — no usable media was generated.');
  }

  const flow = await flowProducer.add({
    name: '__stage_root__',
    queueName: AGENT_QUEUE_NAME,
    data: { input: {}, context: { pipelineRunId } },
    children,
  });

  const results = await waitForFlowChildren(flow.job, 12 * 60 * 1000); // IG processes reels for several minutes

  for (const r of results) {
    if (r.status === 'success') {
      await query(
        `INSERT INTO published_posts (pipeline_run_id, platform, external_post_id, published_at, metrics)
         VALUES ($1, $2, $3, now(), $4)`,
        [
          pipelineRunId,
          r.agent.replace('_publisher', '').replace('_shorts', '_shorts'),
          r.output?.external_post_id,
          JSON.stringify({ permalink: r.output?.permalink || null }),
        ]
      );
    } else {
      console.error(`[contentPipeline] ${r.agent} failed to publish:`, r.error);
    }
  }

  await updatePipelineStage(pipelineRunId, 'done', 'success');
  return results;
}

/** Full pipeline entry point */
async function runContentPipeline({ brand, topic, region = 'Ahmedabad', platforms = ['instagram'], format = 'reel' }) {
  const pipelineRunId = await createPipelineRun({ brand, platformsTargeted: platforms, format });

  try {
    return await runPipelineInner(pipelineRunId, { brand, topic, region, platforms, format });
  } catch (err) {
    // Never leave a crashed run stuck as "Running" forever in the dashboard —
    // mark it failed so the UI reflects reality and the user can re-run.
    try {
      const cur = await query(`SELECT status FROM content_pipeline_runs WHERE id = $1`, [pipelineRunId]);
      if (['pending', 'running'].includes(cur.rows[0]?.status)) {
        await query(
          `UPDATE content_pipeline_runs SET status = 'failed', updated_at = now() WHERE id = $1`,
          [pipelineRunId]
        );
      }
    } catch (e) { console.error('[contentPipeline] failed to mark run failed:', e.message); }
    throw err;
  }
}

async function runPipelineInner(pipelineRunId, { brand, topic, region, platforms, format }) {

  // What has this brand already posted recently? Used to steer trend/script
  // away from repeats, and by the uniqueness check afterwards.
  let recent = { hooks: [], topics: [] };
  try { recent = await getRecentContent(brand); } catch (e) { console.error('[contentPipeline] recent-content fetch failed:', e.message); }

  const { trend_source } = await runIntelligenceStage(pipelineRunId, { brand, region, recent });

  if (await isCancelled(pipelineRunId)) return { pipelineRunId, status: 'cancelled' };

  const { script, assets, needsReview } = await runCreationStage(pipelineRunId, {
    brand,
    topic: topic || trend_source?.trends?.[0]?.topic || 'general health awareness',
    format,
    recent,
  });

  if (await isCancelled(pipelineRunId)) return { pipelineRunId, status: 'cancelled' };

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

// Default waits sized for real media work: image gen ~80s, thumbnail ~60s,
// subtitles ~60s. Video (HeyGen avatar render: 2-10 min) and distribution
// (Instagram processes reel containers for several minutes) pass explicit
// larger timeouts below.
async function waitForJob(bullJob, timeoutMs = 300000) {
  try {
    const result = await bullJob.waitUntilFinished(queueEvents, timeoutMs);
    return result;
  } catch (err) {
    throw new Error(`Job "${bullJob.name}" (${bullJob.id}) did not complete: ${err.message}`);
  }
}

async function waitForFlowChildren(parentBullJob, timeoutMs = 420000) {
  // Wait for the parent (which BullMQ holds in "waiting-children" until every
  // child completes) — then read back each child's return value.
  await waitForJob(parentBullJob, timeoutMs);
  const values = await parentBullJob.getChildrenValues();
  return Object.values(values || {});
}

/**
 * Approve a run stuck in needs_review and push it through distribution.
 * Called from the dashboard's "Approve & Publish" button. Publishes with
 * whatever assets exist — a run held back by a failed thumbnail can still go
 * out as an image post; only a missing caption or missing ALL media blocks it.
 */
async function approvePipelineRun(pipelineRunId) {
  const res = await query('SELECT * FROM content_pipeline_runs WHERE id = $1', [pipelineRunId]);
  if (!res.rows.length) throw new Error('Run not found');
  const run = res.rows[0];

  if (run.status !== 'needs_review') {
    throw new Error(`Run is "${run.status}", not "needs_review" — nothing to approve.`);
  }

  const script = run.script;
  const assets = run.assets || {};

  if (!assets.caption_agent?.caption) {
    throw new Error('Cannot publish: the caption was never generated. Re-run the pipeline instead.');
  }
  const hasMedia = assets.video_agent?.video_url || assets.image_agent?.image_urls?.length;
  if (!hasMedia) {
    throw new Error('Cannot publish: no image or video was generated. Re-run the pipeline instead.');
  }

  const platforms = run.platforms_targeted?.length ? run.platforms_targeted : ['instagram'];
  const publishResults = await runDistributionStage(pipelineRunId, {
    brand: run.brand,
    script,
    assets,
    platforms,
  });

  return { pipelineRunId, status: 'published', publishResults };
}

module.exports = { runContentPipeline, approvePipelineRun };
