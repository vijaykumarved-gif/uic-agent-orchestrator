/**
 * MEDIA STORAGE
 *
 * Why this exists: Meta Graph API, YouTube, and LinkedIn all publish media by
 * FETCHING A PUBLIC URL — you cannot hand them raw bytes or a local file path.
 * So every generated asset (image, audio, video) must be uploaded somewhere
 * publicly reachable first, and its URL passed downstream.
 *
 * Using Cloudinary (generous free tier, handles image+video+audio, no S3 bucket
 * policy fiddling). Swap this one file if you'd rather use S3/R2 — the agents
 * only depend on the two exported functions, not on Cloudinary itself.
 *
 * Env needed:
 *   CLOUDINARY_CLOUD_NAME
 *   CLOUDINARY_API_KEY
 *   CLOUDINARY_API_SECRET
 */

const crypto = require('crypto');

const CLOUD_NAME = () => process.env.CLOUDINARY_CLOUD_NAME;
const API_KEY = () => process.env.CLOUDINARY_API_KEY;
const API_SECRET = () => process.env.CLOUDINARY_API_SECRET;

function assertConfigured() {
  if (!CLOUD_NAME() || !API_KEY() || !API_SECRET()) {
    throw new Error(
      'Cloudinary not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET.'
    );
  }
}

/** Cloudinary signs uploads with a sha1 of the sorted params + api_secret */
function signParams(params) {
  const toSign = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  return crypto.createHash('sha1').update(toSign + API_SECRET()).digest('hex');
}

/**
 * Upload a Buffer (or base64 string) and get back a public URL.
 * @param {Buffer|string} data
 * @param {'image'|'video'|'raw'} resourceType  — audio uploads as 'video' in Cloudinary
 * @param {string} folder
 */
async function uploadBuffer(data, resourceType = 'image', folder = 'uic-agents') {
  assertConfigured();

  const timestamp = Math.floor(Date.now() / 1000);
  const signature = signParams({ folder, timestamp });

  const base64 = Buffer.isBuffer(data) ? data.toString('base64') : data;
  const mimePrefix =
    resourceType === 'image' ? 'image/png' : resourceType === 'video' ? 'video/mp4' : 'application/octet-stream';

  const form = new FormData();
  form.append('file', `data:${mimePrefix};base64,${base64}`);
  form.append('api_key', API_KEY());
  form.append('timestamp', String(timestamp));
  form.append('folder', folder);
  form.append('signature', signature);

  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${CLOUD_NAME()}/${resourceType}/upload`,
    { method: 'POST', body: form }
  );

  if (!res.ok) {
    throw new Error(`Cloudinary upload failed (${res.status}): ${await res.text()}`);
  }

  const json = await res.json();
  return json.secure_url;
}

/** Upload by pointing Cloudinary at an existing remote URL (e.g. an OpenAI image URL that expires) */
async function uploadFromUrl(url, resourceType = 'image', folder = 'uic-agents') {
  assertConfigured();

  const timestamp = Math.floor(Date.now() / 1000);
  const signature = signParams({ folder, timestamp });

  const form = new FormData();
  form.append('file', url);
  form.append('api_key', API_KEY());
  form.append('timestamp', String(timestamp));
  form.append('folder', folder);
  form.append('signature', signature);

  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${CLOUD_NAME()}/${resourceType}/upload`,
    { method: 'POST', body: form }
  );

  if (!res.ok) {
    throw new Error(`Cloudinary upload-from-url failed (${res.status}): ${await res.text()}`);
  }

  const json = await res.json();
  return json.secure_url;
}

module.exports = { uploadBuffer, uploadFromUrl };
