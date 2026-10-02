// server.js - Milky Marble Express Backend
require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const nodemailer = require('nodemailer');
const cookieParser = require('cookie-parser');
const compression = require('compression');

// Import Routes
const authRoutes = require('./src/routes/authRoutes');
const orderRoutes = require('./src/routes/orderRoutes');
const paymentRoutes = require('./src/routes/paymentRoutes');
const employeeRoutes = require('./src/routes/employeeRoutes');
const { requireStaff, setStaffCookie, clearStaffCookie, readToken, COOKIE_NAME } = require('./src/middleware/staffAuth');
const { logActivity } = require('./src/utils/activityLog');

let customerRoutes = null;
try {
  customerRoutes = require('./src/routes/customerRoutes');
} catch (e) {
  try {
    customerRoutes = require('./routes/customerRoutes');
  } catch (err) {}
}

let bcrypt = null;
try {
  bcrypt = require('bcrypt');
} catch {
  try {
    bcrypt = require('bcryptjs');
  } catch {
    console.warn('[Notice] Neither bcrypt nor bcryptjs is installed. Run npm install bcrypt');
  }
}

// Multer Setup para sa Avatar Uploads
// Uses in-memory storage (not disk): Vercel's filesystem is read-only
// outside os.tmpdir(), and even /tmp there doesn't persist across
// invocations/instances, so any avatar written to local disk would 404
// as soon as a different serverless instance served the GET. Instead we
// keep the file in memory just long enough to stream it into Supabase
// Storage (see uploadAvatarToSupabase below), which is durable and works
// identically locally and on Vercel.
let upload = null;
try {
  const multer = require('multer');
  upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
} catch (e) {
  console.warn('[Notice] multer is not installed.');
}

const AVATAR_BUCKET = process.env.SUPABASE_AVATAR_BUCKET || 'avatars';

// Uploads a file buffer to Supabase Storage and returns its public URL.
// Used for every avatar upload path (customer self-service, staff
// self-service, and admin add/edit employee) so avatars persist reliably
// in production instead of relying on local/serverless disk.
async function uploadAvatarToSupabase(buffer, originalName, mimeType) {
  if (!supabase) throw new Error('Database disconnected.');
  const ext = (path.extname(originalName || '') || '.png').toLowerCase();
  const fileName = `avatar_${Date.now()}_${Math.random().toString(36).substring(2, 7)}${ext}`;
  const { error: uploadErr } = await supabase.storage
    .from(AVATAR_BUCKET)
    .upload(fileName, buffer, {
      contentType: mimeType || 'image/png',
      upsert: false
    });
  if (uploadErr) throw uploadErr;

  const { data: publicData } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(fileName);
  if (!publicData || !publicData.publicUrl) {
    throw new Error('Could not resolve public URL for uploaded avatar.');
  }
  return publicData.publicUrl;
}

const app = express();
const PORT = process.env.PORT || 3000;

const emailOtpStore = new Map();
const passwordOtpStore = new Map();
const memoryCartStore = new Map();

// ==========================================
// NODEMAILER TRANSPORTER SETUP
// ==========================================
const emailUser = process.env.EMAIL_USER || process.env.MAIL_USER || process.env.SMTP_USER;
const emailPass = process.env.EMAIL_PASS || process.env.MAIL_PASS || process.env.SMTP_PASS;

const transporter = nodemailer.createTransport({
  service: 'gmail',
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: {
    user: emailUser,
    pass: emailPass
  }
});

transporter.verify((error) => {
  if (error) {
    console.warn('[SMTP Warning] Email service not ready:', error.message);
  } else {
    console.log('[SMTP Ready] Nodemailer is ready to send emails.');
  }
});

// ==========================================
// SUPABASE CLIENT SETUP
// ==========================================
let supabase = null;
try {
  const { createClient } = require('@supabase/supabase-js');
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (supabaseUrl && supabaseKey) {
    supabase = createClient(supabaseUrl, supabaseKey);
  }
} catch (e) {
  console.warn('[Notice] @supabase/supabase-js not loaded.');
}

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Credentials', 'true');
  } else {
    res.header('Access-Control-Allow-Origin', '*');
  }
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, x-customer-id, x-session-id');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(compression());
app.use(cookieParser());
app.use(express.json({
  limit: '15mb',
  verify: (req, res, buf) => { req.rawBody = buf; }
}));
app.use(express.urlencoded({ limit: '15mb', extended: true }));

// ==========================================
// STAFF LOGIN GUARD (management + employee APIs)
// Only these paths run the check (one cheap HMAC, no DB call), so customer
// pages, images, CSS and JS are untouched.
// ==========================================
app.post('/api/staff/logout', (req, res) => {
  clearStaffCookie(res);
  return res.json({ status: 'success' });
});
app.use('/api/admin', requireStaff('admin', 'ceo'));
app.use('/api/ceo', requireStaff('ceo'));
app.use(
  ['/api/sales-officer', '/api/finance-officer', '/api/procurement-officer', '/api/production-supervisor'],
  requireStaff('employee', 'admin', 'ceo')
);

// ==========================================
// EMPLOYEE PASSWORD TICKETS
// An employee who forgot their password submits a ticket from the employee
// login page. An admin sees it in Employee Records, verifies the person, and
// issues a new temporary password. Table: sql/password_reset_tickets.sql
// ==========================================
const TICKET_PW_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'; // no look-alikes (0/O, 1/l/I)
function generateTempPassword(length = 10) {
  const crypto = require('crypto');
  let out = '';
  for (let i = 0; i < length; i++) out += TICKET_PW_ALPHABET[crypto.randomInt(TICKET_PW_ALPHABET.length)];
  return out;
}

// PUBLIC (employee is logged out): submit a ticket.
app.post('/api/staff/password-ticket', async (req, res) => {
  try {
    if (!supabase) return res.status(503).json({ status: 'error', message: 'Database service unavailable.' });

    const username = String((req.body && req.body.username) || '').trim();
    const note = String((req.body && req.body.note) || '').trim().slice(0, 300);
    if (!username) {
      return res.status(400).json({ status: 'error', message: 'Please enter your username.' });
    }

    const { data: account, error: lookupErr } = await supabase
      .from('users')
      .select('id, username, full_name, is_active')
      .eq('username', username)
      .eq('user_type', 'employee')
      .maybeSingle();
    if (lookupErr) throw lookupErr;

    if (!account) {
      return res.status(404).json({ status: 'error', message: 'We could not find an employee account with that username.' });
    }
    if (!account.is_active) {
      return res.status(403).json({ status: 'error', message: 'This account has been deactivated. Contact an administrator.' });
    }

    // One open ticket per employee, so the admin's list can't be spammed.
    const { data: existing, error: existingErr } = await supabase
      .from('password_reset_tickets')
      .select('id')
      .eq('user_id', String(account.id))
      .eq('status', 'open')
      .limit(1);
    if (existingErr) throw existingErr;
    if (existing && existing.length > 0) {
      return res.json({ status: 'success', already_pending: true, message: 'You already have a pending request. Please let your admin know.' });
    }

    const { error: insertErr } = await supabase.from('password_reset_tickets').insert({
      user_id: String(account.id),
      username: account.username,
      full_name: account.full_name || null,
      note: note || null
    });
    if (insertErr) throw insertErr;

    logActivity(supabase, {
      req,
      actorId: account.id,
      actorType: 'employee',
      actorName: account.full_name,
      action: 'employee.password_ticket_created',
      category: 'employee',
      description: `Password reset ticket submitted by "${account.full_name || account.username}"`,
      targetType: 'employee',
      targetId: account.id,
      targetLabel: account.full_name || account.username
    });

    return res.json({ status: 'success', message: 'Your request was sent. Your admin will give you a new password.' });
  } catch (err) {
    console.error('[password-ticket] create failed:', err.message);
    return res.status(500).json({ status: 'error', message: 'Could not send your request. Please try again.' });
  }
});

// ADMIN / CEO: list open tickets (already behind requireStaff('admin','ceo') via /api/admin).
app.get('/api/admin/password-tickets', async (req, res) => {
  try {
    if (!supabase) return res.status(503).json({ status: 'error', message: 'Database disconnected.' });
    const { data, error } = await supabase
      .from('password_reset_tickets')
      .select('id, user_id, username, full_name, note, status, created_at')
      .eq('status', 'open')
      .order('created_at', { ascending: true });
    if (error) throw error;
    res.setHeader('Cache-Control', 'private, no-store');
    return res.json({ status: 'success', tickets: data || [] });
  } catch (err) {
    console.error('[password-ticket] list failed:', err.message);
    return res.status(500).json({ status: 'error', message: 'Could not load password requests.' });
  }
});

// ADMIN / CEO: issue a new temporary password and close the ticket.
app.post('/api/admin/password-tickets/:id/resolve', async (req, res) => {
  try {
    if (!supabase) return res.status(503).json({ status: 'error', message: 'Database disconnected.' });
    if (!bcrypt) return res.status(500).json({ status: 'error', message: 'Password hashing is not available on the server.' });

    const { data: ticket, error: ticketErr } = await supabase
      .from('password_reset_tickets')
      .select('id, user_id, username, full_name, status')
      .eq('id', req.params.id)
      .maybeSingle();
    if (ticketErr) throw ticketErr;
    if (!ticket) return res.status(404).json({ status: 'error', message: 'Ticket not found.' });
    if (ticket.status !== 'open') return res.status(409).json({ status: 'error', message: 'This ticket was already handled.' });

    const tempPassword = generateTempPassword(10);
    const newHash = await bcrypt.hash(tempPassword, 10);

    const { data: updatedRows, error: updErr } = await supabase
      .from('users')
      .update({ password_hash: newHash, must_change_password: true })
      .eq('id', ticket.user_id)
      .eq('user_type', 'employee')
      .select('id');
    if (updErr) throw updErr;
    if (!updatedRows || updatedRows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'That employee account no longer exists.' });
    }

    const { error: closeErr } = await supabase
      .from('password_reset_tickets')
      .update({ status: 'resolved', resolved_at: new Date().toISOString(), resolved_by: String(req.staff.id) })
      .eq('id', ticket.id)
      .eq('status', 'open');
    if (closeErr) console.error('[password-ticket] password changed but ticket not closed:', closeErr.message);

    // The password itself is never written to the activity log.
    logActivity(supabase, {
      req,
      action: 'employee.password_reset',
      category: 'employee',
      description: `Issued a new temporary password to "${ticket.full_name || ticket.username}" (ticket #${ticket.id})`,
      targetType: 'employee',
      targetId: ticket.user_id,
      targetLabel: ticket.full_name || ticket.username
    });

    res.setHeader('Cache-Control', 'no-store');
    return res.json({
      status: 'success',
      temp_password: tempPassword,
      username: ticket.username,
      full_name: ticket.full_name
    });
  } catch (err) {
    console.error('[password-ticket] resolve failed:', err.message);
    return res.status(500).json({ status: 'error', message: 'Could not reset the password.' });
  }
});

// LOGGED-IN STAFF: replace a temporary password with one of their own.
// Not behind requireStaff on purpose - a temporary-password session is
// blocked there, and this is the one call it must be able to make.
app.post('/api/staff/change-password', async (req, res) => {
  try {
    if (!supabase) return res.status(503).json({ status: 'error', message: 'Database service unavailable.' });
    if (!bcrypt) return res.status(500).json({ status: 'error', message: 'Password hashing is not available on the server.' });

    const session = readToken(req.cookies && req.cookies[COOKIE_NAME]);
    if (!session) return res.status(401).json({ status: 'error', message: 'Authentication required. Please log in.' });

    const currentPassword = String((req.body && req.body.current_password) || '');
    const newPassword = String((req.body && req.body.new_password) || '');
    const confirmPassword = String((req.body && req.body.confirm_password) || '');

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ status: 'error', message: 'Please fill in all password fields.' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ status: 'error', message: 'Your new password must be at least 8 characters.' });
    }
    if (confirmPassword && confirmPassword !== newPassword) {
      return res.status(400).json({ status: 'error', message: 'The new passwords do not match.' });
    }
    if (newPassword === currentPassword) {
      return res.status(400).json({ status: 'error', message: 'Your new password must be different from the temporary one.' });
    }

    const { data: account, error: lookupErr } = await supabase
      .from('users')
      .select('id, username, full_name, user_type, password_hash, is_active')
      .eq('id', session.id)
      .maybeSingle();
    if (lookupErr) throw lookupErr;
    if (!account || !account.is_active) {
      return res.status(403).json({ status: 'error', message: 'This account is not available.' });
    }

    let currentOk = false;
    try {
      const normalized = String(account.password_hash || '').replace(/^\$2y\$/, '$2a$').replace(/^\$2b\$/, '$2a$');
      currentOk = await bcrypt.compare(currentPassword, normalized);
    } catch (e) {
      currentOk = false;
    }
    if (!currentOk) {
      return res.status(400).json({ status: 'error', message: 'Your current (temporary) password is incorrect.' });
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    const { error: updErr } = await supabase
      .from('users')
      .update({ password_hash: newHash, must_change_password: false })
      .eq('id', account.id);
    if (updErr) throw updErr;

    // Fresh cookie without the "must change password" flag.
    setStaffCookie(res, { id: session.id, type: session.type, roles: session.roles || [] });

    logActivity(supabase, {
      req,
      actorId: account.id,
      actorType: account.user_type,
      actorName: account.full_name,
      action: 'auth.password_changed',
      category: 'auth',
      description: `${account.full_name || account.username} replaced their temporary password with a new one`,
      targetType: 'user',
      targetId: account.id
    });

    res.setHeader('Cache-Control', 'no-store');
    return res.json({ status: 'success', message: 'Password updated.' });
  } catch (err) {
    console.error('[change-password] failed:', err.message);
    return res.status(500).json({ status: 'error', message: 'Could not update your password. Please try again.' });
  }
});

// ADMIN / CEO: close a ticket without changing anything (e.g. employee remembered it).
app.post('/api/admin/password-tickets/:id/dismiss', async (req, res) => {
  try {
    if (!supabase) return res.status(503).json({ status: 'error', message: 'Database disconnected.' });
    const { data, error } = await supabase
      .from('password_reset_tickets')
      .update({ status: 'dismissed', resolved_at: new Date().toISOString(), resolved_by: String(req.staff.id) })
      .eq('id', req.params.id)
      .eq('status', 'open')
      .select('id');
    if (error) throw error;
    if (!data || data.length === 0) return res.status(409).json({ status: 'error', message: 'This ticket was already handled.' });
    return res.json({ status: 'success' });
  } catch (err) {
    console.error('[password-ticket] dismiss failed:', err.message);
    return res.status(500).json({ status: 'error', message: 'Could not dismiss the ticket.' });
  }
});

// ==========================================
// 1. STATIC FILE SERVING & ROUTE ALIASES
// ==========================================
// Cache-Control tuned per asset type. This is what lets Vercel's Edge
// Network (and the browser) cache these responses instead of re-invoking
// this serverless function on every single request -- the main driver of
// Fast Origin Transfer for a static-asset-heavy app like this one.
function staticCacheHeaders(res, filePath) {
  // Logged-in staff pages must never be cached publicly (Vercel's edge would
  // hand the cached copy to someone who isn't logged in).
  if (/[\\/](management|employee)[\\/]/i.test(filePath) && /\.html$/i.test(filePath) &&
      !/(managementlogin|login)\.html$/i.test(filePath)) {
    res.setHeader('Cache-Control', 'private, no-store');
    return;
  }
  // Login-page scripts (incl. the shared forgot-password script) must never be
  // served stale, or fixes don't reach staff until the cache expires.
  if (/(staffForgotPassword|employeelogin|managementlogin|[\\/]login)\.(js|css)$/i.test(filePath)) {
    res.setHeader('Cache-Control', 'no-cache');
    return;
  }
  if (/\.(png|jpe?g|gif|webp|svg|ico|ttf|otf|woff2?)$/i.test(filePath)) {
    // Images/fonts rarely change: cache long at the edge and in the browser,
    // but allow a background revalidation window instead of marking them
    // "immutable" (filenames aren't content-hashed, so they *can* change).
    res.setHeader('Cache-Control', 'public, max-age=604800, s-maxage=2592000, stale-while-revalidate=86400');
  } else if (/\.(css|js)$/i.test(filePath)) {
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=3600');
  } else {
    // HTML and anything else: short cache so edits still show up quickly,
    // but repeated hits within the window still avoid the origin function.
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=300');
  }
}

const staticOpts = { maxAge: '7d', setHeaders: staticCacheHeaders };

// Old management login URL -> new URL (keeps old bookmarks/links working)
app.get('/management/managementlogin.html', (req, res) => {
  const queryStr = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
  res.redirect(301, `/management/login.html${queryStr}`);
});

// Staff pages: no valid login cookie -> back to the login page.
// Only .html files under /management and /employee are checked; CSS, JS,
// fonts and images stay public and cached, so page speed is unchanged.
const STAFF_LOGIN_PAGES = ['/management/login.html', '/employee/login.html'];
app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  let p;
  try {
    p = path.posix.normalize(decodeURIComponent(req.path).replace(/\\/g, '/')).toLowerCase();
  } catch (e) {
    return res.status(400).end();
  }
  const isMgmt = p.startsWith('/management/');
  const isEmp = p.startsWith('/employee/');
  if ((!isMgmt && !isEmp) || !p.endsWith('.html') || STAFF_LOGIN_PAGES.includes(p)) return next();

  const loginUrl = (isMgmt ? '/management/login.html' : '/employee/login.html') + '?error=login_required';
  const session = readToken(req.cookies && req.cookies[COOKIE_NAME]);
  const allowed = isMgmt
    ? (p.startsWith('/management/ceo/') ? ['ceo'] : ['admin', 'ceo'])
    : ['employee', 'admin', 'ceo'];

  if (!session || !allowed.includes(session.type)) {
    res.setHeader('Cache-Control', 'private, no-store');
    return res.redirect(302, loginUrl);
  }
  // Still on a temporary password: the only page they may open is the
  // change-password page.
  if (session.mcp && p !== '/employee/changepassword.html') {
    res.setHeader('Cache-Control', 'private, no-store');
    return res.redirect(302, '/employee/changePassword.html');
  }
  next();
});

// TWA / Digital Asset Links: Express's static middleware ignores dotfiles
// (and dot-prefixed folders like .well-known) by default for security, so
// without this explicit route /.well-known/assetlinks.json would 404 and
// the Android app could never be verified as the site's "owner" -- it
// would keep showing a browser URL bar instead of running fullscreen.
app.get('/.well-known/assetlinks.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.sendFile(path.join(__dirname, 'public', '.well-known', 'assetlinks.json'));
});

app.use(express.static(path.join(__dirname, 'public'), staticOpts));
app.use('/customer', express.static(path.join(__dirname, 'public/customer'), staticOpts));
app.use('/images', express.static(path.join(__dirname, 'public/images'), staticOpts));
app.use('/images/uploads', express.static(path.join(__dirname, 'public/images/uploads'), staticOpts));
app.use('/uploads', express.static(path.join(__dirname, 'public/images/uploads'), staticOpts));
app.use('/customer/images', express.static(path.join(__dirname, 'public/images'), staticOpts));

app.get(['/customerlogin.html', '/customer/customerlogin.html'], (req, res) => {
  const queryStr = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
  res.redirect(`/customer/login.html${queryStr}`);
});

app.get('/customer/:page', (req, res, next) => {
  if (['profile', 'loyalty', 'cart', 'orders'].includes(req.params.page)) {
    return next();
  }
  const filePath = path.join(__dirname, 'public/customer', req.params.page);
  res.sendFile(filePath, (err) => {
    if (err) next();
  });
});

app.get('/', (req, res) => {
  res.redirect('/index.html');
});

// Avatar paths from the database can be: full https URL, base64, a relative
// path, or an old PHP-era path like "/PHP/images/uploads/x.jpg". Return one
// clean value the browser can load. "account.png" counts as "no photo".
function isPlaceholderAvatar(a) {
  return !a || typeof a !== 'string' || /account\.png$/i.test(a.trim());
}
function normalizeAvatarPath(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let a = raw.trim().replace(/^\/?PHP\//i, '/');
  if (a.startsWith('http') || a.startsWith('data:image')) return a;
  return a.startsWith('/') ? a : '/' + a;
}

function getCustomerId(req) {
  // The logged-in session cookie is the trustworthy source of truth and
  // must win over anything the client puts in the query/body/headers --
  // otherwise any signed-in user could pass a different customer_id and
  // read or modify another customer's cart/orders/profile (IDOR).
  const cookieVal = req.cookies?.customer_id || req.cookies?.user_id;
  if (cookieVal && cookieVal !== 'null' && cookieVal !== 'undefined') {
    const parsed = parseInt(cookieVal, 10);
    if (!isNaN(parsed)) return parsed;
  }

  // No session cookie present (e.g. a true guest) -- fall back to whatever
  // the client sent, which is fine here because there's no session to spoof.
  const val = req.headers['x-customer-id'] || req.query.customer_id || (req.body && req.body.customer_id);
  if (val && val !== 'null' && val !== 'undefined' && !String(val).startsWith('guest_')) {
    const parsed = parseInt(val, 10);
    if (!isNaN(parsed)) return parsed;
  }

  return null;
}

function getCartIdentity(req) {
  const customerId = getCustomerId(req);
  const rawCust = req.headers['x-customer-id'] || req.query.customer_id || (req.body && req.body.customer_id);
  const rawSess = req.cookies?.session_id || req.headers['x-session-id'] || req.query.session_id || (req.body && req.body.session_id);

  let sessionId = null;
  if (rawSess && rawSess !== 'null' && rawSess !== 'undefined') {
    sessionId = String(rawSess).trim();
  } else if (rawCust && String(rawCust).startsWith('guest_')) {
    sessionId = String(rawCust).trim();
  }

  const storeKey = customerId ? `cust_${customerId}` : (sessionId || 'guest_default');
  return { customerId, sessionId, storeKey };
}

async function getCustomerCart(cartIdentity) {
  const { customerId, sessionId, storeKey } = cartIdentity;

  if (supabase) {
    try {
      let query = supabase.from('cart_items').select('*');

      if (customerId) {
        query = query.eq('customer_id', customerId);
      } else if (sessionId) {
        query = query.eq('session_id', sessionId);
      } else {
        return memoryCartStore.get(storeKey) || [];
      }

      const { data, error } = await query.order('created_at', { ascending: false });
      if (!error && data) {
        memoryCartStore.set(storeKey, data);
        return data;
      }
    } catch (e) {
      console.warn('[Cart Fetch Warning]:', e.message);
    }
  }

  return memoryCartStore.get(storeKey) || [];
}

// ==========================================
// 2. LIVE RATINGS API
// ==========================================
app.get('/api/ratings', async (req, res) => {
  if (!supabase) return res.status(503).json({ status: 'error', message: 'Database service unavailable.' });
  try {
    const title = req.query.title;
    let query = supabase
      .from('ratings')
      .select(`
        *,
        customers (
          users (
            username,
            full_name,
            avatar
          )
        )
      `)
      .order('created_at', { ascending: false });

    if (title) {
      const cleanTitle = title.replace(/^(8oz|12oz)\s+/i, '').trim();
      query = query.ilike('product_title', `%${cleanTitle}%`);
    }

    const { data: reviews, error } = await query;
    if (error) throw error;

    let computedAvg = 0.0;
    if (reviews && reviews.length > 0) {
      const sum = reviews.reduce((acc, r) => acc + (parseFloat(r.rating_score) || 0), 0);
      computedAvg = Number((sum / reviews.length).toFixed(1));
    }

    const formattedReviews = (reviews || []).map(r => {
      const user = r.customers?.users;
      const reviewerName = user?.username || user?.full_name || 'Marble Sips Fan';

      let reviewerAvatar = user?.avatar || null;
      if (reviewerAvatar && !reviewerAvatar.startsWith('http') && !reviewerAvatar.startsWith('/') && !reviewerAvatar.startsWith('data:image')) {
        reviewerAvatar = '/' + reviewerAvatar;
      }

      return {
        id: r.id,
        order_id: r.order_id,
        customer_id: r.customer_id,
        product_title: r.product_title,
        rating_score: r.rating_score,
        experience_tags: r.experience_tags,
        review_text: r.review_text,
        created_at: r.created_at,
        reviewer_name: reviewerName,
        reviewer_avatar: reviewerAvatar
      };
    });

    return res.json({
      status: 'success',
      reviews: formattedReviews,
      average_score: computedAvg,
      review_count: reviews ? reviews.length : 0
    });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: 'Failed to load ratings.' });
  }
});
app.get('/api/ratings/summary', async (req, res) => {
  if (!supabase) return res.status(503).json({ status: 'error', message: 'Database service unavailable.' });
  try {
    const { data: allReviews, error } = await supabase
      .from('ratings')
      .select('product_title, rating_score');

    if (error) throw error;

    const summary = {};
    (allReviews || []).forEach(r => {
      const normKey = (r.product_title || '')
        .replace(/^(8oz|12oz)\s+/i, '')
        .replace(/\r?\n|\r/g, ' ')
        .trim()
        .toLowerCase();

      if (!summary[normKey]) {
        summary[normKey] = { sum: 0, count: 0 };
      }
      summary[normKey].sum += parseFloat(r.rating_score) || 0;
      summary[normKey].count += 1;
    });

    const calculatedRatings = {};
    Object.keys(summary).forEach(key => {
      calculatedRatings[key] = Number((summary[key].sum / summary[key].count).toFixed(1));
    });

    return res.json({ status: 'success', ratings: calculatedRatings });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: 'Failed to load rating summary.' });
  }
});

app.post('/api/ratings', async (req, res) => {
  if (!supabase) return res.status(503).json({ status: 'error', message: 'Database service unavailable.' });
  try {
    const { customer_id, order_id, product_title, rating_score, tags, review_text } = req.body;

    const { data, error } = await supabase
      .from('ratings')
      .insert([{
        customer_id: customer_id || null,
        order_id: order_id || null,
        product_title: product_title,
        rating_score: rating_score || 5,
        experience_tags: Array.isArray(tags) ? tags.join(', ') : tags,
        review_text: review_text || '',
        created_at: new Date().toISOString()
      }])
      .select()
      .single();

    if (error) throw error;
    return res.json({ status: 'success', review: data });
  } catch (err) {
    return res.status(400).json({ status: 'error', message: err.message });
  }
});

// ==========================================
// 3. CART API ENDPOINTS
// ==========================================
app.get('/api/cart', async (req, res) => {
  try {
    const cartIdentity = getCartIdentity(req);
    const items = await getCustomerCart(cartIdentity);
    return res.json({ status: 'success', items });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: 'Failed to load cart items.' });
  }
});

app.post('/api/cart', async (req, res) => {
  try {
    const cartIdentity = getCartIdentity(req);
    const { customerId, sessionId, storeKey } = cartIdentity;
    const { action, item, id, quantity, is_selected } = req.body;

    let cart = memoryCartStore.get(storeKey) || [];

    if (action === 'add' && item) {
      let combinedToppings = Array.isArray(item.toppings) ? item.toppings.join(', ') : (item.toppings || '');
      if (item.addons) {
        combinedToppings = combinedToppings ? `${combinedToppings} (${item.addons})` : item.addons;
      }

      const existing = cart.find(i =>
        i.title === item.title &&
        i.size === item.size &&
        (i.flavor || '') === (item.flavor || '') &&
        (i.variation || '') === (item.variation || '') &&
        (i.toppings || '') === combinedToppings
      );

      if (existing) {
        existing.quantity = (parseInt(existing.quantity, 10) || 1) + (parseInt(item.quantity, 10) || 1);
        if (supabase && existing.id && !isNaN(Number(existing.id))) {
          try {
            await supabase.from('cart_items').update({ quantity: existing.quantity }).eq('id', existing.id);
          } catch (e) {}
        }
      } else {
        const newItem = {
          id: Date.now(),
          customer_id: customerId || null,
          session_id: sessionId || null,
          title: item.title,
          size: item.size || '12oz',
          flavor: item.flavor || '',
          variation: item.variation || '',
          toppings: combinedToppings,
          unit_price: parseFloat(item.unit_price || 15.00),
          quantity: parseInt(item.quantity || 1, 10),
          is_selected: true,
          image: item.image || 'images/1.jpg',
          accent_color: item.accent_color || '#F48A8E',
          created_at: new Date().toISOString()
        };

        if (supabase) {
          try {
            const dbPayload = {
              customer_id: newItem.customer_id,
              session_id: newItem.session_id,
              title: newItem.title,
              size: newItem.size,
              flavor: newItem.flavor,
              variation: newItem.variation,
              toppings: newItem.toppings,
              unit_price: newItem.unit_price,
              quantity: newItem.quantity,
              is_selected: newItem.is_selected,
              image: newItem.image,
              accent_color: newItem.accent_color
            };

            const { data: dbItem, error: dbErr } = await supabase
              .from('cart_items')
              .insert([dbPayload])
              .select()
              .single();

            if (!dbErr && dbItem) {
              newItem.id = dbItem.id;
            }
          } catch (e) {
            console.warn('[Supabase Cart Insert Warning]:', e.message);
          }
        }

        cart.unshift(newItem);
      }

      memoryCartStore.set(storeKey, cart);
      return res.json({ status: 'success', message: 'Item added to cart!', cart });
    }

    if (action === 'update_qty') {
      const target = cart.find(i => String(i.id) === String(id));
      if (target) {
        target.quantity = Math.max(1, parseInt(quantity, 10) || 1);
        memoryCartStore.set(storeKey, cart);

        if (supabase && id && !isNaN(Number(id))) {
          try {
            await supabase.from('cart_items').update({ quantity: target.quantity }).eq('id', id);
          } catch (e) {}
        }
      }
      return res.json({ status: 'success', cart });
    }

    if (action === 'update_selection') {
      const target = cart.find(i => String(i.id) === String(id));
      if (target) {
        target.is_selected = Boolean(is_selected);
        memoryCartStore.set(storeKey, cart);

        if (supabase && id && !isNaN(Number(id))) {
          try {
            await supabase.from('cart_items').update({ is_selected: target.is_selected }).eq('id', id);
          } catch (e) {}
        }
      }
      return res.json({ status: 'success', cart });
    }

    if (action === 'delete') {
      cart = cart.filter(i => String(i.id) !== String(id));
      memoryCartStore.set(storeKey, cart);

      if (supabase && id && !isNaN(Number(id))) {
        try {
          await supabase.from('cart_items').delete().eq('id', id);
        } catch (e) {}
      }
      return res.json({ status: 'success', cart });
    }

    if (action === 'clear') {
      memoryCartStore.delete(storeKey);
      if (supabase) {
        try {
          if (customerId) {
            await supabase.from('cart_items').delete().eq('customer_id', customerId);
          } else if (sessionId) {
            await supabase.from('cart_items').delete().eq('session_id', sessionId);
          }
        } catch (e) {}
      }
      return res.json({ status: 'success', message: 'Cart cleared', cart: [] });
    }

    return res.json({ status: 'success', cart });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

app.get('/api/cart/count', async (req, res) => {
  const cartIdentity = getCartIdentity(req);
  const cart = await getCustomerCart(cartIdentity);
  const totalCups = (cart || []).reduce((sum, it) => sum + (parseInt(it.quantity, 10) || 1), 0);
  return res.json({ count: totalCups });
});

// ==========================================
// STORE SETTINGS (admin-configurable pickup days)
// ==========================================
// Falls back to Mon/Tue/Thu (the old hardcoded behavior) whenever the
// settings row hasn't been created yet, or the DB is unreachable, so
// checkout never breaks even before an admin has saved anything.
const DEFAULT_PICKUP_DAYS = [1, 2, 4];

async function getAllowedPickupDays() {
  if (!supabase) return DEFAULT_PICKUP_DAYS;
  try {
    const { data, error } = await supabase
      .from('store_settings')
      .select('value')
      .eq('key', 'pickup_days')
      .maybeSingle();

    if (error || !data || !data.value) return DEFAULT_PICKUP_DAYS;

    const days = String(data.value)
      .split(',')
      .map(d => parseInt(d.trim(), 10))
      .filter(d => Number.isInteger(d) && d >= 0 && d <= 6);

    return days.length ? days : DEFAULT_PICKUP_DAYS;
  } catch (e) {
    console.warn('[Store Settings] Failed to load pickup days, using default:', e.message);
    return DEFAULT_PICKUP_DAYS;
  }
}

// Public — the checkout page needs this without being logged in as staff.
app.get('/api/settings/pickup-days', async (req, res) => {
  const days = await getAllowedPickupDays();
  return res.json({ status: 'success', days });
});

// Admin-only — reuses the same '/api/admin' auth middleware already
// applied above (requireStaff('admin', 'ceo')).
app.get('/api/admin/settings/pickup-days', async (req, res) => {
  const days = await getAllowedPickupDays();
  return res.json({ status: 'success', days });
});

app.post('/api/admin/settings/pickup-days', async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ status: 'error', message: 'Database is disconnected.' });

    const rawDays = Array.isArray(req.body.days) ? req.body.days : [];
    const cleanDays = [...new Set(
      rawDays.map(d => parseInt(d, 10)).filter(d => Number.isInteger(d) && d >= 0 && d <= 6)
    )].sort((a, b) => a - b);

    if (cleanDays.length === 0) {
      return res.status(400).json({ status: 'error', message: 'Select at least one pickup day.' });
    }

    const { error } = await supabase
      .from('store_settings')
      .upsert([{ key: 'pickup_days', value: cleanDays.join(',') }], { onConflict: 'key' });

    if (error) throw error;

    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    logActivity(supabase, {
      req,
      action: 'settings.pickup_days_updated',
      category: 'settings',
      description: `Updated store pickup days to ${cleanDays.map(d => dayNames[d]).join(', ')}`,
      targetType: 'store_settings',
      targetId: 'pickup_days',
      metadata: { days: cleanDays }
    });

    return res.json({ status: 'success', days: cleanDays });
  } catch (err) {
    console.error('[Store Settings] Failed to save pickup days:', err.message);
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

// ==========================================
// 4. LOYALTY POINTS ENDPOINTS
// ==========================================
app.get(['/api/customer/loyalty', '/customer/loyalty', '/loyalty'], async (req, res) => {
  try {
    const rawCustId = getCustomerId(req);
    if (!rawCustId) return res.status(401).json({ status: 'error', message: 'Authentication required.' });

    const { data: customer } = await supabase
      .from('customers')
      .select('*')
      .eq('id', rawCustId)
      .maybeSingle();

    if (!customer) return res.status(404).json({ status: 'error', message: 'Customer record not found.' });

    const points = parseFloat(customer.loyalty_points || 0);
    return res.json({
      status: 'success',
      points: points,
      points_formatted: `${points.toFixed(2)} pts`,
      peso_value: points,
      peso_formatted: `₱${points.toFixed(2)}`
    });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

app.post(['/api/customer/loyalty/earn', '/customer/loyalty/earn', '/loyalty/earn'], async (req, res) => {
  try {
    const rawCustId = req.body.customer_id || getCustomerId(req);
    if (!rawCustId) return res.status(401).json({ status: 'error', message: 'Authentication required.' });

    const { amount_spent, points_to_add } = req.body;
    const { data: customer } = await supabase
      .from('customers')
      .select('*')
      .eq('id', rawCustId)
      .maybeSingle();

    if (!customer) return res.status(404).json({ status: 'error', message: 'Customer record not found.' });

    let pointsEarned = 0.0;
    if (points_to_add !== undefined && points_to_add !== null) {
      pointsEarned = parseFloat(points_to_add) || 0.0;
    } else if (amount_spent) {
      pointsEarned = Number((Math.floor(parseFloat(amount_spent) / 10) * 0.10).toFixed(2));
    }

    if (pointsEarned <= 0) {
      return res.json({
        status: 'success',
        message: 'No points earned.',
        loyalty_points: parseFloat(customer.loyalty_points || 0)
      });
    }

    const currentPts = parseFloat(customer.loyalty_points || 0);
    const newPoints = Number((currentPts + pointsEarned).toFixed(2));

    const { data: updated, error } = await supabase
      .from('customers')
      .update({ loyalty_points: newPoints })
      .eq('id', customer.id)
      .select('id, user_id, loyalty_points')
      .single();

    if (error) throw error;

    return res.json({
      status: 'success',
      message: `Earned ${pointsEarned.toFixed(2)} loyalty point(s)!`,
      points_earned: pointsEarned,
      loyalty_points: parseFloat(updated.loyalty_points)
    });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

app.post(['/api/customer/loyalty/redeem', '/customer/loyalty/redeem', '/loyalty/redeem'], async (req, res) => {
  try {
    const rawCustId = req.body.customer_id || getCustomerId(req);
    if (!rawCustId) return res.status(401).json({ status: 'error', message: 'Authentication required.' });

    const { points_to_redeem } = req.body;
    const { data: customer } = await supabase
      .from('customers')
      .select('*')
      .eq('id', rawCustId)
      .maybeSingle();

    if (!customer) return res.status(404).json({ status: 'error', message: 'Customer record not found.' });

    const redeemAmount = parseFloat(points_to_redeem) || 0.0;
    const currentPoints = parseFloat(customer.loyalty_points || 0);

    if (redeemAmount <= 0) {
      return res.status(400).json({ status: 'error', message: 'Invalid redemption amount.' });
    }

    if (currentPoints < redeemAmount) {
      return res.status(400).json({ status: 'error', message: 'Insufficient loyalty points balance.' });
    }

    const newPoints = Number(Math.max(0, currentPoints - redeemAmount).toFixed(2));

    const { data: updated, error } = await supabase
      .from('customers')
      .update({ loyalty_points: newPoints })
      .eq('id', customer.id)
      .select('id, user_id, loyalty_points')
      .single();

    if (error) throw error;

    return res.json({
      status: 'success',
      message: `Redeemed ${redeemAmount.toFixed(2)} points!`,
      redeemed: redeemAmount,
      loyalty_points: parseFloat(updated.loyalty_points)
    });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

// ==========================================
// 5. PRODUCTION PROFILE API (AUTO-CONVERTS BASE64 TO PATH)
// ==========================================
app.get(['/api/customer/profile', '/api/customers/profile'], async (req, res) => {
  try {
    const rawEmail = (req.query.email || '').trim().toLowerCase();
    const rawUserId = req.query.user_id ? parseInt(req.query.user_id, 10) : (req.cookies?.user_id ? parseInt(req.cookies.user_id, 10) : null);
    const rawCustId = req.query.customer_id ? parseInt(req.query.customer_id, 10) : (req.cookies?.customer_id ? parseInt(req.cookies.customer_id, 10) : null);

    if (!rawEmail && !rawUserId && !rawCustId) {
      return res.status(401).json({ status: 'error', message: 'Authentication required. Please log in.' });
    }

    if (!supabase) {
      return res.status(503).json({ status: 'error', message: 'Database service unavailable.' });
    }

    let userRecord = null;
    let customerRecord = null;

    if (rawEmail) {
      const { data } = await supabase
        .from('users')
        .select('*')
        .ilike('email', rawEmail)
        .maybeSingle();
      userRecord = data;
    }

    if (!userRecord && rawUserId && !isNaN(rawUserId)) {
      const { data } = await supabase
        .from('users')
        .select('*')
        .eq('id', rawUserId)
        .maybeSingle();
      userRecord = data;
    }

    if (userRecord) {
      const { data } = await supabase
        .from('customers')
        .select('*')
        .eq('user_id', userRecord.id)
        .maybeSingle();
      customerRecord = data;
    } else if (rawCustId && !isNaN(rawCustId)) {
      const { data: c } = await supabase
        .from('customers')
        .select('*')
        .eq('id', rawCustId)
        .maybeSingle();
      customerRecord = c;

      if (customerRecord && customerRecord.user_id) {
        const { data: u } = await supabase
          .from('users')
          .select('*')
          .eq('id', customerRecord.user_id)
          .maybeSingle();
        userRecord = u;
      }
    }

    if (!userRecord && !customerRecord) {
      return res.status(404).json({ status: 'error', message: 'Account profile not found in database.' });
    }

    // Prefer a real photo. If users.avatar only holds the default placeholder
    // but customers.avatar has the real one, use the real one.
    const userAvatar = userRecord && userRecord.avatar;
    const custAvatar = customerRecord && customerRecord.avatar;
    let avatar = !isPlaceholderAvatar(userAvatar) ? userAvatar
      : (!isPlaceholderAvatar(custAvatar) ? custAvatar : (userAvatar || custAvatar || ''));
    avatar = normalizeAvatarPath(avatar);

    const resolvedFullName = (userRecord && (userRecord.full_name || userRecord.name)) || (customerRecord && customerRecord.name) || '';
    const resolvedUsername = (userRecord && userRecord.username) || '';
    const resolvedEmail = (userRecord && userRecord.email) || (customerRecord && customerRecord.email) || '';
    const resolvedPhone = (customerRecord && (customerRecord.phone || customerRecord.phone_number)) || (userRecord && (userRecord.phone || userRecord.phone_number)) || '';

    // Payment preference: an explicit choice saved in Account Settings takes
    // priority. If the customer never set one, fall back to whichever
    // payment method they used most recently, so checkout can auto-select it.
    let lastPaymentMethod = null;
    if (supabase && customerRecord && customerRecord.id) {
      try {
        const { data: lastOrder } = await supabase
          .from('orders')
          .select('payment_method')
          .eq('customer_id', customerRecord.id)
          .order('placed_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (lastOrder) lastPaymentMethod = lastOrder.payment_method || null;
      } catch (e) {
        console.warn('Could not resolve last payment method for customer', customerRecord.id, e);
      }
    }

    const profileData = {
      id: customerRecord ? customerRecord.id : userRecord.id,
      customer_id: customerRecord ? customerRecord.id : null,
      user_id: userRecord ? userRecord.id : null,
      phone: resolvedPhone,
      phone_number: resolvedPhone,
      loyalty_points: customerRecord ? (parseFloat(customerRecord.loyalty_points) || 0) : 0,
      payment_preference: (customerRecord && customerRecord.payment_preference) || null,
      last_payment_method: lastPaymentMethod,
      notify_pickup: customerRecord ? Boolean(customerRecord.notify_pickup) : false,
      notify_email_receipts: customerRecord ? Boolean(customerRecord.notify_email_receipts) : false,
      notify_promos: customerRecord ? Boolean(customerRecord.notify_promos) : false,
      users: {
        id: userRecord ? userRecord.id : null,
        full_name: resolvedFullName,
        username: resolvedUsername,
        email: resolvedEmail,
        avatar: avatar,
        last_username_update: userRecord ? userRecord.last_username_update : null
      },
      full_name: resolvedFullName,
      username: resolvedUsername,
      email: resolvedEmail,
      avatar: avatar,
      last_username_update: userRecord ? userRecord.last_username_update : null
    };

    return res.json({
      status: 'success',
      data: profileData,
      customer: profileData
    });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: 'Failed to retrieve profile.' });
  }
});

app.put(['/api/customer/profile', '/api/customers/profile'], async (req, res) => {
  try {
    const { user_id, email, full_name, username, phone_number, avatar } = req.body;

    if (!user_id && !email) {
      return res.status(401).json({ status: 'error', message: 'Authentication required.' });
    }

    if (!supabase) {
      return res.status(503).json({ status: 'error', message: 'Database service unavailable.' });
    }

    let targetUserId = user_id ? parseInt(user_id, 10) : null;

    if (email && !targetUserId) {
      const { data } = await supabase.from('users').select('id').ilike('email', email.trim().toLowerCase()).maybeSingle();
      if (data) targetUserId = data.id;
    }

    if (!targetUserId) {
      return res.status(404).json({ status: 'error', message: 'Target user account not found.' });
    }

    // Awtomatikong i-convert ang Base64 image sa Supabase Storage URL para
    // magkasya sa varchar(255) at para persistent ito sa production.
    let finalAvatarUrl = avatar;
    if (avatar && typeof avatar === 'string' && avatar.startsWith('data:image')) {
      try {
        const matches = avatar.match(/^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/);
        if (matches) {
          const rawExt = matches[1].toLowerCase();
          const ext = (rawExt === 'jpeg' || rawExt === 'jpg') ? 'jpg' : (rawExt === 'png' ? 'png' : 'webp');
          const buffer = Buffer.from(matches[2], 'base64');
          finalAvatarUrl = await uploadAvatarToSupabase(buffer, `avatar.${ext}`, `image/${rawExt}`);
        }
      } catch (fileErr) {
        console.error('Error uploading base64 avatar to Supabase Storage:', fileErr);
      }
    }

    // I-update ang customers table gamit ang 'avatar' column
    const customerUpdates = {
      phone: phone_number || '',
      phone_number: phone_number || ''
    };
    if (finalAvatarUrl !== undefined && finalAvatarUrl) {
      customerUpdates.avatar = finalAvatarUrl;
    }

    await supabase
      .from('customers')
      .update(customerUpdates)
      .eq('user_id', targetUserId);

    // I-update ang users table gamit ang 'avatar' column lamang
    const userUpdates = {};
    if (full_name !== undefined) userUpdates.full_name = full_name;
    if (finalAvatarUrl !== undefined && finalAvatarUrl) {
      userUpdates.avatar = finalAvatarUrl;
    }

    if (username !== undefined) {
      const { data: existingUser } = await supabase
        .from('users')
        .select('username')
        .eq('id', targetUserId)
        .maybeSingle();

      if (existingUser && existingUser.username !== username) {
        userUpdates.username = username;
        userUpdates.last_username_update = new Date().toISOString();
      } else if (!existingUser) {
        userUpdates.username = username;
      }
    }

    if (Object.keys(userUpdates).length > 0) {
      const { error: userErr } = await supabase
        .from('users')
        .update(userUpdates)
        .eq('id', targetUserId);

      if (userErr) throw userErr;
    }

    return res.json({
      status: 'success',
      message: 'Profile updated successfully!',
      avatar: finalAvatarUrl
    });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.message || 'Failed to update profile.' });
  }
});

const uploadMiddleware = (req, res, next) => {
  if (upload) {
    return upload.single('avatar')(req, res, next);
  }
  next();
};

app.post(['/api/customer/profile/upload', '/api/customers/profile/upload'], uploadMiddleware, async (req, res) => {
  try {
    let avatarUrl = '';
    if (req.file) {
      avatarUrl = await uploadAvatarToSupabase(req.file.buffer, req.file.originalname, req.file.mimetype);
    } else if (req.body && req.body.avatar) {
      avatarUrl = req.body.avatar;
    }

    if (!avatarUrl) {
      return res.status(400).json({ status: 'error', message: 'No valid image file uploaded.' });
    }

    const rawUserId = req.body?.user_id;
    if (supabase && rawUserId) {
      const resolvedUserId = parseInt(rawUserId, 10);
      if (!isNaN(resolvedUserId)) {
        await supabase
          .from('users')
          .update({ avatar: avatarUrl })
          .eq('id', resolvedUserId);

        await supabase
          .from('customers')
          .update({ avatar: avatarUrl })
          .eq('user_id', resolvedUserId);
      }
    }

    return res.json({
      status: 'success',
      message: 'Avatar uploaded successfully!',
      avatar: avatarUrl
    });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: 'Failed to upload photo.' });
  }
});

// ==========================================
// SELF-SERVICE PROFILE PICTURE (Management & Employees)
// ==========================================
// Any logged-in staff member (admin, CEO, or any employee role) can set
// their own avatar. This mirrors the customer upload above, updating the
// shared `users.avatar` column directly by user_id - it works for every
// role because `employees` doesn't keep its own avatar column, avatar
// always lives on `users`.
app.get('/api/profile/avatar', async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ status: 'error', message: 'Database disconnected.' });
    const userId = parseInt(req.query.user_id, 10);
    if (!userId) return res.status(400).json({ status: 'error', message: 'user_id is required.' });

    const { data: userRow, error } = await supabase
      .from('users')
      .select('avatar')
      .eq('id', userId)
      .maybeSingle();
    if (error) throw error;

    return res.json({ status: 'success', avatar: (userRow && userRow.avatar) || null });
  } catch (error) {
    console.error('Get profile avatar error:', error);
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

app.post('/api/profile/upload-avatar', uploadMiddleware, async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ status: 'error', message: 'Database disconnected.' });

    const userId = parseInt(req.body?.user_id, 10);
    if (!userId) return res.status(400).json({ status: 'error', message: 'user_id is required.' });

    let avatarUrl = '';
    if (req.file) {
      avatarUrl = await uploadAvatarToSupabase(req.file.buffer, req.file.originalname, req.file.mimetype);
    } else if (req.body && req.body.avatar) {
      avatarUrl = req.body.avatar;
    }
    if (!avatarUrl) {
      return res.status(400).json({ status: 'error', message: 'No valid image file uploaded.' });
    }

    const { data: existingUser, error: findErr } = await supabase
      .from('users')
      .select('id, user_type')
      .eq('id', userId)
      .maybeSingle();
    if (findErr) throw findErr;
    if (!existingUser) {
      return res.status(404).json({ status: 'error', message: 'User not found.' });
    }

    const { error: updateErr } = await supabase
      .from('users')
      .update({ avatar: avatarUrl })
      .eq('id', userId);
    if (updateErr) throw updateErr;

    return res.json({ status: 'success', message: 'Profile picture updated.', avatar: avatarUrl });
  } catch (error) {
    console.error('Upload staff avatar error:', error);
    return res.status(500).json({ status: 'error', message: error.message || 'Failed to upload photo.' });
  }
});

// ==========================================
// 6. PRODUCTION EMAIL OTP & PASSWORD
// ==========================================
app.post('/api/customer/email-otp', async (req, res) => {
  try {
    const { new_email } = req.body;
    if (!new_email) {
      return res.status(400).json({ status: 'error', message: 'Email address is required.' });
    }

    const cleanEmail = new_email.toLowerCase().trim();
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();

    emailOtpStore.set(cleanEmail, {
      code: otpCode,
      expiresAt: Date.now() + 10 * 60 * 1000
    });

    await transporter.sendMail({
      from: `"Milky Marble" <${emailUser}>`,
      to: cleanEmail,
      subject: 'Milky Marble - Email Verification Code',
      html: `
        <div style="font-family: Arial, sans-serif; background: #FFF5F4; padding: 35px 20px; text-align: center;">
          <div style="max-width: 460px; margin: 0 auto; background: #FFFFFF; border-radius: 24px; padding: 32px 26px; border: 2px solid #FCE1DD;">
            <h2 style="color: #594A42;">Confirm your new email address</h2>
            <div style="background: #FDF1EE; border-radius: 16px; padding: 18px 10px; margin-bottom: 20px;">
              <span style="font-size: 34px; font-weight: 800; letter-spacing: 8px; color: #F48A8E;">${otpCode}</span>
            </div>
            <p style="color: #7C4F38; font-size: 13px;">This code will expire in 10 minutes.</p>
          </div>
        </div>
      `
    });

    return res.json({ status: 'success', message: `Verification code sent to ${cleanEmail}.` });
  } catch (err) {
    console.error('[SMTP] Failed to send email-change OTP:', err.message);
    return res.status(500).json({ status: 'error', message: 'Failed to deliver verification code email. Please check your email address.' });
  }
});

app.post('/api/customer/email-otp/verify', async (req, res) => {
  try {
    const { new_email, otp_code, user_id } = req.body;
    const cleanEmail = (new_email || '').toLowerCase().trim();
    const storedOtp = emailOtpStore.get(cleanEmail);
    const isCodeValid = Boolean(storedOtp && storedOtp.code === String(otp_code).trim() && Date.now() <= storedOtp.expiresAt);

    if (!isCodeValid) {
      return res.status(400).json({ status: 'error', message: 'Invalid or expired confirmation code.' });
    }

    emailOtpStore.delete(cleanEmail);
    if (!supabase) return res.status(503).json({ status: 'error', message: 'Database service unavailable.' });

    const targetUserId = user_id ? parseInt(user_id, 10) : null;
    if (!targetUserId) {
      return res.status(401).json({ status: 'error', message: 'User identification missing.' });
    }

    await supabase.from('users').update({ email: cleanEmail }).eq('id', targetUserId);
    await supabase.from('customers').update({ email: cleanEmail }).eq('user_id', targetUserId);

    return res.json({
      status: 'success',
      message: 'Email updated successfully!',
      new_email: cleanEmail
    });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: 'Failed to update email.' });
  }
});

app.post('/api/customer/request-password-otp', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ status: 'error', message: 'Registered account email is required.' });
    }

    const cleanEmail = email.toLowerCase().trim();

    if (!supabase) return res.status(503).json({ status: 'error', message: 'Database service unavailable.' });

    const escapedEmail = cleanEmail.replace(/[%_]/g, '\\$&');
    const { data: userRecord, error: lookupErr } = await supabase
      .from('users')
      .select('id')
      .ilike('email', escapedEmail)
      .maybeSingle();

    if (lookupErr) {
      console.error('[request-password-otp] User lookup failed:', lookupErr.message);
      return res.status(500).json({ status: 'error', message: 'Something went wrong looking up your account. Please try again.' });
    }

    if (!userRecord) {
      return res.status(404).json({ status: 'error', message: 'No account found for that email.' });
    }

    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();

    const otpKey = cleanEmail;
    passwordOtpStore.set(otpKey, {
      code: otpCode,
      email: cleanEmail,
      expiresAt: Date.now() + 10 * 60 * 1000
    });

    await transporter.sendMail({
      from: `"Milky Marble Security" <${emailUser}>`,
      to: cleanEmail,
      subject: 'Milky Marble - Password Reset Security Code',
      html: `
        <div style="font-family: Arial, sans-serif; background: #FFF5F4; padding: 25px; text-align: center;">
          <div style="max-width: 440px; margin: 0 auto; background: #FFF; border-radius: 16px; padding: 25px; border: 1px solid #FCE1DD;">
            <h2 style="color: #594A42;">Change Password Verification</h2>
            <p style="color: #7C4F38;">Your security code is:</p>
            <h1 style="color: #F48A8E; letter-spacing: 6px;">${otpCode}</h1>
            <p style="color: #7C4F38; font-size: 12px;">Valid for 10 minutes.</p>
          </div>
        </div>
      `
    });

    return res.json({ status: 'success', message: 'Security code sent to your email.' });
  } catch (err) {
    console.error('[SMTP] Failed to send password-reset OTP:', err.message);
    return res.status(500).json({ status: 'error', message: 'Failed to deliver security code email.' });
  }
});


app.post('/api/customer/change-password', async (req, res) => {
  try {
    const { current_password, new_password, otp_code, email } = req.body;
    if (!email) return res.status(401).json({ status: 'error', message: 'Email identifier required.' });

    if (!current_password || !new_password || !otp_code) {
      return res.status(400).json({ status: 'error', message: 'All required password fields must be filled.' });
    }

    const cleanEmail = email.toLowerCase().trim();
    const storedOtp = passwordOtpStore.get(cleanEmail);
    const isCodeValid = Boolean(storedOtp && storedOtp.code === String(otp_code).trim() && Date.now() <= storedOtp.expiresAt);

    if (!isCodeValid) {
      return res.status(400).json({ status: 'error', message: 'Invalid or expired confirmation code.' });
    }

    const escapedEmail = cleanEmail.replace(/[%_]/g, '\\$&');

    const { data: userRecord, error: lookupErr } = await supabase
      .from('users')
      .select('id, password_hash')
      .ilike('email', escapedEmail)
      .maybeSingle();

    if (lookupErr) {
      console.error('[change-password] User lookup failed:', lookupErr.message);
      return res.status(500).json({ status: 'error', message: 'Something went wrong looking up your account. Please try again.' });
    }

    if (!userRecord) return res.status(404).json({ status: 'error', message: 'User account not found.' });

    if (bcrypt && userRecord.password_hash) {
      let isMatch = false;
      const normalizedHash = userRecord.password_hash.replace(/^\$2y\$/, '$2a$').replace(/^\$2b\$/, '$2a$');

      try {
        isMatch = await bcrypt.compare(current_password, normalizedHash);
      } catch {
        isMatch = (current_password === userRecord.password_hash);
      }

      if (!isMatch && current_password !== userRecord.password_hash) {
        return res.status(400).json({ status: 'error', message: 'Current password does not match our records.' });
      }
    }

    const newHash = bcrypt ? await bcrypt.hash(new_password, 10) : new_password;

    const { data: updatedRows, error: passUpdateErr } = await supabase
      .from('users')
      .update({ password_hash: newHash })
      .eq('id', userRecord.id)
      .select('id');

    if (passUpdateErr) return res.status(400).json({ status: 'error', message: passUpdateErr.message });
    if (!updatedRows || updatedRows.length === 0) {
      console.error('[change-password] Update matched 0 rows for user', userRecord.id, '- check SUPABASE_SERVICE_ROLE_KEY / RLS policies.');
      return res.status(500).json({ status: 'error', message: 'Could not update password. Please try again or contact support.' });
    }

    passwordOtpStore.delete(cleanEmail);
    return res.json({ status: 'success', message: 'Your password has been changed successfully!' });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: 'Failed to update password.' });
  }
});

// Forgot Password (logged-out reset): unlike /change-password above, this does NOT
// require current_password - the emailed OTP itself is the proof of account ownership.
app.post('/api/customer/forgot-password', async (req, res) => {
  try {
    const { email, otp_code, new_password } = req.body;
    if (!email || !otp_code || !new_password) {
      return res.status(400).json({ status: 'error', message: 'Email, security code, and new password are all required.' });
    }

    const cleanEmail = email.toLowerCase().trim();
    const storedOtp = passwordOtpStore.get(cleanEmail);
    const isCodeValid = Boolean(storedOtp && storedOtp.code === String(otp_code).trim() && Date.now() <= storedOtp.expiresAt);

    if (!isCodeValid) {
      return res.status(400).json({ status: 'error', message: 'Invalid or expired security code.' });
    }

    if (!supabase) return res.status(503).json({ status: 'error', message: 'Database service unavailable.' });

    // Escape % and _ so they're treated as literal characters, not SQL wildcards.
    // Without this, an email like "first_last@gmail.com" can match unrelated rows
    // and cause .maybeSingle() to throw (silently swallowed below otherwise).
    const escapedEmail = cleanEmail.replace(/[%_]/g, '\\$&');

    const { data: userRecord, error: lookupErr } = await supabase
      .from('users')
      .select('id')
      .ilike('email', escapedEmail)
      .maybeSingle();

    if (lookupErr) {
      console.error('[forgot-password] User lookup failed:', lookupErr.message);
      return res.status(500).json({ status: 'error', message: 'Something went wrong looking up your account. Please try again.' });
    }

    if (!userRecord) {
      return res.status(404).json({ status: 'error', message: 'No account found for that email.' });
    }

    const newHash = bcrypt ? await bcrypt.hash(new_password, 10) : new_password;

    const { data: updatedRows, error: passUpdateErr } = await supabase
      .from('users')
      .update({ password_hash: newHash })
      .eq('id', userRecord.id)
      .select('id');

    if (passUpdateErr) return res.status(400).json({ status: 'error', message: passUpdateErr.message });
    if (!updatedRows || updatedRows.length === 0) {
      console.error('[forgot-password] Update matched 0 rows for user', userRecord.id, '- check SUPABASE_SERVICE_ROLE_KEY / RLS policies.');
      return res.status(500).json({ status: 'error', message: 'Could not update password. Please try again or contact support.' });
    }

    passwordOtpStore.delete(cleanEmail);
    return res.json({ status: 'success', message: 'Your password has been reset successfully! You can now log in.' });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: 'Failed to reset password.' });
  }
});

app.patch('/api/customer/preferences', async (req, res) => {
  try {
    const customerId = getCustomerId(req);
    if (!customerId) return res.status(401).json({ status: 'error', message: 'Authentication required.' });

    const { key, value } = req.body;
    const booleanKeys = ['notify_pickup', 'notify_email_receipts', 'notify_promos'];
    const VALID_PAYMENT_METHODS = ['Cash on Pick-Up', 'E-Wallet'];

    let updatePayload;
    if (booleanKeys.includes(key)) {
      updatePayload = { [key]: Boolean(value) };
    } else if (key === 'payment_preference') {
      // Allow clearing the preference (null/empty) to fall back to
      // "auto" mode, which uses the customer's last-used payment method.
      if (value !== null && value !== '' && !VALID_PAYMENT_METHODS.includes(value)) {
        return res.status(400).json({ status: 'error', message: 'Invalid payment method.' });
      }
      updatePayload = { payment_preference: value || null };
    } else {
      return res.status(400).json({ status: 'error', message: 'Invalid preference key.' });
    }

    if (!supabase) {
      return res.status(503).json({ status: 'error', message: 'Database not connected.' });
    }

    const { data: updatedRows, error: prefUpdateErr } = await supabase
      .from('customers')
      .update(updatePayload)
      .eq('id', customerId)
      .select('id');

    if (prefUpdateErr) {
      console.error('[preferences] Update failed for customer', customerId, ':', prefUpdateErr.message);
      return res.status(500).json({ status: 'error', message: 'Could not save your preference. Please try again.' });
    }

    if (!updatedRows || updatedRows.length === 0) {
      console.error('[preferences] Update matched 0 rows for customer', customerId, '- check SUPABASE_SERVICE_ROLE_KEY / RLS policies.');
      return res.status(500).json({ status: 'error', message: 'Could not save your preference — please contact support.' });
    }

    return res.json({ status: 'success', message: 'Preference updated successfully!' });
  } catch (err) {
    console.error('[preferences] Unexpected error:', err.message);
    return res.status(500).json({ status: 'error', message: 'Failed to update preference.' });
  }
});

app.post('/api/customer/deactivate', async (req, res) => {
  try {
    const userId = req.body?.user_id;
    if (!userId) return res.status(401).json({ status: 'error', message: 'Authentication required.' });

    if (supabase) {
      await supabase.from('users').update({ is_active: false }).eq('id', userId);
    }

    res.clearCookie('user_id');
    res.clearCookie('customer_id');
    return res.json({ status: 'success', message: 'Account deactivated.', redirect: 'login.html' });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: 'Failed to deactivate account.' });
  }
});

// ==========================================
// 7. VALIDATE PROMO CODE API
// ==========================================
app.get('/api/promotions/validate', async (req, res) => {
  try {
    const rawCode = (req.query.code || '').trim();
    if (!rawCode) return res.status(400).json({ status: 'error', message: 'Promo code is required.' });

    if (!supabase) return res.status(503).json({ status: 'error', message: 'Database not connected.' });

    const { data: promo, error } = await supabase
      .from('promotions')
      .select('*')
      .ilike('code', rawCode)
      .single();

    if (error || !promo) {
      return res.status(404).json({ status: 'error', message: 'Invalid promo code.' });
    }

    const statusUpper = (promo.status || '').toUpperCase();
    if (statusUpper !== 'APPROVED' && statusUpper !== 'PROPOSED' && statusUpper !== 'ACTIVE') {
      return res.status(400).json({ status: 'error', message: 'This promo code is no longer active.' });
    }

    return res.json({
      status: 'success',
      promo: {
        code: promo.code,
        title: promo.title,
        discount_type: promo.discount_type,
        discount_value: parseFloat(promo.discount_value) || 0
      }
    });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: 'Failed to validate promo.' });
  }
});

// ==========================================
// 8. ROUTE MOUNTING
// ==========================================
app.use('/api/auth', (req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    if (body && (body.status === 'success' || body.success)) {
      const user = body.user || body.data?.user || body.data;
      const cust = body.customer || body.data?.customer;
      const uId = user?.id || cust?.user_id || cust?.id;
      const cId = cust?.id || user?.customer_id;

      if (uId) {
        res.cookie('user_id', String(uId), { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 7 * 24 * 60 * 60 * 1000 });
      }
      if (cId) {
        res.cookie('customer_id', String(cId), { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 7 * 24 * 60 * 60 * 1000 });
      }
    }
    return originalJson(body);
  };
  next();
}, authRoutes);

app.use('/api/orders', orderRoutes);
app.use('/api/payments', paymentRoutes);
if (customerRoutes) {
  app.use(['/api/customers', '/api/customer'], customerRoutes);
}
// Employee dashboards (Sales/Finance/Procurement/Production) — Supabase-backed.
// See src/routes/employeeRoutes.js and supabase_employee_dashboards.sql.
app.use('/api', employeeRoutes);

app.post(['/api/auth/logout', '/auth/logout', '/logout'], (req, res) => {
  res.clearCookie('user_id');
  res.clearCookie('customer_id');
  res.clearCookie('session_id');
  return res.json({ status: 'success', message: 'Logged out successfully.' });
});

// ==========================================
// MANAGEMENT MODULE (Admin / CEO) — Supabase
// Uses the shared `supabase` and `bcrypt` clients
// already initialized above.
// ==========================================
// management login

app.post('/api/management/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    console.log(`[LOGIN ATTEMPT] Username received: "${username}"`);

    if (!username || !password) {
      return res.status(400).json({ status: 'error', message: 'Please enter both username and password.' });
    }

    if (!supabase) {
      console.log('[LOGIN ERROR] Supabase client is disconnected.');
      return res.status(500).json({ status: 'error', message: 'Database disconnected.' });
    }

    const cleanUsername = username.trim();

    // Query Supabase users table
    const { data: user, error: userErr } = await supabase
      .from('users')
      .select('id, username, password_hash, full_name, user_type, is_active')
      .eq('username', cleanUsername)
      .maybeSingle();

    if (userErr || !user) {
      console.log(`[LOGIN ERROR] User not found for: "${cleanUsername}"`, userErr);
      return res.status(401).json({ status: 'error', message: 'Invalid username or password.' });
    }

    // Check if account is active
    if (user.is_active !== undefined && Number(user.is_active) !== 1 && user.is_active !== true) {
      return res.status(403).json({ status: 'error', message: 'Your account has been deactivated.' });
    }

    // Verify password (supports bcrypt hashes and plaintext fallback)
    let passwordMatch = false;
    const isBcryptHash = user.password_hash &&
      (user.password_hash.startsWith('$2a$') ||
        user.password_hash.startsWith('$2b$') ||
        user.password_hash.startsWith('$2y$'));

    if (bcrypt && isBcryptHash) {
      try {
        // Normalize PHP hashes to Node hashes
        const normalizedHash = user.password_hash.replace(/^\$2y\$/, '$2a$').replace(/^\$2b\$/, '$2a$');
        passwordMatch = await bcrypt.compare(password, normalizedHash);
      } catch (err) {
        console.error('[LOGIN] Bcrypt error:', err);
        passwordMatch = (password === user.password_hash);
      }
    } else {
      passwordMatch = (password === user.password_hash);
    }

    if (!passwordMatch) {
      return res.status(401).json({ status: 'error', message: 'Invalid username or password.' });
    }

    const role = String(user.user_type || '').toLowerCase();
    if (role !== 'ceo' && role !== 'admin') {
      return res.status(403).json({ status: 'error', message: 'Access denied. Restricted to Administrators and CEO only.' });
    }

    const redirectUrl = role === 'ceo' ? 'ceo/dashboard.html' : 'admin/dashboard.html';

    setStaffCookie(res, { id: user.id, type: role });

    return res.json({
      status: 'success',
      message: 'Login successful.',
      role: role,
      redirectUrl: redirectUrl,
      user: {
        id: user.id,
        username: user.username,
        fullName: user.full_name,
        userType: role
      }
    });

  } catch (error) {
    console.error('Management login crash error:', error);
    return res.status(500).json({ status: 'error', message: 'Internal server error during login.' });
  }
});

// ==========================================
// MANAGEMENT ADMIN DASHBOARD API (Supabase)
// ==========================================
app.get('/api/admin/dashboard', async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ status: 'error', message: 'Database disconnected.' });

    // Fetch the logged-in user ID from headers or query parameters
    const userId = req.headers['x-user-id'] || req.query.user_id;

    let userFullName = 'Administrator';
    let userAvatar = '../images/account.png'; // Fixed relative path

    let userRows = null;

    // 1. Try fetching specifically by the logged-in user ID if provided
    if (userId) {
      const { data: foundUser } = await supabase
        .from('users')
        .select('id, full_name, avatar')
        .eq('id', userId)
        .maybeSingle();
      
      if (foundUser) {
        userRows = foundUser;
      }
    }

    // 2. Fallback: If no user ID matched, grab the first available admin account
    if (!userRows) {
      const { data: defaultAdmin } = await supabase
        .from('users')
        .select('id, full_name, avatar')
        .eq('user_type', 'admin')
        .limit(1)
        .maybeSingle();
      
      if (defaultAdmin) {
        userRows = defaultAdmin;
      }
    }

    // Apply user details if found
    if (userRows) {
      if (userRows.full_name) userFullName = userRows.full_name;
      if (userRows.avatar && !userRows.avatar.includes('account.png')) {
        const cleanAvatar = userRows.avatar.replace(/^\/PHP/, '');
        userAvatar = /^(https?:|data:|\/)/i.test(cleanAvatar) ? cleanAvatar : '/' + cleanAvatar;
      }
    }

    // Top Level KPIs
    const { count: totalCustomers } = await supabase.from('users').select('*', { count: 'exact', head: true }).eq('user_type', 'customer');
    const { count: totalActiveStaff } = await supabase.from('users').select('*', { count: 'exact', head: true }).eq('user_type', 'employee').eq('is_active', true);
    const { count: totalStaff } = await supabase.from('users').select('*', { count: 'exact', head: true }).eq('user_type', 'employee');
    const { count: totalBatches } = await supabase.from('production_logs').select('*', { count: 'exact', head: true });

    // Recent Customers Feed
    const { data: recentCustomers } = await supabase.from('users')
      .select('id, full_name, email, created_at, avatar')
      .eq('user_type', 'customer')
      .order('created_at', { ascending: false })
      .limit(3);

    // Staff List Feed (Join with user_roles to get department names)
    const { data: staffList } = await supabase.from('users')
      .select('username, full_name, is_active, avatar, user_roles(roles(name))')
      .eq('user_type', 'employee')
      .order('created_at', { ascending: false })
      .limit(3);

    const formattedStaff = (staffList || []).map(staff => ({
      ...staff,
      role_name: staff.user_roles && staff.user_roles.length > 0 && staff.user_roles[0].roles ? staff.user_roles[0].roles.name : 'Staff'
    }));

    // Production Logs Feed (Join with recipes and users for details)
    const { data: productionLogs } = await supabase.from('production_logs')
      .select('batch_code, total_cups_produced, cooked_at, recipes(flavor_name), users(full_name)')
      .order('cooked_at', { ascending: false })
      .limit(3);

    const formattedLogs = (productionLogs || []).map(log => ({
      flavor_name: log.recipes ? log.recipes.flavor_name : 'Standard Batch',
      batch_code: log.batch_code,
      total_cups_produced: log.total_cups_produced,
      supervisor: log.users ? log.users.full_name : 'Staff'
    }));

    return res.json({
      status: 'success',
      user: { fullName: userFullName, avatar: userAvatar },
      stats: { 
        totalCustomers: totalCustomers || 0, 
        totalBatches: totalBatches || 0, 
        totalActiveStaff: totalActiveStaff || 0, 
        totalStaff: totalStaff || 0 
      },
      recentCustomers: recentCustomers || [],
      productionLogs: formattedLogs,
      staffList: formattedStaff
    });
  } catch (error) {
    console.error('Admin dashboard fetch error:', error);
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

// ==========================================
// MANAGEMENT ADMIN CUSTOMER RECORDS API
// ==========================================
app.get('/api/admin/customer-records', async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ status: 'error', message: 'Database disconnected.' });

    const userId = req.headers['x-user-id'] || req.query.user_id;
    let userFullName = 'Administrator';
    let userAvatar = '../images/account.png';

    // Fetch Logged-in Admin Info
    if (userId) {
      const { data: userRows } = await supabase.from('users').select('full_name, avatar').eq('id', userId).maybeSingle();
      if (userRows) {
        if (userRows.full_name) userFullName = userRows.full_name;
        if (userRows.avatar && !userRows.avatar.includes('account.png')) {
          let cleanAvatar = userRows.avatar.replace(/^\/PHP/, '');
          if (cleanAvatar.startsWith('http') || cleanAvatar.startsWith('data:')) {
             userAvatar = cleanAvatar;
          } else {
             userAvatar = /^(https?:|data:|\/)/i.test(cleanAvatar) ? cleanAvatar : '/' + cleanAvatar;
          }
        }
      }
    }

    // Top Level Customer Count
    const { count: totalAccounts } = await supabase.from('users').select('*', { count: 'exact', head: true }).eq('user_type', 'customer');

    // Fetch Customers joined with Users and Orders
    const { data: customersData, error: custErr } = await supabase
      .from('customers')
      .select(`
        id, user_id, phone, created_at,
        users(full_name, email, is_active, avatar),
        orders(total_amount, status)
      `)
      .order('id', { ascending: false });

    if (custErr) throw custErr;

    let corporateCount = 0;
    let repeatCustomers = 0;

    const formattedCustomers = (customersData || []).map(c => {
      const userObj = Array.isArray(c.users) ? c.users[0] : (c.users || {});
      const validOrders = (c.orders || []).filter(o => o.status === 'COMPLETED');
      const totalSpend = validOrders.reduce((sum, o) => sum + (parseFloat(o.total_amount) || 0), 0);
      
      if (validOrders.length > 1) repeatCustomers++;
      if (totalSpend >= 5000) corporateCount++; 

      let custAvatar = '../images/account.png';
      if (userObj.avatar && !userObj.avatar.includes('account.png')) {
        let cleanAvatar = userObj.avatar.replace(/^\/PHP/, '');
        // Fix: Prevent prepending relative slashes to absolute URLs
        if (cleanAvatar.startsWith('http') || cleanAvatar.startsWith('data:')) {
          custAvatar = cleanAvatar;
        } else {
          custAvatar = /^(https?:|data:|\/)/i.test(cleanAvatar) ? cleanAvatar : '/' + cleanAvatar;
        }
      }

      return {
        customer_id: c.id,
        user_id: c.user_id,
        member_since: c.created_at,
        phone: c.phone,
        full_name: userObj.full_name || 'Customer',
        email: userObj.email || 'No email provided',
        is_active: userObj.is_active !== false ? 1 : 0, 
        avatar: custAvatar,
        total_orders: validOrders.length,
        total_spend: totalSpend
      };
    });

    const repeatRate = totalAccounts > 0 ? (repeatCustomers / totalAccounts) * 100 : 0;

    return res.json({
      status: 'success',
      user: { fullName: userFullName, avatar: userAvatar },
      stats: { 
        totalAccounts: totalAccounts || formattedCustomers.length, 
        corporateCount: corporateCount, 
        repeatRate: repeatRate 
      },
      customers: formattedCustomers
    });
  } catch (error) {
    console.error('Customer Records Fetch Error:', error);
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

// ==========================================
// MANAGEMENT ADMIN PRODUCTION PLANNING API
// ==========================================
app.get('/api/admin/production-planning', async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ status: 'error', message: 'Database disconnected.' });

    const userId = req.headers['x-user-id'] || req.query.user_id;
    let userFullName = 'Administrator';
    let userAvatar = '../images/account.png';

    // 1. Fetch Logged-in Admin Info (with absolute URL protection)
    if (userId) {
      const { data: userRows } = await supabase.from('users').select('full_name, avatar').eq('id', userId).maybeSingle();
      if (userRows) {
        if (userRows.full_name) userFullName = userRows.full_name;
        if (userRows.avatar && !userRows.avatar.includes('account.png')) {
          let cleanAvatar = userRows.avatar.replace(/^\/PHP/, '');
          if (cleanAvatar.startsWith('http') || cleanAvatar.startsWith('data:')) {
            userAvatar = cleanAvatar;
          } else {
            userAvatar = /^(https?:|data:|\/)/i.test(cleanAvatar) ? cleanAvatar : '/' + cleanAvatar;
          }
        }
      }
    }

    // 2. Fetch Active Batches Count
    const { count: activeBatchesCount } = await supabase.from('production_logs').select('*', { count: 'exact', head: true });

    // 3. Fetch Recipes (For the Create Plan Dropdown)
    const { data: recipesList } = await supabase.from('recipes').select('id, flavor_name, yield_servings');

    // 4. Fetch Employees/Supervisors (For the Create Plan Dropdown)
    const { data: staffList } = await supabase.from('users').select('id, full_name').eq('user_type', 'employee').eq('is_active', true);

    // 5. Fetch Production Logs to populate the Table
    const { data: plansData, error: plansErr } = await supabase
      .from('production_logs')
      .select(`
        id, batch_code, total_cups_produced, cooked_at,
        recipes ( flavor_name ),
        users ( full_name )
      `)
      .order('cooked_at', { ascending: false });

    if (plansErr) throw plansErr;

    const formattedPlans = (plansData || []).map(p => ({
      id: p.id,
      batch_code: p.batch_code,
      total_cups_produced: p.total_cups_produced,
      cooked_at: p.cooked_at,
      flavor_name: p.recipes ? p.recipes.flavor_name : 'Standard Batch',
      supervisor: p.users ? p.users.full_name : 'Staff'
    }));

    return res.json({
      status: 'success',
      user: { fullName: userFullName, avatar: userAvatar },
      activeBatchesCount: activeBatchesCount || 0,
      recipesList: recipesList || [],
      staffList: staffList || [],
      plans: formattedPlans
    });
  } catch (error) {
    console.error('Production Planning Fetch Error:', error);
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

// ==========================================
// MANAGEMENT ADMIN CREATE PRODUCTION PLAN
// ==========================================
app.post('/api/admin/create-plan', async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ status: 'error', message: 'Database disconnected.' });

    const { recipe_id, batch_code, total_cups_produced, cooked_by } = req.body;
    if (!recipe_id || !total_cups_produced || !cooked_by) {
      return res.status(400).json({ status: 'error', message: 'recipe_id, total_cups_produced, and cooked_by are required.' });
    }

    const { data, error } = await supabase
      .from('production_logs')
      .insert([{
        recipe_id: recipe_id,
        batch_code: batch_code,
        total_cups_produced: total_cups_produced,
        user_id: cooked_by, // Links to the Supervisor's ID
        cooked_at: new Date().toISOString()
      }])
      .select()
      .single();
      
    if (error) throw error;

    logActivity(supabase, {
      req,
      action: 'production.plan_created',
      category: 'production',
      description: `Created a production plan${batch_code ? ` (batch ${batch_code})` : ''} for ${total_cups_produced} cups`,
      targetType: 'production_log',
      targetId: data.id,
      targetLabel: batch_code || null,
      metadata: { recipe_id, total_cups_produced, cooked_by }
    });

    return res.json({ status: 'success', plan: data });
  } catch (error) {
    console.error('Create Plan Error:', error);
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

// ==========================================
// MANAGEMENT ADMIN EMPLOYEE RECORDS API 
// ==========================================
app.get('/api/admin/employee-records', async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ status: 'error', message: 'Database disconnected.' });

    const userId = req.headers['x-user-id'] || req.query.user_id;
    let userFullName = 'Administrator';
    let userAvatar = '../images/account.png';

    // 1. Fetch Logged-in Admin Info
    if (userId) {
      const { data: userRows } = await supabase.from('users').select('full_name, avatar').eq('id', userId).maybeSingle();
      if (userRows) {
        if (userRows.full_name) userFullName = userRows.full_name;
        if (userRows.avatar && !userRows.avatar.includes('account.png')) {
          let cleanAvatar = userRows.avatar.replace(/^\/PHP/, '');
          if (cleanAvatar.startsWith('http') || cleanAvatar.startsWith('data:')) {
            userAvatar = cleanAvatar;
          } else {
            userAvatar = /^(https?:|data:|\/)/i.test(cleanAvatar) ? cleanAvatar : '/' + cleanAvatar;
          }
        }
      }
    }

    // 2. Headcount Stats
    const { count: totalHeadcount } = await supabase.from('users').select('*', { count: 'exact', head: true }).eq('user_type', 'employee');
    const { count: activeToday } = await supabase.from('users').select('*', { count: 'exact', head: true }).eq('user_type', 'employee').eq('is_active', true);
    
    // 3. Fetch Employees (Joining users to their employee specific table,
    // plus their assigned system role/position via user_roles -> roles).
    // The employees.job_title column is free text an admin can leave blank
    // ("Unassigned"), but the role assigned through user_roles is what
    // actually drives dashboard routing at login (see authRoutes.js
    // employee-login) - so that's the real "position" to show here.
    const { data: employeesData } = await supabase
      .from('users')
      .select(`
        id, username, email, full_name, is_active, avatar, created_at,
        employees(id, employee_code, job_title, department, gender),
        user_roles(role_id, roles(id, name))
      `)
      .eq('user_type', 'employee')
      .order('created_at', { ascending: false });

    const formattedEmployees = (employeesData || []).map(u => {
      const empDetails = Array.isArray(u.employees) ? (u.employees[0] || {}) : (u.employees || {});
      const userRole = (u.user_roles && u.user_roles.length > 0) ? u.user_roles[0] : null;

      const position = (userRole && userRole.roles) ? userRole.roles.name : null;

      let empAvatar = '../images/account.png';
      if (u.avatar && !u.avatar.includes('account.png')) {
        let cleanAvatar = u.avatar.replace(/^\/PHP/, '');
        if (cleanAvatar.startsWith('http') || cleanAvatar.startsWith('data:')) {
          empAvatar = cleanAvatar;
        } else {
          empAvatar = /^(https?:|data:|\/)/i.test(cleanAvatar) ? cleanAvatar : '/' + cleanAvatar;
        }
      }

      return {
        id: u.id,
        user_id: u.id,
        // The employees table has its own primary key, separate from
        // users.id - this is the id edit-employee must use to update the
        // right row (previously the frontend was sending users.id here,
        // which silently failed to match any employees row on save).
        emp_id: empDetails.id || null,
        employee_code: empDetails.employee_code || 'EMP-' + String(u.id).padStart(3, '0'),
        full_name: u.full_name,
        username: u.username,
        email: u.email,
        job_title: empDetails.job_title || 'Unassigned',
        position: position || empDetails.job_title || 'Unassigned',
        role_name: position || empDetails.job_title || 'Unassigned',
        // Current role_id, so the Job Title dropdown can be pre-selected
        // to whatever role this employee actually has today.
        role_id: userRole ? userRole.role_id : null,
        department: empDetails.department || 'General',
        gender: empDetails.gender || 'Not Specified',
        is_active: u.is_active ? 1 : 0,
        avatar: empAvatar,
        created_at: u.created_at
      };
    });

    return res.json({
      status: 'success',
      user: { fullName: userFullName, avatar: userAvatar },
      stats: { totalHeadcount: totalHeadcount || 0, activeToday: activeToday || 0 },
      employees: formattedEmployees
    });
  } catch (error) {
    console.error('Employee Records Fetch Error:', error);
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

// STATUS TOGGLE ENDPOINT (For Active/Inactive dropdown)
app.post('/api/admin/employee-records/status', async (req, res) => {
  try {
    if (!supabase) throw new Error('Database disconnected');
    const { id, is_active } = req.body;

    const { data: targetUser } = await supabase.from('users').select('full_name').eq('id', id).maybeSingle();

    // Update the is_active flag in the main users table
    const { error: userErr } = await supabase.from('users').update({ is_active: is_active === 1 }).eq('id', id);
    if (userErr) throw userErr;

    const activated = is_active === 1;
    logActivity(supabase, {
      req,
      action: activated ? 'employee.activated' : 'employee.deactivated',
      category: 'employee',
      description: `${activated ? 'Activated' : 'Deactivated'} employee "${targetUser?.full_name || ('#' + id)}"`,
      targetType: 'employee',
      targetId: id,
      targetLabel: targetUser?.full_name || null
    });

    return res.json({ success: true });
  } catch (error) {
     return res.status(500).json({ success: false, error: error.message });
  }
});



// ==========================================
// MANAGEMENT ADMIN ACTIVITY LOGS API
// ==========================================
app.get('/api/admin/activity-logs', async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ status: 'error', message: 'Database disconnected.' });

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let query = supabase
      .from('activity_logs')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false });

    const category = (req.query.category || '').trim();
    if (category && category !== 'all') {
      query = query.eq('category', category);
    }

    if (req.query.date_from) {
      query = query.gte('created_at', new Date(req.query.date_from + 'T00:00:00').toISOString());
    }
    if (req.query.date_to) {
      query = query.lte('created_at', new Date(req.query.date_to + 'T23:59:59.999').toISOString());
    }

    const q = (req.query.q || '').trim();
    if (q) {
      const escaped = q.replace(/[%,]/g, '');
      query = query.or(
        `description.ilike.%${escaped}%,actor_name.ilike.%${escaped}%,target_label.ilike.%${escaped}%,action.ilike.%${escaped}%`
      );
    }

    query = query.range(from, to);

    const { data: logs, error, count } = await query;
    if (error) throw error;

    // Resolve the current avatar (and backfill name/type for older rows
    // that only stored actor_id) for every actor referenced on this page,
    // in one extra query. The log row itself never stored a photo, so the
    // pfp has to come from a live lookup against `users` - it also means
    // the avatar shown always reflects the actor's *current* photo.
    const idsToResolve = [...new Set((logs || []).filter(l => l.actor_id).map(l => l.actor_id))];
    let actorMap = {};
    if (idsToResolve.length) {
      const { data: actors, error: actorsError } = await supabase.from('users').select('id, full_name, user_type, avatar').in('id', idsToResolve);
      if (actorsError) {
        console.error('[activity-logs] actor avatar lookup failed:', actorsError.message);
      }
      (actors || []).forEach(a => { actorMap[a.id] = a; });
    }

    // Same "account.png" fallback / legacy "/PHP" path cleanup used
    // elsewhere in this file, so log avatars render the same way employee
    // and customer avatars do.
    const resolveActorAvatar = (rawAvatar) => {
      if (!rawAvatar || rawAvatar.includes('account.png')) return null;
      const cleanAvatar = rawAvatar.replace(/^\/PHP/, '');
      if (cleanAvatar.startsWith('http') || cleanAvatar.startsWith('data:')) return cleanAvatar;
      return /^(https?:|data:|\/)/i.test(cleanAvatar) ? cleanAvatar : '/' + cleanAvatar;
    };

    const formatted = (logs || []).map(l => {
      const actor = l.actor_id ? actorMap[l.actor_id] : null;
      return {
        id: l.id,
        actorId: l.actor_id,
        actorName: l.actor_name || (actor && actor.full_name) || 'System',
        actorType: l.actor_type || (actor && actor.user_type) || null,
        actorRole: l.actor_role,
        actorAvatar: resolveActorAvatar(actor && actor.avatar),
        action: l.action,
        category: l.category,
        description: l.description,
        targetType: l.target_type,
        targetId: l.target_id,
        targetLabel: l.target_label,
        metadata: l.metadata,
        createdAt: l.created_at
      };
    });

    return res.json({
      status: 'success',
      logs: formatted,
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages: Math.max(1, Math.ceil((count || 0) / limit))
      }
    });
  } catch (error) {
    console.error('[activity-logs] fetch error:', error.message);
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

// ==========================================
// MANAGEMENT CEO SHARED HELPERS
// Every CEO number comes from the database. Anything the system does not
// track (yet) is returned as null so the UI can show "—" instead of an
// invented value.
// ==========================================
const CEO_SALE_STATUSES = ['PAID_VERIFIED', 'COMPLETED'];   // same definition of "realized revenue" the Finance Officer uses
const CEO_MAJOR_THRESHOLD = 500;                             // > PHP 500 needs CEO sign-off (see routeForAmount in employeeRoutes.js)
const CEO_PH_OFFSET_MS = 8 * 60 * 60 * 1000;                 // Asia/Manila, so month/year buckets match what staff see

function ceoPhParts(value) {
  const t = new Date(value).getTime();
  if (isNaN(t)) return null;
  const d = new Date(t + CEO_PH_OFFSET_MS);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() };
}

function ceoPeso(n) {
  return '₱' + (parseFloat(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Supabase returns at most 1000 rows per request, which silently truncates
// totals once the business grows. Page through everything instead.
async function ceoFetchAll(buildQuery, pageSize = 1000) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await buildQuery().range(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

// The logged-in CEO, taken from the signed session cookie (req.staff).
async function getCeoProfile(req) {
  const id = req.staff && req.staff.id;
  let fullName = '';
  let avatarSrc = null;
  if (id) {
    const { data: row } = await supabase
      .from('users')
      .select('id, full_name, avatar')
      .eq('id', id)
      .maybeSingle();
    if (row) {
      fullName = row.full_name || '';
      if (row.avatar && !row.avatar.includes('account.png')) {
        const cleanAvatar = row.avatar.replace(/^\/PHP/, '');
        avatarSrc = /^(https?:|data:|\/)/i.test(cleanAvatar) ? cleanAvatar : '/' + cleanAvatar;
      }
    }
  }
  return { fullName, avatar: avatarSrc || '../images/account.png', avatarSrc };
}

function ceoCleanLabel(raw) {
  const c = String(raw || '')
    .replace(/\s*\((8oz|12oz)\)/gi, '')
    .replace(/(\+.*|\[.*\])/g, '')
    .replace(/^(8oz|12oz)\s*/gi, '')
    .trim();
  return c || 'Custom drink';
}

// Anything that is not clearly one of the three core flavors goes to "other"
// instead of being silently counted as Coffee Jelly.
function ceoFlavorKey(item) {
  const label = String(item.item_label || '').toLowerCase();
  const fId = parseInt(item.flavor_value_id, 10);
  if (label.includes('strawberr') || fId === 3) return 'strawberry';
  if (label.includes('pandan') || fId === 4) return 'pandan';
  if (label.includes('coffee')) return 'coffee';
  return 'other';
}

async function ceoLoadSaleOrders() {
  return ceoFetchAll(() => supabase
    .from('orders')
    .select('id, placed_at, total_amount, guest_name, order_items(line_total, quantity, item_label, flavor_value_id)')
    .in('status', CEO_SALE_STATUSES)
    .order('id', { ascending: true }));
}

function ceoAggregateSales(orders) {
  const nowParts = ceoPhParts(Date.now());
  const curYear = nowParts.year;
  const years = [curYear - 3, curYear - 2, curYear - 1, curYear];
  const keys = ['coffee', 'strawberry', 'pandan', 'other'];

  const monthlyRev = {}, yearlyRev = {}, monthlyUnits = {};
  keys.forEach(k => {
    monthlyRev[k] = new Array(12).fill(0);
    monthlyUnits[k] = new Array(12).fill(0);
    yearlyRev[k] = [0, 0, 0, 0];
  });

  let totalSales = 0, guestOrders = 0, totalCups = 0;
  const flavorMap = new Map();

  orders.forEach(o => {
    totalSales += parseFloat(o.total_amount) || 0;
    if (o.guest_name) guestOrders++;
    const parts = ceoPhParts(o.placed_at);

    (o.order_items || []).forEach(it => {
      const amt = parseFloat(it.line_total) || 0;
      const qty = parseInt(it.quantity, 10) || 0;
      const key = ceoFlavorKey(it);
      totalCups += qty;

      if (parts) {
        if (parts.year === curYear) {
          monthlyRev[key][parts.month] += amt;
          monthlyUnits[key][parts.month] += qty;
        }
        const yi = years.indexOf(parts.year);
        if (yi >= 0) yearlyRev[key][yi] += amt;
      }

      const name = ceoCleanLabel(it.item_label);
      const fk = name.toLowerCase();
      if (!flavorMap.has(fk)) flavorMap.set(fk, { flavor: name, sold: 0, revenue: 0 });
      const f = flavorMap.get(fk);
      f.sold += qty;
      f.revenue += amt;
    });
  });

  const flavorContributions = [...flavorMap.values()]
    .sort((a, b) => b.revenue - a.revenue || b.sold - a.sold)
    .map(f => ({
      flavor: f.flavor,
      category: null,   // the menu has no category on order lines
      sold: f.sold,
      revenue: Math.round(f.revenue * 100) / 100,
      cogs: null,       // COGS is only tracked as a lump sum in expenses, not per flavor
      margin: null
    }));

  return {
    curYear, years, totalSales, guestOrders, totalCups,
    orderCount: orders.length,
    monthlyRev, yearlyRev, monthlyUnits, flavorContributions
  };
}

// Net margin, computed the same way the Finance Officer revenue page does it.
// null when there is no COGS on record (so we never show an invented margin).
async function ceoComputeMargin(totalRevenue) {
  let expenses;
  try {
    expenses = await ceoFetchAll(() => supabase
      .from('expenses')
      .select('amount, status, category')
      .order('id', { ascending: true }));
  } catch (e) {
    // expenses.category not migrated yet (Postgres 42703): no COGS can be identified, so margin stays null.
    if (e && e.code === '42703') {
      console.warn('[ceo] expenses.category column is missing; run the migration to enable net margin.');
      return null;
    }
    throw e;
  }
  const cogs = expenses
    .filter(e => e.category === 'cogs' && ['APPROVED', 'PURCHASED'].includes(e.status))
    .reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
  if (cogs > 0 && totalRevenue > 0) {
    return Math.round(((totalRevenue - cogs) / totalRevenue) * 1000) / 10;
  }
  return null;
}

// ERP benchmark KPIs. Only DSO can be derived from data we actually store:
// unpaid orders / last-30-day realized revenue * 30. O2C, OTD and FPY need
// timestamps / QC records that the system does not capture, so they are null.
async function ceoComputeBenchmarks(orders) {
  let dso = null;
  try {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const revenue30 = orders
      .filter(o => new Date(o.placed_at).getTime() >= cutoff)
      .reduce((s, o) => s + (parseFloat(o.total_amount) || 0), 0);
    const unpaidRows = await ceoFetchAll(() => supabase
      .from('orders')
      .select('total_amount')
      .eq('status', 'PENDING_PAYMENT')
      .order('id', { ascending: true }));
    const unpaid = unpaidRows.reduce((s, o) => s + (parseFloat(o.total_amount) || 0), 0);
    if (revenue30 > 0) dso = Math.round((unpaid / revenue30) * 30 * 10) / 10;
  } catch (e) {
    console.warn('[ceo] could not compute DSO:', e.message);
  }
  return { dso, o2c: null, otd: null, fpy: null };
}

// id -> { name, role } for a set of user ids
async function ceoRequesterMap(ids) {
  const map = {};
  const unique = [...new Set((ids || []).filter(Boolean))];
  if (!unique.length) return map;
  const { data } = await supabase
    .from('users')
    .select('id, full_name, user_roles(roles(name))')
    .in('id', unique);
  (data || []).forEach(u => {
    const ur = Array.isArray(u.user_roles) ? u.user_roles[0] : u.user_roles;
    const roleObj = ur && ur.roles;
    const role = Array.isArray(roleObj) ? (roleObj[0] && roleObj[0].name) : (roleObj && roleObj.name);
    map[u.id] = { name: u.full_name || '', role: role || '' };
  });
  return map;
}

function ceoCustomerNameFromOrder(o) {
  const userObj = Array.isArray(o.customers) ? (o.customers[0] && o.customers[0].users) : (o.customers && o.customers.users);
  const u = Array.isArray(userObj) ? userObj[0] : userObj;
  return (u && u.full_name) || o.guest_name || 'Walk-in Counter';
}

// ==========================================
// MANAGEMENT CEO ANALYTICS API (Supabase)
// ==========================================
app.get('/api/ceo/analytics', async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ status: 'error', message: 'Database disconnected.' });

    const user = await getCeoProfile(req);
    const orders = await ceoLoadSaleOrders();
    const agg = ceoAggregateSales(orders);

    // Orders still moving through the pipeline (not finished, not cancelled)
    const { count: activePreOrders } = await supabase
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .not('status', 'in', '(COMPLETED,CANCELLED)');

    // Customer satisfaction: straight from the ratings table
    let sentiment = null;
    try {
      const ratings = await ceoFetchAll(() => supabase
        .from('ratings')
        .select('id, rating_score, review_text, product_title, created_at')
        .order('id', { ascending: false }));
      const scored = ratings.filter(r => Number.isFinite(parseFloat(r.rating_score)));
      if (scored.length) {
        const pct = n => Math.round((n / scored.length) * 1000) / 10;
        const positive = scored.filter(r => r.rating_score >= 4);
        const neutral = scored.filter(r => r.rating_score === 3);
        const negative = scored.filter(r => r.rating_score <= 2);
        const snippet = r => r ? {
          text: String(r.review_text).trim().slice(0, 180),
          product: r.product_title || '',
          score: r.rating_score,
          created_at: r.created_at
        } : null;
        sentiment = {
          count: scored.length,
          average: Math.round((scored.reduce((s, r) => s + Number(r.rating_score), 0) / scored.length) * 10) / 10,
          positivePct: pct(positive.length),
          neutralPct: pct(neutral.length),
          negativePct: pct(negative.length),
          latestPositive: snippet(positive.find(r => r.review_text && String(r.review_text).trim())),
          latestCritical: snippet(negative.find(r => r.review_text && String(r.review_text).trim()))
        };
      }
    } catch (e) {
      console.warn('[ceo analytics] could not read ratings:', e.message);
    }

    const benchmarks = await ceoComputeBenchmarks(orders);
    const registeredOrders = Math.max(0, agg.orderCount - agg.guestOrders);

    return res.json({
      status: 'success',
      user,
      overview: {
        totalSales: agg.totalSales,
        activePreOrders: activePreOrders || 0,
        realizedCups: agg.totalCups,
        realizedOrders: agg.orderCount
      },
      sentiment,
      benchmarks,
      charts: {
        monthsLabels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
        yearsLabels: agg.years.map(String),
        monthlyRevCoffee: agg.monthlyRev.coffee,
        monthlyRevStrawberry: agg.monthlyRev.strawberry,
        monthlyRevPandan: agg.monthlyRev.pandan,
        monthlyRevOther: agg.monthlyRev.other,
        yearlyRevCoffee: agg.yearlyRev.coffee,
        yearlyRevStrawberry: agg.yearlyRev.strawberry,
        yearlyRevPandan: agg.yearlyRev.pandan,
        yearlyRevOther: agg.yearlyRev.other,
        // share of realized orders by who placed them (no corporate accounts exist in the data model)
        customerLabels: ['Registered', 'Guests'],
        customerData: [registeredOrders, agg.guestOrders]
      },
      flavorContributions: agg.flavorContributions
    });
  } catch (error) {
    console.error('CEO analytics fetch error:', error);
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

// ==========================================
// MANAGEMENT CEO BUDGET APPROVAL API
// Real workflow: Procurement raises an expense; > PHP 500 becomes PENDING_CEO.
// Sales Officer pitches a promo; it sits at PENDING_APPROVAL until the CEO acts.
// ==========================================
app.get('/api/ceo/budget-approval', async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ status: 'error', message: 'Database disconnected.' });

    const user = await getCeoProfile(req);

    // Major-tier expenses (pending + already decided)
    const allExpenses = await ceoFetchAll(() => supabase
      .from('expenses')
      .select('*')
      .in('status', ['PENDING_CEO', 'APPROVED', 'PURCHASED', 'REJECTED'])
      .order('id', { ascending: false }));
    const majorExpenses = allExpenses.filter(e => (parseFloat(e.amount) || 0) > CEO_MAJOR_THRESHOLD);

    const promoRows = await ceoFetchAll(() => supabase
      .from('promotions')
      .select('*')
      .order('id', { ascending: false }));

    const requesterMap = await ceoRequesterMap(majorExpenses.map(e => e.requested_by));

    const prCode = e => `PR-${1000 + e.id}`;

    const inventoryRequests = majorExpenses
      .filter(e => e.status === 'PENDING_CEO')
      .map(e => {
        const r = requesterMap[e.requested_by] || { name: '', role: '' };
        return {
          id: e.id,
          pr_code: prCode(e),
          name: e.item_name || '',
          item_name: e.item_name || '',
          supplier: e.store_name || '',
          store_name: e.store_name || '',
          requester_name: r.name,
          requester_role: r.role,
          amount: parseFloat(e.amount) || 0,
          notes: e.notes || '',
          expense_date: e.expense_date || null,
          created_at: e.created_at || null
        };
      });

    const promotionRequests = promoRows
      .filter(p => p.status === 'PENDING_APPROVAL')
      .map(p => ({
        id: p.id,
        code: p.code,
        title: p.title || '',
        pitch_note: p.pitch_note || '',
        target_segment: p.target_segment || 'all',
        discount_type: p.discount_type,
        discount_value: parseFloat(p.discount_value) || 0,
        min_spend: p.min_spend,
        usage_cap: p.usage_cap,
        created_at: p.created_at || null
      }));

    const promoValue = p => p.discount_type === 'percent'
      ? `${parseFloat(p.discount_value) || 0}% OFF`
      : `${ceoPeso(p.discount_value)} Flat`;

    const history = [];
    majorExpenses.filter(e => e.status !== 'PENDING_CEO').forEach(e => {
      const r = requesterMap[e.requested_by] || { name: '', role: '' };
      history.push({
        type: 'Purchase Requisition',
        type_label: 'Purchase Requisition',
        reference: `${prCode(e)} · ${e.item_name || ''}`.trim(),
        title: e.item_name || '',
        value_display: ceoPeso(e.amount),
        requester: r.name,
        status: e.status === 'REJECTED' ? 'REJECTED' : 'APPROVED',
        decided_at: e.updated_at || e.created_at || null
      });
    });
    // Only promos that went through a pitch (they carry a pitch note) are CEO decisions
    promoRows
      .filter(p => ['ACTIVE', 'EXPIRED', 'REJECTED'].includes(p.status) && p.pitch_note)
      .forEach(p => {
        history.push({
          type: 'Promo Campaign',
          type_label: 'Promo Campaign',
          reference: p.code,
          title: p.title || p.code,
          value_display: promoValue(p),
          requester: 'Sales Officer',
          status: p.status === 'REJECTED' ? 'REJECTED' : 'APPROVED',
          decided_at: p.updated_at || p.created_at || null
        });
      });
    history.sort((a, b) => new Date(b.decided_at || 0) - new Date(a.decided_at || 0));

    return res.json({
      status: 'success',
      user,
      overview: {
        pendingInventory: inventoryRequests.length,
        pendingPromos: promotionRequests.length,
        approved: history.filter(h => h.status === 'APPROVED').length,
        rejected: history.filter(h => h.status === 'REJECTED').length
      },
      inventoryRequests,
      promotionRequests,
      decisionHistory: history
    });
  } catch (error) {
    console.error('Budget approval fetch error:', error);
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

app.post('/api/ceo/budget-approval/action', async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ status: 'error', message: 'Database disconnected.' });

    const body = req.body || {};
    const type = body.type || 'expense';
    const id = body.id !== undefined && body.id !== null ? body.id : body.expense_id;
    const act = String(body.action || '').toLowerCase();
    const reason = String(body.rejection_reason || '').trim();

    if (!id || !['approve', 'reject'].includes(act)) {
      return res.status(400).json({ status: 'error', message: 'Missing id or a valid action (approve / reject).' });
    }
    if (act === 'reject' && !reason) {
      return res.status(400).json({ status: 'error', message: 'A justification is required to reject a request.' });
    }

    let label = '';
    if (type === 'expense') {
      const newStatus = act === 'approve' ? 'APPROVED' : 'REJECTED';
      const { data: row, error } = await supabase
        .from('expenses')
        .update({ status: newStatus })
        .eq('id', id)
        .eq('status', 'PENDING_CEO')           // can only act on requests that are actually waiting for the CEO
        .select('id, item_name, amount')
        .maybeSingle();
      if (error) throw error;
      if (!row) return res.status(409).json({ status: 'error', message: 'This requisition is no longer awaiting CEO approval.' });
      label = `PR-${1000 + row.id} ${row.item_name || ''}`.trim();
    } else if (type === 'promotion') {
      const patch = act === 'approve' ? { status: 'ACTIVE' } : { status: 'REJECTED', rejection_reason: reason };
      const { data: row, error } = await supabase
        .from('promotions')
        .update(patch)
        .eq('id', id)
        .eq('status', 'PENDING_APPROVAL')
        .select('id, code')
        .maybeSingle();
      if (error) throw error;
      if (!row) return res.status(409).json({ status: 'error', message: 'This promotion is no longer awaiting CEO approval.' });
      label = row.code;
    } else {
      return res.status(400).json({ status: 'error', message: 'Unknown approval type.' });
    }

    logActivity(supabase, {
      req,
      action: `${type === 'expense' ? 'expense' : 'promotion'}.${act === 'approve' ? 'approved' : 'rejected'}`,
      category: 'approval',
      description: `${act === 'approve' ? 'Approved' : 'Rejected'} ${type === 'expense' ? 'purchase requisition' : 'promotion'} "${label}"${reason ? ` — ${reason}` : ''}`,
      targetType: type,
      targetId: id,
      targetLabel: label
    });

    return res.json({ status: 'success', message: `Successfully ${act === 'approve' ? 'approved' : 'rejected'}.` });
  } catch (error) {
    console.error('Budget approval action error:', error);
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

// ==========================================
// MANAGEMENT CEO ENTERPRISE AUDIT API
// Real realized orders + real drawer reconciliations (Z-readings).
// ==========================================
app.get('/api/ceo/enterprise-audit', async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ status: 'error', message: 'Database disconnected.' });

    const user = await getCeoProfile(req);

    const saleOrders = await ceoFetchAll(() => supabase
      .from('orders')
      .select('id, order_number, status, total_amount, placed_at, guest_name, payment_method, transaction_id, customers(users(full_name))')
      .in('status', CEO_SALE_STATUSES)
      .order('id', { ascending: false }));

    const settledTurnover = saleOrders.reduce((s, o) => s + (parseFloat(o.total_amount) || 0), 0);

    const orders = saleOrders
      .sort((a, b) => new Date(b.placed_at || 0) - new Date(a.placed_at || 0))
      .slice(0, 500)
      .map(o => ({
        id: o.id,
        order_number: o.order_number,
        customer_name: ceoCustomerNameFromOrder(o),
        payment_method: o.payment_method || null,
        transaction_id: o.transaction_id || null,
        total_amount: parseFloat(o.total_amount) || 0,
        status: o.status,
        placed_at: o.placed_at
      }));

    const { data: reconRows, error: reconErr } = await supabase
      .from('drawer_reconciliations')
      .select('id, counted_amount, expected_amount, variance, period_start, period_end, notes, created_at, recorded_by')
      .order('period_end', { ascending: false })
      .limit(200);
    if (reconErr) throw reconErr;

    const recorderMap = await ceoRequesterMap((reconRows || []).map(r => r.recorded_by));

    const reconciliations = (reconRows || []).map(r => {
      const expected = r.expected_amount !== null && r.expected_amount !== undefined ? parseFloat(r.expected_amount) : null;
      // The Finance Officer's Z-reading stores "Walk-in Cash: ₱X" in the notes; expected = float + walk-in cash.
      const m = /Walk-in Cash:\s*₱\s*([\d,]+(?:\.\d+)?)/.exec(r.notes || '');
      const walkinCash = m ? parseFloat(m[1].replace(/,/g, '')) : null;
      const opening = (expected !== null && walkinCash !== null) ? Math.round((expected - walkinCash) * 100) / 100 : null;
      const rec = recorderMap[r.recorded_by];
      return {
        id: r.id,
        period_start: r.period_start,
        period_end: r.period_end,
        created_at: r.created_at,
        opening_float: opening,
        expected_amount: expected,
        counted_amount: r.counted_amount !== null && r.counted_amount !== undefined ? parseFloat(r.counted_amount) : null,
        variance: parseFloat(r.variance) || 0,
        notes: r.notes || '',
        recorded_by_name: rec ? rec.name : ''
      };
    });

    return res.json({
      status: 'success',
      user,
      totals: { settledTurnover, orderCount: saleOrders.length },
      orders,
      reconciliations
    });
  } catch (error) {
    console.error('CEO enterprise audit fetch error:', error);
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

// ==========================================
// MANAGEMENT CEO STAFF DIRECTORY API
// ==========================================
app.get('/api/ceo/staff-directory', async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ status: 'error', message: 'Database disconnected.' });

    const user = await getCeoProfile(req);

    // 1. Fetch available departments/roles (excluding CEO)
    const { data: rolesData, error: rolesErr } = await supabase.from('roles').select('name').neq('name', 'CEO').order('id', { ascending: true });
    if (rolesErr) throw rolesErr;
    const departments = (rolesData || []).map(r => r.name);

    // 2. Fetch staff members (Strictly employees and admins only)
    const { data: staffData, error: staffErr } = await supabase
      .from('users')
      .select(`
        id, username, full_name, email, created_at, avatar, user_type,
        user_roles(roles(name))
      `)
      .in('user_type', ['employee', 'admin']) // This explicitly blocks customers
      .order('id', { ascending: true });
    if (staffErr) throw staffErr;

    const staffEmployees = (staffData || []).map(row => {
      // No created_at means unknown: never substitute today's date as a hire date.
      const dateObj = row.created_at ? new Date(row.created_at) : null;
      const validDate = dateObj && !isNaN(dateObj.getTime());
      const dateIso = validDate ? dateObj.toISOString().split('T')[0] : null;
      const dateFormatted = validDate ? dateObj.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' }) : '—';

      let dept = row.user_type ? row.user_type.charAt(0).toUpperCase() + row.user_type.slice(1) : 'Staff';
      if (row.user_roles && row.user_roles.length > 0 && row.user_roles[0].roles) {
        dept = row.user_roles[0].roles.name;
      }

      let empAvatar = '../images/account.png';
      if (row.avatar && !row.avatar.includes('account.png')) {
        const cleanAvatar = row.avatar.replace(/^\/PHP/, '');
        empAvatar = /^(https?:|data:|\/)/i.test(cleanAvatar) ? cleanAvatar : '/' + cleanAvatar;
        if (empAvatar.startsWith('/images/')) {
          empAvatar = '..' + empAvatar; // Format relative path for CEO subfolder
        }
      }

      return {
        id: row.id,
        username: row.username,
        department: dept,
        date_joined: dateIso,
        date_joined_formatted: dateFormatted,
        email: row.email,
        avatar: empAvatar
      };
    });

    return res.json({
      status: 'success',
      user,
      departments: departments,
      employees: staffEmployees
    });

  } catch (error) {
    console.error('CEO staff directory fetch error:', error);
    return res.status(500).json({ status: 'error', message: error.message });
  }
});


// ==========================================
// MANAGEMENT ADMIN CUSTOMER STATUS TOGGLE
// ==========================================
app.post('/api/admin/customer-records/status', async (req, res) => {
  try {
    if (!supabase) throw new Error('Database disconnected');
    const { id, is_active } = req.body;

    if (!id) {
      return res.status(400).json({ success: false, error: 'Missing customer id.' });
    }

    // "id" here is the customers.id (customer_id), so resolve the linked user first.
    const { data: customerRow, error: custErr } = await supabase
      .from('customers')
      .select('user_id, users(full_name)')
      .eq('id', id)
      .maybeSingle();

    if (custErr) throw custErr;
    if (!customerRow) {
      return res.status(404).json({ success: false, error: 'Customer not found.' });
    }

    const activated = is_active === 1 || is_active === '1' || is_active === true;

    const { error: userErr } = await supabase
      .from('users')
      .update({ is_active: activated })
      .eq('id', customerRow.user_id);

    if (userErr) throw userErr;

    const customerName = customerRow.users?.full_name;
    logActivity(supabase, {
      req,
      action: activated ? 'customer.activated' : 'customer.deactivated',
      category: 'customer',
      description: `${activated ? 'Activated' : 'Deactivated'} customer account "${customerName || ('#' + id)}"`,
      targetType: 'customer',
      targetId: id,
      targetLabel: customerName || null
    });

    return res.json({ success: true });
  } catch (error) {
    console.error('Customer status toggle error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// MANAGEMENT ADMIN ADD / EDIT EMPLOYEE
// ==========================================
const employeeAvatarUpload = (req, res, next) => {
  if (upload) {
    return upload.single('avatar_file')(req, res, next);
  }
  next();
};

// Predefined roles the admin can assign when adding an employee. Sourced
// from the same `roles` table (excluding CEO) already used to build the
// department/role list on the CEO Staff Directory page, so the dropdown
// always reflects the real, existing set of roles instead of free text.
app.get('/api/admin/roles', async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ status: 'error', message: 'Database disconnected.' });

    const { data: rolesData, error } = await supabase
      .from('roles')
      .select('id, name')
      .neq('name', 'CEO')
      .order('id', { ascending: true });

    if (error) throw error;

    return res.json({ status: 'success', roles: rolesData || [] });
  } catch (error) {
    console.error('[admin/roles] error:', error.message);
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

app.post('/api/admin/add-employee', employeeAvatarUpload, async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ status: 'error', message: 'Database disconnected.' });

    const { username, email, password, confirm_password, gender, role_id } = req.body;
    const full_name = String(req.body.full_name || '').trim();

    if (!username || !email || !password || !full_name || !role_id) {
      return res.status(400).json({ status: 'error', message: 'Missing required fields.' });
    }
    if (String(password).length < 8) {
      return res.status(400).json({ status: 'error', message: 'Initial password must be at least 8 characters.' });
    }
    if (confirm_password !== undefined && String(confirm_password) !== String(password)) {
      return res.status(400).json({ status: 'error', message: 'Initial password and confirmation do not match.' });
    }

    // Resolve the chosen role against the real `roles` table rather than
    // trusting free text, so job_title always matches an existing role name.
    const { data: selectedRole, error: roleErr } = await supabase
      .from('roles')
      .select('id, name')
      .eq('id', role_id)
      .maybeSingle();

    if (roleErr) throw roleErr;
    if (!selectedRole) {
      return res.status(400).json({ status: 'error', message: 'Selected role does not exist.' });
    }

    const cleanUsername = String(username).trim();

    // Prevent duplicate usernames
    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('username', cleanUsername)
      .maybeSingle();

    if (existing) {
      return res.status(409).json({ status: 'error', message: 'That username is already taken.' });
    }

    let passwordHash = password;
    if (bcrypt) {
      try {
        passwordHash = await bcrypt.hash(password, 10);
      } catch (err) {
        console.error('[ADD EMPLOYEE] Bcrypt hash error:', err);
      }
    }

    let avatarUrl = null;
    if (req.file) {
      avatarUrl = await uploadAvatarToSupabase(req.file.buffer, req.file.originalname, req.file.mimetype);
    }

    // 1. Create the base user account
    const { data: newUser, error: userErr } = await supabase
      .from('users')
      .insert([{
        username: cleanUsername,
        email: email,
        password_hash: passwordHash,
        full_name: full_name,
        user_type: 'employee',
        is_active: true,
        // The admin-typed password is only an initial one: force the employee
        // to choose their own at first login (see /api/staff/change-password).
        must_change_password: true,
        avatar: avatarUrl
      }])
      .select()
      .single();

    if (userErr) throw userErr;

    // 2. Create the linked employee profile
    const employeeCode = 'EMP-' + String(newUser.id).padStart(3, '0');

    const { data: newEmployee, error: empErr } = await supabase
      .from('employees')
      .insert([{
        user_id: newUser.id,
        full_name: full_name, // employees.full_name is NOT NULL
        employee_code: employeeCode,
        job_title: selectedRole.name,
        department: 'General', // column kept in the DB, no longer shown or edited
        gender: gender || 'Not Specified'
      }])
      .select()
      .single();

    if (empErr) {
      // Don't leave a half-created account behind (it would block the
      // username from being reused on the next attempt).
      await supabase.from('users').delete().eq('id', newUser.id);
      throw empErr;
    }

    // 3. Link the account to its role via user_roles, so RBAC (dashboard
    // redirect, permissions) recognizes the role immediately on login.
    const { error: userRoleErr } = await supabase
      .from('user_roles')
      .insert([{ user_id: newUser.id, role_id: selectedRole.id }]);

    if (userRoleErr) {
      console.error('[ADD EMPLOYEE] Failed to link user_roles:', userRoleErr.message);
    }

    logActivity(supabase, {
      req,
      action: 'employee.created',
      category: 'employee',
      description: `Added new employee "${full_name}" as ${selectedRole.name}`,
      targetType: 'employee',
      targetId: newUser.id,
      targetLabel: full_name,
      metadata: { role: selectedRole.name, username: cleanUsername }
    });

    return res.json({
      status: 'success',
      message: 'Employee added successfully.',
      employee: { ...newEmployee, full_name: newUser.full_name, username: newUser.username, email: newUser.email }
    });
  } catch (error) {
    console.error('Add Employee Error:', error);
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

// ==========================================
// MANAGEMENT ADMIN DELETE EMPLOYEE
// ==========================================
app.post('/api/admin/delete-employee', async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ status: 'error', message: 'Database disconnected.' });

    const { user_id } = req.body;
    if (!user_id) {
      return res.status(400).json({ status: 'error', message: 'Missing user_id.' });
    }

    const { data: userRow, error: userLookupErr } = await supabase
      .from('users')
      .select('id, user_type, full_name')
      .eq('id', user_id)
      .maybeSingle();

    if (userLookupErr) throw userLookupErr;
    if (!userRow) {
      return res.status(404).json({ status: 'error', message: 'Employee not found.' });
    }
    // Guard rail: this endpoint only ever deletes employee accounts, never
    // an admin or CEO account, even if a bad id is passed in.
    if (userRow.user_type !== 'employee') {
      return res.status(403).json({ status: 'error', message: 'Only employee accounts can be deleted here.' });
    }

    // Remove dependent rows first (role link, employee profile), then the
    // base account, in case the DB doesn't cascade these deletes itself.
    const { error: userRoleErr } = await supabase.from('user_roles').delete().eq('user_id', user_id);
    if (userRoleErr) console.error('[DELETE EMPLOYEE] user_roles cleanup failed:', userRoleErr.message);

    const { error: empDeleteErr } = await supabase.from('employees').delete().eq('user_id', user_id);
    if (empDeleteErr) console.error('[DELETE EMPLOYEE] employees cleanup failed:', empDeleteErr.message);

    const { error: userDeleteErr } = await supabase.from('users').delete().eq('id', user_id);
    if (userDeleteErr) throw userDeleteErr;

    logActivity(supabase, {
      req,
      action: 'employee.deleted',
      category: 'employee',
      description: `Removed employee "${userRow.full_name || ('#' + user_id)}"`,
      targetType: 'employee',
      targetId: user_id,
      targetLabel: userRow.full_name || null
    });

    return res.json({ status: 'success', message: 'Employee deleted successfully.' });
  } catch (error) {
    console.error('Delete Employee Error:', error);
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

app.post('/api/admin/edit-employee', employeeAvatarUpload, async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ status: 'error', message: 'Database disconnected.' });

    const { emp_id, user_id, full_name, gender, username, email, role_id, is_active } = req.body;

    if (!user_id) {
      return res.status(400).json({ status: 'error', message: 'Missing user_id.' });
    }

    // 0. Validate everything up front so we never partially save a change
    // (e.g. update the role but then fail on a duplicate username).

    // The Job Title field is now a dropdown bound to the real `roles`
    // table, exactly like Add Employee - so changing it also changes the
    // employee's actual system role (RBAC / dashboard routing), not just
    // a cosmetic label.
    let selectedRole = null;
    if (role_id) {
      const { data: roleRow, error: roleErr } = await supabase
        .from('roles')
        .select('id, name')
        .eq('id', role_id)
        .maybeSingle();

      if (roleErr) throw roleErr;
      if (!roleRow) {
        return res.status(400).json({ status: 'error', message: 'Selected role does not exist.' });
      }
      selectedRole = roleRow;
    }

    if (username) {
      const { data: existingUsername, error: userLookupErr } = await supabase
        .from('users')
        .select('id')
        .eq('username', username)
        .neq('id', user_id)
        .maybeSingle();

      if (userLookupErr) throw userLookupErr;
      if (existingUsername) {
        return res.status(409).json({ status: 'error', message: 'That username is already taken.' });
      }
    }

    if (email) {
      const { data: existingEmail, error: emailLookupErr } = await supabase
        .from('users')
        .select('id')
        .eq('email', email)
        .neq('id', user_id)
        .maybeSingle();

      if (emailLookupErr) throw emailLookupErr;
      if (existingEmail) {
        return res.status(409).json({ status: 'error', message: 'That email is already in use by another account.' });
      }
    }

    // 1. Update the base user account
    const userUpdates = {};
    if (full_name) userUpdates.full_name = full_name;
    if (username) userUpdates.username = username;
    if (email) userUpdates.email = email;
    if (is_active !== undefined && is_active !== '') userUpdates.is_active = (String(is_active) === '1' || String(is_active) === 'true');
    if (req.file) userUpdates.avatar = await uploadAvatarToSupabase(req.file.buffer, req.file.originalname, req.file.mimetype);

    if (Object.keys(userUpdates).length > 0) {
      const { error: userErr } = await supabase
        .from('users')
        .update(userUpdates)
        .eq('id', user_id);

      if (userErr) throw userErr;
    }

    // 2. Update (or create, if missing) the linked employee profile.
    // job_title always mirrors the selected role's name, the same way
    // Add Employee derives it, so Job Title and the assigned role can
    // never drift out of sync.
    const empUpdates = {};
    if (selectedRole) empUpdates.job_title = selectedRole.name;
    if (gender !== undefined) empUpdates.gender = gender;
    if (full_name) empUpdates.full_name = full_name;

    if (Object.keys(empUpdates).length > 0) {
      // Look up the employee row by id *and* user_id together first. This
      // guards against a stale/mismatched emp_id ever being able to edit
      // a different employee's row, and also covers the case where the
      // id passed in doesn't correspond to an existing employees row.
      let empRow = null;
      if (emp_id) {
        const { data } = await supabase
          .from('employees')
          .select('id')
          .eq('id', emp_id)
          .eq('user_id', user_id)
          .maybeSingle();
        empRow = data;
      }
      if (!empRow) {
        const { data } = await supabase
          .from('employees')
          .select('id')
          .eq('user_id', user_id)
          .maybeSingle();
        empRow = data;
      }

      if (empRow) {
        const { error: empErr } = await supabase
          .from('employees')
          .update(empUpdates)
          .eq('id', empRow.id);

        if (empErr) throw empErr;
      } else {
        const employeeCode = 'EMP-' + String(user_id).padStart(3, '0');
        // employees.full_name is NOT NULL, so fall back to the users row.
        let insertName = full_name;
        if (!insertName) {
          const { data: nameRow } = await supabase.from('users').select('full_name').eq('id', user_id).maybeSingle();
          insertName = (nameRow && nameRow.full_name) || 'Employee';
        }
        const { error: empErr } = await supabase
          .from('employees')
          .insert([{ user_id: user_id, employee_code: employeeCode, ...empUpdates, full_name: insertName }]);

        if (empErr) throw empErr;
      }
    }

    // 3. Keep user_roles in sync so a Job Title change immediately takes
    // effect for login routing and permissions, not just the label shown
    // in the admin table.
    if (selectedRole) {
      // An employee has exactly one role. Update every existing user_roles
      // row for this user (this also self-heals accounts that ended up with
      // duplicate rows, which used to make this whole save fail), and only
      // insert when there is none yet.
      const { data: updatedRoleRows, error: roleUpdateErr } = await supabase
        .from('user_roles')
        .update({ role_id: selectedRole.id })
        .eq('user_id', user_id)
        .select('user_id');

      if (roleUpdateErr) throw roleUpdateErr;

      if (!updatedRoleRows || updatedRoleRows.length === 0) {
        const { error: roleInsertErr } = await supabase
          .from('user_roles')
          .insert([{ user_id: user_id, role_id: selectedRole.id }]);

        if (roleInsertErr) throw roleInsertErr;
      }
    }

    const changedFields = [...Object.keys(userUpdates), ...Object.keys(empUpdates)];
    if (selectedRole) changedFields.push('role');

    logActivity(supabase, {
      req,
      action: 'employee.updated',
      category: 'employee',
      description: `Updated employee record${full_name ? ` for "${full_name}"` : ''}${changedFields.length ? ` (${changedFields.join(', ')})` : ''}`,
      targetType: 'employee',
      targetId: user_id,
      targetLabel: full_name || null,
      metadata: { fields: changedFields, role: selectedRole ? selectedRole.name : undefined }
    });

    return res.json({ status: 'success', message: 'Employee updated successfully.' });
  } catch (error) {
    console.error('Edit Employee Error:', error);
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

// ==========================================
// MANAGEMENT CEO DASHBOARD API (Supabase)
// ==========================================
app.get('/api/ceo/dashboard', async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ status: 'error', message: 'Database disconnected.' });

    const user = await getCeoProfile(req);

    // 1. Realized revenue, per-flavor chart series, margin, benchmarks
    const orders = await ceoLoadSaleOrders();
    const agg = ceoAggregateSales(orders);
    const margin = await ceoComputeMargin(agg.totalSales);
    const benchmarks = await ceoComputeBenchmarks(orders);

    const { count: totalCustomers } = await supabase
      .from('customers')
      .select('*', { count: 'exact', head: true });

    // 2. Major requisitions (> PHP 500) actually waiting on the CEO
    const pendingExpenses = await ceoFetchAll(() => supabase
      .from('expenses')
      .select('*')
      .eq('status', 'PENDING_CEO')
      .order('id', { ascending: false }));
    const pendingMajor = pendingExpenses.filter(e => (parseFloat(e.amount) || 0) > CEO_MAJOR_THRESHOLD);
    const requesterMap = await ceoRequesterMap(pendingMajor.map(e => e.requested_by));

    const pendingApprovals = pendingMajor.map(e => {
      const r = requesterMap[e.requested_by] || { name: '', role: '' };
      return {
        id: e.id,
        pr_code: `PR-${1000 + e.id}`,
        item_name: e.item_name || '',
        department: r.role || '',
        requester_name: r.name,
        supplier: e.store_name || '',
        amount: parseFloat(e.amount) || 0,
        created_at: e.created_at || null
      };
    });

    // 3. Active workforce: real active employee accounts (there is no shift/clock-in tracking)
    const { data: staffRows, error: staffErr } = await supabase
      .from('users')
      .select('id, full_name, avatar, is_active, user_roles(roles(name))')
      .eq('user_type', 'employee')
      .order('id', { ascending: true });
    if (staffErr) throw staffErr;

    const roster = (staffRows || [])
      .filter(u => u.is_active !== false)
      .map(u => {
        const ur = Array.isArray(u.user_roles) ? u.user_roles[0] : u.user_roles;
        const roleObj = ur && ur.roles;
        const role = Array.isArray(roleObj) ? (roleObj[0] && roleObj[0].name) : (roleObj && roleObj.name);
        let avatar = null;
        if (u.avatar && !u.avatar.includes('account.png')) {
          const clean = u.avatar.replace(/^\/PHP/, '');
          avatar = /^(https?:|data:|\/)/i.test(clean) ? clean : '/' + clean;
        }
        return { id: u.id, name: u.full_name || '', role: role || 'Employee', avatar };
      });

    return res.json({
      status: 'success',
      user,
      stats: {
        totalSales: agg.totalSales,
        totalCustomers: totalCustomers || 0,
        netMarginPct: margin,
        pendingApprovals: pendingApprovals.length,
        activeStaff: roster.length
      },
      benchmarks,
      pendingApprovals,
      roster,
      chart: {
        months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
        years: agg.years.map(String),
        monthlyCoffee: agg.monthlyRev.coffee,
        monthlyStrawberry: agg.monthlyRev.strawberry,
        monthlyPandan: agg.monthlyRev.pandan,
        monthlyOther: agg.monthlyRev.other,
        yearlyCoffee: agg.yearlyRev.coffee,
        yearlyStrawberry: agg.yearlyRev.strawberry,
        yearlyPandan: agg.yearlyRev.pandan,
        yearlyOther: agg.yearlyRev.other
      }
    });
  } catch (error) {
    console.error('CEO dashboard fetch error:', error);
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

app.use((req, res) => {
  res.status(404).json({ status: 'error', message: 'Endpoint not found.' });
});

// Only bind a real port when run directly (local/Docker). On Vercel this file
// is required by api/index.js as a module, not executed directly, so
// require.main !== module there and app.listen() is skipped — Vercel's Node
// runtime calls the exported app as a request handler instead.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`Access in browser at http://localhost:${PORT}/`);
  });
}

module.exports = app;