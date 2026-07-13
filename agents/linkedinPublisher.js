const { defineAgent } = require('../orchestrator/agentContract');

/**
 * LINKEDIN PUBLISHER — LinkedIn Posts API
 * Input:  { caption, media_url }
 * Output: { external_post_id, permalink }
 *
 * LinkedIn image posting is a 3-step dance: register the upload, PUT the bytes
 * to the returned URL, then create the post referencing the image URN.
 *
 * For UIC this channel is B2B — referring doctors, corporate health screening
 * tie-ups — so it posts the image + caption, not the reel.
 *
 * Env: LINKEDIN_ACCESS_TOKEN, LINKEDIN_ORG_ID (numeric organization id)
 */
module.exports = defineAgent('linkedin_publisher', async (input) => {
  const { caption, media_url } = input;
  const token = process.env.LINKEDIN_ACCESS_TOKEN;
  const orgId = process.env.LINKEDIN_ORG_ID;

  if (!token || !orgId) throw new Error('LINKEDIN_ACCESS_TOKEN / LINKEDIN_ORG_ID not set');
  if (!caption) throw new Error('linkedin_publisher requires caption');

  const author = `urn:li:organization:${orgId}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    'X-Restli-Protocol-Version': '2.0.0',
    'LinkedIn-Version': '202411',
    'Content-Type': 'application/json',
  };

  let imageUrn = null;

  if (media_url) {
    // Step 1: register upload
    const initRes = await fetch('https://api.linkedin.com/rest/images?action=initializeUpload', {
      method: 'POST',
      headers,
      body: JSON.stringify({ initializeUploadRequest: { owner: author } }),
    });
    if (!initRes.ok) throw new Error(`LinkedIn image init error (${initRes.status}): ${await initRes.text()}`);

    const init = await initRes.json();
    const uploadUrl = init.value?.uploadUrl;
    imageUrn = init.value?.image;

    // Step 2: PUT the actual bytes
    const imgRes = await fetch(media_url);
    if (!imgRes.ok) throw new Error(`Could not fetch media_url (${imgRes.status})`);
    const imgBuf = Buffer.from(await imgRes.arrayBuffer());

    const putRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` },
      body: imgBuf,
    });
    if (!putRes.ok) throw new Error(`LinkedIn image upload failed (${putRes.status})`);
  }

  // Step 3: create the post
  const postBody = {
    author,
    commentary: caption,
    visibility: 'PUBLIC',
    distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
    lifecycleState: 'PUBLISHED',
    isReshareDisabledByAuthor: false,
    ...(imageUrn ? { content: { media: { id: imageUrn } } } : {}),
  };

  const res = await fetch('https://api.linkedin.com/rest/posts', {
    method: 'POST',
    headers,
    body: JSON.stringify(postBody),
  });

  if (!res.ok) throw new Error(`LinkedIn publish error (${res.status}): ${await res.text()}`);

  const postId = res.headers.get('x-restli-id') || res.headers.get('x-linkedin-id');

  return {
    output: { external_post_id: postId, permalink: `https://www.linkedin.com/feed/update/${postId}` },
    confidence: 0.85,
    cost: { tokens: 0, usd: 0 },
  };
});
