const crypto = require('crypto');

/**
 * Minimal auth for the dashboard. The service is on a public URL, so the
 * dashboard and the API that backs it must not be open to anyone who guesses
 * the hostname.
 *
 * Signed-cookie session (HMAC over an expiry timestamp) — no DB table, no JWT
 * dependency, and the cookie can't be forged without DASHBOARD_SECRET.
 *
 * Env: DASHBOARD_PASSWORD (required), DASHBOARD_SECRET (required)
 */
const COOKIE = 'uic_session';
const MAX_AGE_MS = 12 * 60 * 60 * 1000; // 12h

function secret() {
  const s = process.env.DASHBOARD_SECRET;
  if (!s) throw new Error('DASHBOARD_SECRET not set');
  return s;
}

function sign(expiresAt) {
  const mac = crypto.createHmac('sha256', secret()).update(String(expiresAt)).digest('hex');
  return `${expiresAt}.${mac}`;
}

function verify(token) {
  if (!token || !token.includes('.')) return false;
  const [expStr, mac] = token.split('.');
  const expected = crypto.createHmac('sha256', secret()).update(expStr).digest('hex');

  // timingSafeEqual throws on length mismatch, so guard first
  if (mac.length !== expected.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return false;

  return Date.now() < Number(expStr);
}

function parseCookies(req) {
  const raw = req.headers.cookie || '';
  return Object.fromEntries(
    raw.split(';').map((c) => {
      const [k, ...v] = c.trim().split('=');
      return [k, v.join('=')];
    })
  );
}

/** Gate everything except /health, /login and the login page itself. */
function requireAuth(req, res, next) {
  const open = ['/health', '/login', '/login.html'];
  if (open.includes(req.path)) return next();

  const token = parseCookies(req)[COOKIE];
  if (verify(token)) return next();

  // API calls get a 401; browsers get bounced to the login page.
  if (req.path.startsWith('/api/') || req.path.startsWith('/pipeline/')) {
    return res.status(401).json({ error: 'Not signed in' });
  }
  return res.redirect('/login');
}

function handleLogin(req, res) {
  const { password } = req.body || {};
  const expected = process.env.DASHBOARD_PASSWORD;

  if (!expected) return res.status(500).json({ error: 'DASHBOARD_PASSWORD not set on the server' });
  if (!password || password !== expected) {
    return res.status(401).json({ error: 'Wrong password' });
  }

  const expiresAt = Date.now() + MAX_AGE_MS;
  res.setHeader(
    'Set-Cookie',
    `${COOKIE}=${sign(expiresAt)}; HttpOnly; Path=/; Max-Age=${MAX_AGE_MS / 1000}; SameSite=Lax${
      process.env.NODE_ENV === 'production' ? '; Secure' : ''
    }`
  );
  res.json({ ok: true });
}

function handleLogout(req, res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Path=/; Max-Age=0`);
  res.json({ ok: true });
}

module.exports = { requireAuth, handleLogin, handleLogout };
