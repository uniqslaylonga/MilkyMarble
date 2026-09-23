// src/routes/authRoutes.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');
const supabase = require('../config/supabase');
const { sendPromoWelcomeEmail } = require('../services/mailServices');

// This must match the client_id used by the Google Sign-In button in
// public/customer/js/login.js and public/customer/js/signup.js. Override via
// the GOOGLE_CLIENT_ID env var if you swap in your own Google Cloud project.
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID
  || '1077352091553-6d77b0rtu3km8r1har7ra3lsmbf5en35.apps.googleusercontent.com';
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

// 1. POST /api/auth/signup
router.post('/signup', async (req, res) => {
  try {
    const { fullname, username, email, password } = req.body;

    if (!fullname || !username || !email || !password) {
      return res.status(400).json({
        status: 'error',
        message: 'All fields are required.'
      });
    }

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
      .select('id, username, email, password_hash, full_name, user_type, is_active')
      .eq('username', cleanUsername)
      .in('user_type', ['employee', 'admin', 'ceo'])
      .maybeSingle();

    if (userErr) throw userErr;

    if (!account) {
      return res.status(400).json({ status: 'error', message: 'Invalid username: Employee account not found.' });
    }

    if (!account.is_active) {
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

    let targetUrl = 'login.html';
    if (roleNames.includes('Sales Officer') || cleanUsername === 'salesofficer1') {
      targetUrl = 'salesOfficer/dashboard.html';
    } else if (roleNames.includes('Finance Officer') || cleanUsername === 'financeofficer1') {
      targetUrl = 'financeOfficer/dashboard.html';
    } else if (roleNames.includes('Production Supervisor') || cleanUsername === 'productionofficer1') {
      targetUrl = 'productionSupervisor/dashboard.html';
    } else if (roleNames.includes('Procurement & Inventory') || cleanUsername === 'inventoryofficer1') {
      targetUrl = 'inventoryOfficer/dashboard.html';
    } else if (account.user_type === 'admin' || account.user_type === 'ceo') {
      // No dedicated admin/CEO dashboard exists yet — reuse the finance
      // dashboard for now since it's the closest thing to a company-wide
      // overview (revenue, budget, expenses) among the existing pages.
      targetUrl = 'financeOfficer/dashboard.html';
    }

    return res.json({
      status: 'success',
      message: 'Login successful.',
      redirectUrl: targetUrl,
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