const { defineAgent } = require('../orchestrator/agentContract');

/**
 * INSTAGRAM PUBLISHER — Meta Graph API
 * Input:  { brand, caption, hashtags, media_url, media_type: 'reel'|'image' }
 * Output: { external_post_id, permalink }
 *
 * Meta publishing is ALWAYS two steps:
 *   1. create a media container  (POST /{ig-user-id}/media)
 *   2. publish that container    (POST /{ig-user-id}/media_publish)
 * For REELS the container is processed asynchronously, so between the two we
 * must poll status_code until FINISHED — publishing too early just fails.
 *
 * Env: META_GRAPH_API_TOKEN, META_IG_BUSINESS_ID
 */
const GRAPH = 'https://graph.facebook.com/v21.0';

module.exports = defineAgent('instagram_publisher', async (input) => {
  const { caption, hashtags = [], media_url, media_type = 'reel' } = input;
  const token = process.env.META_GRAPH_API_TOKEN;
  const igId = process.env.META_IG_BUSINESS_ID;

  if (!token || !igId) throw new Error('META_GRAPH_API_TOKEN / META_IG_BUSINESS_ID not set');
  if (!media_url) throw new Error('instagram_publisher requires media_url');
  if (!caption) throw new Error('instagram_publisher requires caption');

  const fullCaption = `${caption}\n\n${hashtags.join(' ')}`.trim();

  // --- Step 1: create container ---
  const createParams = new URLSearchParams({ caption: fullCaption, access_token: token });
  if (media_type === 'reel') {
    createParams.set('media_type', 'REELS');
    createParams.set('video_url', media_url);
  } else {
    createParams.set('image_url', media_url);
  }

  const createRes = await fetch(`${GRAPH}/${igId}/media`, { method: 'POST', body: createParams });
  if (!createRes.ok) throw new Error(`IG container error (${createRes.status}): ${await createRes.text()}`);

  const { id: containerId } = await createRes.json();
  if (!containerId) throw new Error('IG returned no container id');

  // --- Step 2: wait for processing (reels/video only) ---
  if (media_type === 'reel') await waitForContainer(containerId, token);

  // --- Step 3: publish ---
  const pubRes = await fetch(`${GRAPH}/${igId}/media_publish`, {
    method: 'POST',
    body: new URLSearchParams({ creation_id: containerId, access_token: token }),
  });
  if (!pubRes.ok) throw new Error(`IG publish error (${pubRes.status}): ${await pubRes.text()}`);

  const { id: postId } = await pubRes.json();

  // Fetch the permalink so we can store something a human can actually click.
  let permalink = null;
  try {
    const permRes = await fetch(`${GRAPH}/${postId}?fields=permalink&access_token=${token}`);
    if (permRes.ok) permalink = (await permRes.json()).permalink;
  } catch { /* permalink is nice-to-have, not worth failing the publish over */ }

  return {
    output: { external_post_id: postId, permalink, caption_used: fullCaption },
    confidence: 0.95,
    cost: { tokens: 0, usd: 0 },
  };
});

async function waitForContainer(containerId, token, timeoutMs = 300000, intervalMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, intervalMs));

    const res = await fetch(`${GRAPH}/${containerId}?fields=status_code,status&access_token=${token}`);
    if (!res.ok) throw new Error(`IG container status check failed (${res.status})`);

    const { status_code, status } = await res.json();
    if (status_code === 'FINISHED') return;
    if (status_code === 'ERROR') throw new Error(`IG container processing failed: ${status || 'unknown'}`);
    // IN_PROGRESS / PUBLISHED -> keep waiting
  }
  throw new Error('IG container did not finish processing in time');
}
