const { defineAgent } = require('../orchestrator/agentContract');

/**
 * YOUTUBE SHORTS PUBLISHER — YouTube Data API v3
 * Input:  { script, caption, hashtags, media_url }
 * Output: { external_post_id, permalink }
 *
 * YouTube needs an OAuth2 ACCESS token, and access tokens expire in ~1hr —
 * so we exchange the long-lived refresh token for a fresh one on every call.
 * (This is why there are 3 env vars, not just one key.)
 *
 * A video qualifies as a "Short" automatically if it's <=60s and vertical.
 *
 * Env: YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN
 */
module.exports = defineAgent('youtube_shorts_publisher', async (input) => {
  const { script, caption, hashtags = [], media_url } = input;
  if (!media_url) throw new Error('youtube_shorts_publisher requires media_url (a video)');

  const accessToken = await getAccessToken();

  const title = (script?.hook || caption || 'Health Update').slice(0, 95);
  const description = `${caption || ''}\n\n${hashtags.join(' ')}\n#Shorts`.trim();

  // Download the rendered video, then upload the bytes to YouTube.
  const videoRes = await fetch(media_url);
  if (!videoRes.ok) throw new Error(`Could not fetch video (${videoRes.status})`);
  const videoBuf = Buffer.from(await videoRes.arrayBuffer());

  const metadata = {
    snippet: {
      title,
      description,
      tags: hashtags.map((h) => h.replace('#', '')),
      categoryId: '22',
    },
    status: { privacyStatus: 'public', selfDeclaredMadeForKids: false },
  };

  // Multipart upload: JSON metadata part + binary video part.
  const boundary = `bnd_${Date.now()}`;
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: video/mp4\r\n\r\n`
    ),
    videoBuf,
    Buffer.from(`\r\n--${boundary}--`),
  ]);

  const res = await fetch(
    'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=multipart&part=snippet,status',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    }
  );

  if (!res.ok) throw new Error(`YouTube upload error (${res.status}): ${await res.text()}`);

  const { id } = await res.json();

  return {
    output: { external_post_id: id, permalink: `https://youtube.com/shorts/${id}` },
    confidence: 0.9,
    cost: { tokens: 0, usd: 0 },
  };
});

/** Access tokens expire hourly — always mint a fresh one from the refresh token. */
async function getAccessToken() {
  const { YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN } = process.env;
  if (!YOUTUBE_CLIENT_ID || !YOUTUBE_CLIENT_SECRET || !YOUTUBE_REFRESH_TOKEN) {
    throw new Error('YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET / YOUTUBE_REFRESH_TOKEN not set');
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: YOUTUBE_CLIENT_ID,
      client_secret: YOUTUBE_CLIENT_SECRET,
      refresh_token: YOUTUBE_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });

  if (!res.ok) throw new Error(`YouTube token refresh failed (${res.status}): ${await res.text()}`);
  return (await res.json()).access_token;
}
