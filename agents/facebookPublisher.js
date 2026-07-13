const { defineAgent } = require('../orchestrator/agentContract');

/**
 * FACEBOOK PUBLISHER — Meta Graph API
 * Input:  { caption, media_url, media_type: 'reel'|'image' }
 * Output: { external_post_id, permalink }
 *
 * Env: META_PAGE_ACCESS_TOKEN, META_PAGE_ID
 * NOTE: a PAGE access token is required here, not a user token.
 */
const GRAPH = 'https://graph.facebook.com/v21.0';

module.exports = defineAgent('facebook_publisher', async (input) => {
  const { caption, hashtags = [], media_url, media_type = 'image' } = input;
  const token = process.env.META_PAGE_ACCESS_TOKEN;
  const pageId = process.env.META_PAGE_ID;

  if (!token || !pageId) throw new Error('META_PAGE_ACCESS_TOKEN / META_PAGE_ID not set');
  if (!media_url) throw new Error('facebook_publisher requires media_url');

  const message = `${caption}\n\n${hashtags.join(' ')}`.trim();

  // Videos and photos go to different Graph edges.
  const endpoint = media_type === 'reel' ? 'videos' : 'photos';
  const params = new URLSearchParams({ access_token: token });
  if (media_type === 'reel') {
    params.set('file_url', media_url);
    params.set('description', message);
  } else {
    params.set('url', media_url);
    params.set('caption', message);
  }

  const res = await fetch(`${GRAPH}/${pageId}/${endpoint}`, { method: 'POST', body: params });
  if (!res.ok) throw new Error(`FB publish error (${res.status}): ${await res.text()}`);

  const data = await res.json();
  const postId = data.post_id || data.id;

  return {
    output: { external_post_id: postId, permalink: `https://facebook.com/${postId}` },
    confidence: 0.9,
    cost: { tokens: 0, usd: 0 },
  };
});
