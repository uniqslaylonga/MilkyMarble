// src/routes/authRoutes.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');
const supabase = require('../config/supabase');
const { sendPromoWelcomeEmail, sendSignupVerificationEmail } = require('../services/mailServices');
const { setStaffCookie } = require('../middleware/staffAuth');
const { logActivity } = require('../utils/activityLog');

// This must match the client_id used by the Google Sign-In button in
// public/customer/js/login.js and public/customer/js/signup.js. Override via
// the GOOGLE_CLIENT_ID env var if you swap in your own Google Cloud project.
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID
  || '1077352091553-6d77b0rtu3km8r1har7ra3lsmbf5en35.apps.googleusercontent.com';
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

// ---------------------------------------------------------------------------
// Signup email verification
//
// Flow: /signup/request-code validates the form, emails a 6-digit code and
// returns a signed token. /signup only creates the account when it receives
// that token together with the correct code, so an email address can't be
// registered without proving the person owns it.
//
// The token is stateless (HMAC-signed, holds only a hash of the code), so it
// works on Vercel serverless where in-memory state isn't shared between
// instances. Set SESSION_SECRET in production for a strong signing key.
// ---------------------------------------------------------------------------
const VERIFY_SECRET = process.env.SESSION_SECRET
  || (process.env.SMTP_PASS ? `mm-signup-${process.env.SMTP_PASS}` : 'mm-signup-dev-secret');
const VERIFY_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 30 * 1000;
const MAX_CODE_ATTEMPTS = 5;

// Best-effort throttles (per server instance).
const resendTimes = new Map();
const failedAttempts = new Map();

const hmac = (data) => crypto.createHmac('sha256', VERIFY_SECRET).update(data).digest('base64url');
const codeHash = (email, code) => hmac(`code:${email}:${code}`);
const safeEqual = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

function createVerifyToken(email, username, code) {
  const payload = Buffer.from(JSON.stringify({
    e: email,
    u: username.toLowerCase(),
    h: codeHash(email, code),
    exp: Date.now() + VERIFY_TTL_MS
  })).toString('base64url');
  return `${payload}.${hmac(payload)}`;
}

function readVerifyToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  if (!safeEqual(sig || '', hmac(payload))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return data && data.exp > Date.now() ? data : null;
  } catch {
    return null;
  }
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const escapeLike = (v) => v.replace(/[%_\\]/g, '\\$&');

// Returns an error message if the email/username is taken, otherwise null.
async function findSignupConflict(email, username) {
  const { data: byEmail, error: e1 } = await supabase
    .from('users').select('id').ilike('email', escapeLike(email)).limit(1);
  if (e1) throw e1;
  if (byEmail && byEmail.length) return 'Email or username is already registered.';

  const { data: byName, error: e2 } = await supabase
    .from('users').select('id').ilike('username', escapeLike(username)).limit(1);
  if (e2) throw e2;
  if (byName && byName.length) return 'Email or username is already registered.';

  return null;
}

function validateSignupFields({ fullname, username, email, password }) {
  if (!fullname || !username || !email || !password) return 'All fields are required.';
  if (!EMAIL_PATTERN.test(String(email).trim())) return 'Please enter a valid email address.';
  if (String(password).length < 6) return 'Password must be at least 6 characters.';
  return null;
}

// 1a. POST /api/auth/signup/request-code  (step 1: email a verification code)
router.post('/signup/request-code', async (req, res) => {
  try {
    const { fullname, username, email, password } = req.body;

    const fieldError = validateSignupFields({ fullname, username, email, password });
    if (fieldError) return res.status(400).json({ status: 'error', message: fieldError });

    const cleanEmail = email.trim().toLowerCase();
    const cleanUsername = username.trim();

    const lastSent = resendTimes.get(cleanEmail) || 0;
    const wait = RESEND_COOLDOWN_MS - (Date.now() - lastSent);
    if (wait > 0) {
      return res.status(429).json({
        status: 'error',
        message: `Please wait ${Math.ceil(wait / 1000)}s before requesting another code.`
      });
    }

    const conflict = await findSignupConflict(cleanEmail, cleanUsername);
    if (conflict) return res.status(400).json({ status: 'error', message: conflict });

    const code = String(crypto.randomInt(100000, 1000000));
    const sent = await sendSignupVerificationEmail(cleanEmail, fullname.trim(), code);
    if (!sent) {
      return res.status(500).json({
        status: 'error',
        message: 'We could not send the verification email. Please check your email address and try again.'
      });
    }

    resendTimes.set(cleanEmail, Date.now());
    failedAttempts.delete(cleanEmail);

    return res.json({
      status: 'success',
      message: `We sent a 6-digit code to ${cleanEmail}.`,
      token: createVerifyToken(cleanEmail, cleanUsername, code)
    });
  } catch (err) {
    console.error('[signup/request-code] Error:', err.message);
    return res.status(500).json({ status: 'error', message: 'Something went wrong. Please try again.' });
  }
});

// 1b. POST /api/auth/signup  (step 2: verify the code, then create the account)
router.post('/signup', async (req, res) => {
  try {
    const { fullname, username, email, password, code, token } = req.body;

    const fieldError = validateSignupFields({ fullname, username, email, password });
    if (fieldError) return res.status(400).json({ status: 'error', message: fieldError });

    if (!code || !token) {
      return res.status(400).json({
        status: 'error',
        message: 'Please verify your email with the 6-digit code we sent you.'
      });
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanUsername = username.trim();

    if ((failedAttempts.get(cleanEmail) || 0) >= MAX_CODE_ATTEMPTS) {
      return res.status(429).json({
        status: 'error',
        message: 'Too many incorrect attempts. Please request a new code.'
      });
    }

    const data = readVerifyToken(token);
    if (!data) {
      return res.status(400).json({
        status: 'error',
        message: 'Your verification code has expired. Please request a new one.'
      });
    }

    const matches = data.e === cleanEmail
      && data.u === cleanUsername.toLowerCase()
      && safeEqual(data.h, codeHash(cleanEmail, String(code).trim()));

    if (!matches) {
      failedAttempts.set(cleanEmail, (failedAttempts.get(cleanEmail) || 0) + 1);
      return res.status(400).json({ status: 'error', message: 'Incorrect verification code.' });
    }

    failedAttempts.delete(cleanEmail);

    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    const { data: user, error: userErr } = await supabase
      .from('users')
      .insert([
        {
          full_name: fullname.trim(),
          username: username.trim(),
          email: email.trim().toLowerCase(),
          password_hash: hashedPassword,
          user_type: 'customer',
          is_active: true
        }
      ])
      .select()
      .single();

    if (userErr) {
      if (userErr.code === '23505') {
        return res.status(400).json({
          status: 'error',
          message: 'Email or username is already registered.'
        });
      }
      throw userErr;
    }

    const { data: customer, error: custErr } = await supabase
      .from('customers')
      .insert([
        {
          user_id: user.id,
          loyalty_points: 0,
          notify_pickup: true,
          notify_email_receipts: true,
          notify_promos: false
        }
      ])
      .select()
      .single();

    if (custErr) {
      console.error('Customer link warning:', custErr.message);
    }

    // Fire-and-forget: don't let a slow/failed email block the signup response.
    sendPromoWelcomeEmail(user.email, user.full_name).catch(err => {
      console.error('[signup] Welcome email failed:', err.message);
    });

    res.json({
      status: 'success',
      message: 'Account created successfully!',
      user: {
        id: user.id,
        customer_id: customer ? customer.id : null,
        username: user.username,
        email: user.email,
        full_name: user.full_name,
        avatar: user.avatar || 'images/account.png',
        loyalty_points: customer ? customer.loyalty_points : 0
      }
    });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// 2. POST /api/auth/google  (Sign in / sign up with Google)
router.post('/google', async (req, res) => {
  try {
    const { credential } = req.body;

    if (!credential) {
      return res.status(400).json({
        status: 'error',
        message: 'Missing Google credential.'
      });
    }

    // Verify the ID token's signature, audience, issuer, and expiry with Google.
    let payload;
    try {
      const ticket = await googleClient.verifyIdToken({
        idToken: credential,
        audience: GOOGLE_CLIENT_ID
      });
      payload = ticket.getPayload();
    } catch (verifyErr) {
      console.error('[google-auth] Token verification failed:', verifyErr.message);
      return res.status(401).json({
        status: 'error',
        message: 'Invalid or expired Google sign-in. Please try again.'
      });
    }

    if (!payload || !payload.email) {
      return res.status(401).json({ status: 'error', message: 'Google account has no email on file.' });
    }

    if (payload.email_verified === false) {
      return res.status(401).json({ status: 'error', message: 'Please verify your email with Google first.' });
    }

    const cleanEmail = payload.email.trim().toLowerCase();
    const googleFullName = (payload.name || cleanEmail.split('@')[0]).trim();
    const googleAvatar = payload.picture || '';

    // Look for an existing customer account with this email.
    let { data: user, error: userErr } = await supabase
      .from('users')
      .select('*')
      .ilike('email', cleanEmail)
      .eq('user_type', 'customer')
      .maybeSingle();

    if (userErr) throw userErr;

    if (user && !user.is_active) {
      return res.status(403).json({
        status: 'error',
        message: 'This account has been deactivated. Please contact support.'
      });
    }

    if (!user) {
      // No account yet for this Google email -> create one automatically.
      // A random password hash is stored since Google users don't set a
      // local password; they can set one later from Account Settings.
      const randomPassword = crypto.randomBytes(24).toString('hex');
      const hashedPassword = await bcrypt.hash(randomPassword, 10);

      const baseUsername = cleanEmail.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '') || 'user';
      let usernameAttempt = baseUsername;
      let attempt = 0;
      let created = null;
      let lastErr = null;

      while (attempt < 5 && !created) {
        const { data: newUser, error: insertErr } = await supabase
          .from('users')
          .insert([
            {
              full_name: googleFullName,
              username: usernameAttempt,
              email: cleanEmail,
              password_hash: hashedPassword,
              user_type: 'customer',
              is_active: true,
              avatar: googleAvatar || null
            }
          ])
          .select()
          .single();

        if (!insertErr) {
          created = newUser;
        } else if (insertErr.code === '23505') {
          attempt += 1;
          usernameAttempt = `${baseUsername}${Math.floor(1000 + Math.random() * 9000)}`;
          lastErr = insertErr;
        } else {
          throw insertErr;
        }
      }

      if (!created) {
        throw lastErr || new Error('Could not create account from Google sign-in.');
      }

      user = created;

      sendPromoWelcomeEmail(user.email, user.full_name).catch(err => {
        console.error('[google-auth] Welcome email failed:', err.message);
      });
    }

    // If the saved photo is empty or just the default placeholder (an old
    // profile-save bug could overwrite it), restore the Google photo.
    if (googleAvatar && (!user.avatar || /account\.png$/i.test(String(user.avatar).trim()))) {
      const { data: fixedRows, error: avatarFixErr } = await supabase
        .from('users')
        .update({ avatar: googleAvatar })
        .eq('id', user.id)
        .select('id');
      if (avatarFixErr) {
        console.warn('[google-auth] Could not save Google photo:', avatarFixErr.message);
      } else if (!fixedRows || fixedRows.length === 0) {
        // Update ran but changed nothing = blocked by Row Level Security.
        console.warn('[google-auth] Google photo NOT saved (0 rows updated) - set SUPABASE_SERVICE_ROLE_KEY on the server or allow updates on users.');
      } else {
        user.avatar = googleAvatar;
      }
    }

    let { data: customer } = await supabase
      .from('customers')
      .select('id, loyalty_points')
      .eq('user_id', user.id)
      .maybeSingle();

    if (!customer) {
      const { data: newCustomer } = await supabase
        .from('customers')
        .insert([{
          user_id: user.id,
          loyalty_points: 0,
          notify_pickup: true,
          notify_email_receipts: true,
          notify_promos: false
        }])
        .select()
        .single();
      customer = newCustomer;
    }

    await supabase
      .from('users')
      .update({ last_login_at: new Date().toISOString() })
      .eq('id', user.id);

    return res.json({
      status: 'success',
      message: 'Google sign-in successful!',
      user: {
        id: user.id,
        customer_id: customer ? customer.id : null,
        username: user.username,
        email: user.email,
        full_name: user.full_name,
        avatar: user.avatar || googleAvatar || 'images/account.png',
        loyalty_points: customer ? customer.loyalty_points : 0
      }
    });
  } catch (err) {
    console.error('[google-auth] Error:', err.message);
    return res.status(500).json({ status: 'error', message: 'Google sign-in failed. Please try again.' });
  }
});

// 3. POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { user_or_email, password } = req.body;

    if (!user_or_email || !password) {
      return res.status(400).json({
        status: 'error',
        message: 'Username/email and password are required.'
      });
    }

    const cleanInput = user_or_email.trim().toLowerCase();

    const { data: user, error: userErr } = await supabase
      .from('users')
      .select('*')
      .or(`email.ilike.${cleanInput},username.ilike.${cleanInput}`)
      .eq('user_type', 'customer')
      .maybeSingle();

    if (userErr) throw userErr;

    if (!user) {
      return res.status(401).json({
        status: 'error',
        message: 'Invalid username/email or password.'
      });
    }

    if (!user.is_active) {
      return res.status(403).json({
        status: 'error',
        message: 'This account has been deactivated. Please contact support.'
      });
    }

    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      return res.status(401).json({
        status: 'error',
        message: 'Invalid username/email or password.'
      });
    }

    let { data: customer } = await supabase
      .from('customers')
      .select('id, loyalty_points')
      .eq('user_id', user.id)
      .maybeSingle();

    if (!customer) {
      const { data: newCustomer } = await supabase
        .from('customers')
        .insert([{ user_id: user.id, loyalty_points: 0 }])
        .select()
        .single();
      customer = newCustomer;
    }

    await supabase
      .from('users')
      .update({ last_login_at: new Date().toISOString() })
      .eq('id', user.id);

    return res.json({
      status: 'success',
      message: 'Login successful!',
      user: {
        id: user.id,
        customer_id: customer ? customer.id : null,
        username: user.username,
        email: user.email,
        full_name: user.full_name,
        avatar: user.avatar || 'images/account.png',
        loyalty_points: customer ? customer.loyalty_points : 0
      }
    });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

// 3b. POST /api/auth/employee-login
// Was previously only defined in public/employee/server.js, a file that is
// never require()'d by the running app (server.js only mounts this file
// under /api/auth), so it never actually registered — every request fell
// through to the app.use() 404 handler at the bottom of server.js.
router.post('/employee-login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ status: 'error', message: 'Please enter both username and password.' });
    }

    const cleanUsername = username.trim();

    const { data: account, error: userErr } = await supabase
      .from('users')
      .select('id, username, email, password_hash, full_name, user_type, is_active, must_change_password')
      .eq('username', cleanUsername)
      .in('user_type', ['employee', 'admin', 'ceo'])
      .maybeSingle();

    if (userErr) throw userErr;

    if (!account) {
      logActivity(supabase, {
        req,
        actorType: 'unknown',
        action: 'auth.login_failed',
        category: 'auth',
        description: `Failed staff login attempt for unknown username "${cleanUsername}"`,
        metadata: { username: cleanUsername, reason: 'unknown_username' }
      });
      return res.status(400).json({ status: 'error', message: 'Invalid username: Employee account not found.' });
    }

    if (!account.is_active) {
      logActivity(supabase, {
        req,
        actorId: account.id,
        actorType: account.user_type,
        actorName: account.full_name,
        action: 'auth.login_blocked',
        category: 'auth',
        description: `Blocked login attempt on deactivated account "${account.full_name || cleanUsername}"`,
        targetType: 'user',
        targetId: account.id
      });
      return res.status(403).json({ status: 'error', message: 'This account has been deactivated. Contact an administrator.' });
    }

    let isPasswordValid = false;
    if (account.password_hash) {
      try {
        const normalizedHash = account.password_hash.replace(/^\$2y\$/, '$2a$').replace(/^\$2b\$/, '$2a$');
        isPasswordValid = await bcrypt.compare(password, normalizedHash);
      } catch {
        isPasswordValid = (password === account.password_hash);
      }
    }

    if (!isPasswordValid) {
      logActivity(supabase, {
        req,
        actorId: account.id,
        actorType: account.user_type,
        actorName: account.full_name,
        action: 'auth.login_failed',
        category: 'auth',
        description: `Failed staff login attempt (wrong password) for "${account.full_name || cleanUsername}"`,
        targetType: 'user',
        targetId: account.id,
        metadata: { reason: 'invalid_password' }
      });
      return res.status(400).json({ status: 'error', message: 'Invalid password. Please check your credentials.' });
    }

    // Optional role lookup (user_roles/roles tables). Soft-fails if those
    // tables don't exist yet, so login still works off the username fallback.
    let roleNames = [];
    try {
      const { data: userRoles } = await supabase
        .from('user_roles')
        .select('roles(name)')
        .eq('user_id', account.id);
      roleNames = userRoles ? userRoles.map(ur => ur.roles?.name).filter(Boolean) : [];
    } catch (roleErr) {
      console.warn('[employee-login] Role lookup skipped:', roleErr.message);
    }

    await supabase
      .from('users')
      .update({ last_login_at: new Date().toISOString() })
      .eq('id', account.id);

    // Signed httpOnly cookie - the staff API routes check this (401 without it).
    const mustChangePassword = account.must_change_password === true;
    setStaffCookie(res, { id: account.id, type: account.user_type, roles: roleNames, mustChangePassword });

    logActivity(supabase, {
      req,
      actorId: account.id,
      actorType: account.user_type,
      actorName: account.full_name,
      actorRole: roleNames[0] || null,
      action: 'auth.login',
      category: 'auth',
      description: `${account.full_name || account.username} logged in`,
      targetType: 'user',
      targetId: account.id
    });

    // The assigned role (user_roles) decides the dashboard. The old seeded
    // usernames are only a fallback for accounts that have no role at all;
    // otherwise changing an employee's role in Employee Records would be
    // ignored for those accounts.
    const hasRole = roleNames.length > 0;
    let targetUrl = 'login.html';
    if (roleNames.includes('Sales Officer') || (!hasRole && cleanUsername === 'salesofficer1')) {
      targetUrl = 'salesOfficer/dashboard.html';
    } else if (roleNames.includes('Finance Officer') || (!hasRole && cleanUsername === 'financeofficer1')) {
      targetUrl = 'financeOfficer/dashboard.html';
    } else if (roleNames.includes('Production Supervisor') || (!hasRole && cleanUsername === 'productionofficer1')) {
      targetUrl = 'productionSupervisor/dashboard.html';
    } else if (roleNames.includes('Procurement & Inventory') || (!hasRole && cleanUsername === 'inventoryofficer1')) {
      targetUrl = 'inventoryOfficer/dashboard.html';
    } else if (account.user_type === 'admin' || account.user_type === 'ceo') {
      // No dedicated admin/CEO dashboard exists yet - reuse the finance
      // dashboard for now since it's the closest thing to a company-wide
      // overview (revenue, budget, expenses) among the existing pages.
      targetUrl = 'financeOfficer/dashboard.html';
    }

    return res.json({
      status: 'success',
      message: 'Login successful.',
      // Temporary password: send them to the change-password page first.
      mustChangePassword,
      nextUrl: targetUrl,
      redirectUrl: mustChangePassword ? 'changePassword.html' : targetUrl,
      user: {
        id: account.id,
        username: account.username,
        email: account.email,
        fullName: account.full_name,
        roles: roleNames
      }
    });
  } catch (err) {
    console.error('Employee login error:', err.message);
    return res.status(500).json({ status: 'error', message: 'Internal server error during login.' });
  }
});

// 4. ALL /api/auth/logout
router.all('/logout', (req, res) => {
  res.clearCookie('remember_user', { path: '/' });
  res.clearCookie('user_id', { path: '/' });
  res.clearCookie('customer_id', { path: '/' });
  res.clearCookie('session_id', { path: '/' });

  if (req.session) {
    req.session.destroy(() => {
      res.clearCookie('connect.sid', { path: '/' });
      res.redirect('/customer/login.html?logged_out=1');
    });
  } else {
    res.redirect('/customer/login.html?logged_out=1');
  }
});

module.exports = router;