// src/middleware/staffAuth.js
//
// Staff (management + employee) login guard. Same idea as the customer side:
// login sets an httpOnly cookie, and the API answers 401 when it is missing.
// The one difference: this cookie is SIGNED, so nobody can type
// "mm_staff=1" into DevTools and become the CEO.
//
// Speed: verifying is one HMAC on a ~100 byte string (microseconds), with no
// database lookup and no session store. Only staff API routes run it.
const crypto = require('crypto');

const COOKIE_NAME = 'mm_staff';
const MAX_AGE_MS = 12 * 60 * 60 * 1000; // 12 hours

let SECRET = process.env.SESSION_SECRET;
if (!SECRET) {
  // Dev fallback only. On Vercel set SESSION_SECRET, otherwise every
  // serverless instance would generate a different secret.
  SECRET = crypto.randomBytes(32).toString('hex');
  console.warn('[staffAuth] SESSION_SECRET is not set - using a temporary one. Set it in .env / Vercel.');
}

const b64 = (s) => Buffer.from(s).toString('base64url');
const sign = (payload) => crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');

function createToken({ id, type, roles, mustChangePassword }) {
  const data = { id, type, roles: roles || [], exp: Date.now() + MAX_AGE_MS };
  // Set while the account still uses an admin-issued temporary password.
  if (mustChangePassword) data.mcp = true;
  const payload = b64(JSON.stringify(data));
  return `${payload}.${sign(payload)}`;
}

function readToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  const expected = sign(payload);
  const a = Buffer.from(sig || '');
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!data.exp || data.exp < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

function setStaffCookie(res, { id, type, roles, mustChangePassword }) {
  res.cookie(COOKIE_NAME, createToken({ id, type, roles, mustChangePassword }), {
    httpOnly: true,
    sameSite: 'lax',
    secure: !!process.env.VERCEL || process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: MAX_AGE_MS
  });
}

function clearStaffCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

// requireStaff('admin', 'ceo') -> only those user types get through.
function requireStaff(...allowedTypes) {
  return (req, res, next) => {
    if (req.method === 'OPTIONS') return next();
    const session = readToken(req.cookies && req.cookies[COOKIE_NAME]);
    if (!session) {
      return res.status(401).json({ status: 'error', message: 'Authentication required. Please log in.' });
    }
    if (allowedTypes.length && !allowedTypes.includes(session.type)) {
      return res.status(403).json({ status: 'error', message: 'You do not have access to this section.' });
    }
    // Temporary-password accounts can't use any staff API until they choose
    // their own password (POST /api/staff/change-password is not behind this).
    if (session.mcp) {
      return res.status(403).json({
        status: 'error',
        code: 'PASSWORD_CHANGE_REQUIRED',
        message: 'You must change your temporary password before continuing.'
      });
    }
    req.staff = session;
    // Existing routes read "who is this" from x-user-id. Overwrite whatever the
    // browser sent with the id from the signed cookie so it can't be spoofed.
    req.headers['x-user-id'] = String(session.id);
    next();
  };
}

module.exports = { requireStaff, setStaffCookie, clearStaffCookie, readToken, COOKIE_NAME };
