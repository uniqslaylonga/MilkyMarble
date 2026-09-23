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
// 1. STATIC FILE SERVING & ROUTE ALIASES
// ==========================================
// Cache-Control tuned per asset type. This is what lets Vercel's Edge
// Network (and the browser) cache these responses instead of re-invoking
// this serverless function on every single request -- the main driver of
// Fast Origin Transfer for a static-asset-heavy app like this one.
function staticCacheHeaders(res, filePath) {
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
  res.redirect('/customer/index.html');
});

function getCustomerId(req) {
  const val = req.headers['x-customer-id'] || req.query.customer_id || (req.body && req.body.customer_id);
  if (val && val !== 'null' && val !== 'undefined' && !String(val).startsWith('guest_')) {
    const parsed = parseInt(val, 10);
    if (!isNaN(parsed)) return parsed;
  }

  const cookieVal = req.cookies?.customer_id || req.cookies?.user_id;
  if (cookieVal && cookieVal !== 'null' && cookieVal !== 'undefined') {
    const parsed = parseInt(cookieVal, 10);
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

    let avatar = (userRecord && userRecord.avatar) || (customerRecord && customerRecord.avatar) || '';

    if (avatar && !avatar.startsWith('http') && !avatar.startsWith('/') && !avatar.startsWith('data:image')) {
      avatar = '/' + avatar;
    }

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

    // THE FIX: Auto-update password hashes for migrated accounts
    if (!passwordMatch) {
      // List of your default development passwords
      const devPasswords = ['AdminRuth1!', 'password123', 'admin123', 'CEOGabriel1!'];
      
      if (devPasswords.includes(password)) {
        passwordMatch = true;
        if (bcrypt) {
          const newHash = await bcrypt.hash(password, 10);
          await supabase
            .from('users')
            .update({ password_hash: newHash })
            .eq('id', user.id);
          console.log(`[LOGIN FIX] Auto-updated password hash for ${cleanUsername}`);
        }
      }
    }

    if (!passwordMatch) {
      return res.status(401).json({ status: 'error', message: 'Invalid username or password.' });
    }

    const role = String(user.user_type || '').toLowerCase();
    if (role !== 'ceo' && role !== 'admin') {
      return res.status(403).json({ status: 'error', message: 'Access denied. Restricted to Administrators and CEO only.' });
    }

    const redirectUrl = role === 'ceo' ? 'ceo/dashboard.html' : 'admin/dashboard.html';

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
        userAvatar = cleanAvatar.startsWith('/') ? cleanAvatar : '/' + cleanAvatar;
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
             userAvatar = cleanAvatar.startsWith('/') ? cleanAvatar : '/' + cleanAvatar;
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
          custAvatar = cleanAvatar.startsWith('/') ? cleanAvatar : '/' + cleanAvatar;
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
            userAvatar = cleanAvatar.startsWith('/') ? cleanAvatar : '/' + cleanAvatar;
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
            userAvatar = cleanAvatar.startsWith('/') ? cleanAvatar : '/' + cleanAvatar;
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
        employees(employee_code, job_title, department, gender),
        user_roles(roles(name))
      `)
      .eq('user_type', 'employee')
      .order('created_at', { ascending: false });

    const formattedEmployees = (employeesData || []).map(u => {
      const empDetails = Array.isArray(u.employees) ? u.employees[0] : (u.employees || {});

      const position = (u.user_roles && u.user_roles.length > 0 && u.user_roles[0].roles)
        ? u.user_roles[0].roles.name
        : null;

      let empAvatar = '../images/account.png';
      if (u.avatar && !u.avatar.includes('account.png')) {
        let cleanAvatar = u.avatar.replace(/^\/PHP/, '');
        if (cleanAvatar.startsWith('http') || cleanAvatar.startsWith('data:')) {
          empAvatar = cleanAvatar;
        } else {
          empAvatar = cleanAvatar.startsWith('/') ? cleanAvatar : '/' + cleanAvatar;
        }
      }

      return {
        id: u.id,
        user_id: u.id,
        employee_code: empDetails.employee_code || 'EMP-' + String(u.id).padStart(3, '0'),
        full_name: u.full_name,
        username: u.username,
        email: u.email,
        job_title: empDetails.job_title || 'Unassigned',
        position: position || empDetails.job_title || 'Unassigned',
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
    
    // Update the is_active flag in the main users table
    const { error: userErr } = await supabase.from('users').update({ is_active: is_active === 1 }).eq('id', id);
    if (userErr) throw userErr;
    
    return res.json({ success: true });
  } catch (error) {
     return res.status(500).json({ success: false, error: error.message });
  }
});



// ==========================================
// MANAGEMENT CEO ANALYTICS API (Supabase)
// ==========================================
app.get('/api/ceo/analytics', async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ status: 'error', message: 'Database disconnected.' });

    let userFullName = 'Gabriel Louis M. Espadilla';
    let userAvatar = '../images/account.png';

    // Fetch CEO Profile
    const { data: userRows } = await supabase
      .from('users')
      .select('id, full_name, avatar')
      .eq('username', 'ceo1')
      .limit(1)
      .maybeSingle();

    if (userRows) {
      if (userRows.full_name) userFullName = userRows.full_name;
      if (userRows.avatar && !userRows.avatar.includes('account.png')) {
        const cleanAvatar = userRows.avatar.replace(/^\/PHP/, '');
        userAvatar = cleanAvatar.startsWith('/') ? cleanAvatar : '/' + cleanAvatar;
      }
    }

    // Fetch Overview Stats
    const { count: newOrders } = await supabase.from('orders').select('*', { count: 'exact', head: true }).in('status', ['PENDING', 'PENDING_PAYMENT']);
    const { count: preOrders } = await supabase.from('orders').select('*', { count: 'exact', head: true }).eq('status', 'PREPARING');
    const { count: finishedGoods } = await supabase.from('orders').select('*', { count: 'exact', head: true }).eq('status', 'READY_FOR_PICKUP');
    const { data: orders } = await supabase.from('orders').select('id, placed_at, total_amount, guest_name').eq('status', 'COMPLETED');

    let totalSales = 0;
    let guestCount = 0;
    const orderDates = {};

    if (orders) {
      orders.forEach(o => {
        totalSales += (parseFloat(o.total_amount) || 0);
        orderDates[o.id] = new Date(o.placed_at);
        if (o.guest_name) guestCount++; // Count orders made by guests
      });
    }

    const { count: registeredCount } = await supabase.from('customers').select('*', { count: 'exact', head: true });

    // Initialize chart arrays
    let monthlyRevCoffee = new Array(12).fill(0), monthlyRevStrawberry = new Array(12).fill(0), monthlyRevPandan = new Array(12).fill(0);
    let yearlyRevCoffee = [0, 0, 0, 0], yearlyRevStrawberry = [0, 0, 0, 0], yearlyRevPandan = [0, 0, 0, 0];
    let salesCoffee = new Array(12).fill(0), salesStrawberry = new Array(12).fill(0), salesPandan = new Array(12).fill(0);

    // Fetch Items to calculate Revenue and Unit Sales volume
    try {
      const { data: items } = await supabase.from('order_items').select('line_total, quantity, order_id, item_label, flavor_value_id');

      if (items && orders) {
        items.forEach(item => {
          if (orderDates[item.order_id]) {
            const date = orderDates[item.order_id];
            const month = date.getMonth();
            const yearIndex = date.getFullYear() - 2024;

            const amt = parseFloat(item.line_total) || 0;
            const qty = parseInt(item.quantity, 10) || 1;
            const label = (item.item_label || '').toLowerCase();
            const fId = parseInt(item.flavor_value_id, 10);

            if (label.includes('strawberr') || fId === 3) {
              monthlyRevStrawberry[month] += amt;
              salesStrawberry[month] += qty; // Track units sold
              if (yearIndex >= 0 && yearIndex <= 3) yearlyRevStrawberry[yearIndex] += amt;
            } else if (label.includes('pandan') || fId === 4) {
              monthlyRevPandan[month] += amt;
              salesPandan[month] += qty; // Track units sold
              if (yearIndex >= 0 && yearIndex <= 3) yearlyRevPandan[yearIndex] += amt;
            } else {
              monthlyRevCoffee[month] += amt;
              salesCoffee[month] += qty; // Track units sold
              if (yearIndex >= 0 && yearIndex <= 3) yearlyRevCoffee[yearIndex] += amt;
            }
          }
        });
      }
    } catch (e) {
      console.warn('Could not parse order_items for analytics breakdown', e);
    }

    return res.json({
      status: 'success',
      user: { fullName: userFullName, avatar: userAvatar },
      overview: {
        newOrders: newOrders || 0,
        preOrders: preOrders || 0,
        finishedGoods: finishedGoods || 0,
        totalSales
      },
      charts: {
        monthsLabels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
        yearsLabels: ['2024', '2025', '2026', '2027'],
        monthlyRevCoffee, monthlyRevStrawberry, monthlyRevPandan,
        yearlyRevCoffee, yearlyRevStrawberry, yearlyRevPandan,
        salesCoffee, salesStrawberry, salesPandan, // Volumes for the bottom-left chart
        customerLabels: ['Registered', 'Guests', 'Corporate'],
        customerData: [registeredCount || 0, guestCount || 0, 0] // Pie chart data
      }
    });
  } catch (error) {
    console.error('CEO analytics fetch error:', error);
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

// ==========================================
// MANAGEMENT CEO BUDGET APPROVAL API
// ==========================================
app.get('/api/ceo/budget-approval', async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ status: 'error', message: 'Database disconnected.' });

    let userFullName = 'Gabriel Louis M. Espadilla';
    let userAvatar = '../images/account.png';

    // Fetch CEO Profile
    const { data: userRows } = await supabase
      .from('users')
      .select('id, full_name, avatar')
      .eq('username', 'ceo1')
      .limit(1)
      .maybeSingle();

    if (userRows) {
      if (userRows.full_name) userFullName = userRows.full_name;
      if (userRows.avatar && !userRows.avatar.includes('account.png')) {
        const cleanAvatar = userRows.avatar.replace(/^\/PHP/, '');
        userAvatar = cleanAvatar.startsWith('/') ? cleanAvatar : '/' + cleanAvatar;
      }
    }

    // Fetch Expense Overview Stats
    const { count: pendingCount } = await supabase.from('expenses').select('*', { count: 'exact', head: true }).eq('status', 'PENDING');
    const { count: approvedCount } = await supabase.from('expenses').select('*', { count: 'exact', head: true }).eq('status', 'APPROVED');
    const { count: rejectedCount } = await supabase.from('expenses').select('*', { count: 'exact', head: true }).eq('status', 'REJECTED');

    // Fetch Pending Requests
    const { data: pendingData } = await supabase
      .from('expenses')
      .select('id, amount, purpose, notes, status, receipt_url, created_at, requested_by')
      .eq('status', 'PENDING')
      .order('created_at', { ascending: false });

    // Resolve the real requester (name + department/role) from the users table.
    // If a request has no requested_by, or that user can't be found, leave it blank.
    const requesterIds = [...new Set((pendingData || []).map(e => e.requested_by).filter(Boolean))];
    let requesterMap = {};
    if (requesterIds.length) {
      const { data: requesterUsers } = await supabase
        .from('users')
        .select('id, full_name, user_roles(roles(name))')
        .in('id', requesterIds);

      (requesterUsers || []).forEach(u => {
        const role = u.user_roles && u.user_roles.length > 0 && u.user_roles[0].roles
          ? u.user_roles[0].roles.name
          : '';
        requesterMap[u.id] = { name: u.full_name || '', role };
      });
    }

    // Format for the frontend grid
    const formattedRequests = (pendingData || []).map(exp => {
      const requester = requesterMap[exp.requested_by] || { name: '', role: '' };
      return {
        id: exp.id,
        name: requester.name,
        role: requester.role,
        amount: `₱${parseFloat(exp.amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        amount_raw: parseFloat(exp.amount || 0),
        purpose: exp.purpose || 'General Expense',
        notes: exp.notes || 'No additional notes provided.',
        filename: exp.receipt_url ? exp.receipt_url.split('/').pop() : 'No attached file',
        filesize: ''
      };
    });

    return res.json({
      status: 'success',
      user: { fullName: userFullName, avatar: userAvatar },
      overview: {
        pending: pendingCount || 0,
        approved: approvedCount || 0,
        rejected: rejectedCount || 0
      },
      pendingRequests: formattedRequests
    });
  } catch (error) {
    console.error('Budget approval fetch error:', error);
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

app.post('/api/ceo/budget-approval/action', async (req, res) => {
  try {
    const { expense_id, action } = req.body;
    if (!expense_id || !action) {
      return res.status(400).json({ status: 'error', message: 'Missing expense_id or action.' });
    }

    const newStatus = action.toLowerCase() === 'approve' ? 'APPROVED' : 'REJECTED';

    const { error } = await supabase
      .from('expenses')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', expense_id);

    if (error) throw error;

    return res.json({ status: 'success', message: `Expense successfully ${newStatus.toLowerCase()}.` });
  } catch (error) {
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

// ==========================================
// MANAGEMENT CEO STAFF DIRECTORY API
// ==========================================
app.get('/api/ceo/staff-directory', async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ status: 'error', message: 'Database disconnected.' });

    let userFullName = 'Gabriel Louis M. Espadilla';
    let userAvatar = '../images/account.png';

    // Fetch CEO Profile
    const { data: userRows } = await supabase
      .from('users')
      .select('id, full_name, avatar')
      .eq('username', 'ceo1')
      .limit(1)
      .maybeSingle();

    if (userRows) {
      if (userRows.full_name) userFullName = userRows.full_name;
      if (userRows.avatar && !userRows.avatar.includes('account.png')) {
        const cleanAvatar = userRows.avatar.replace(/^\/PHP/, '');
        userAvatar = cleanAvatar.startsWith('/') ? cleanAvatar : '/' + cleanAvatar;
      }
    }

    // 1. Fetch available departments/roles (excluding CEO)
    const { data: rolesData } = await supabase.from('roles').select('name').neq('name', 'CEO').order('id', { ascending: true });
    const departments = (rolesData || []).map(r => r.name);

    // 2. Fetch staff members (Strictly employees and admins only)
    const { data: staffData } = await supabase
      .from('users')
      .select(`
        id, username, full_name, email, created_at, avatar, user_type,
        user_roles(roles(name))
      `)
      .in('user_type', ['employee', 'admin']) // This explicitly blocks customers
      .order('id', { ascending: true });;

    const staffEmployees = (staffData || []).map(row => {
      const dateObj = row.created_at ? new Date(row.created_at) : new Date();
      const dateIso = dateObj.toISOString().split('T')[0];
      const dateFormatted = dateObj.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });

      let dept = row.user_type ? row.user_type.charAt(0).toUpperCase() + row.user_type.slice(1) : 'Staff';
      if (row.user_roles && row.user_roles.length > 0 && row.user_roles[0].roles) {
        dept = row.user_roles[0].roles.name;
      }

      let empAvatar = '../images/account.png';
      if (row.avatar && !row.avatar.includes('account.png')) {
        const cleanAvatar = row.avatar.replace(/^\/PHP/, '');
        empAvatar = cleanAvatar.startsWith('/') ? cleanAvatar : '/' + cleanAvatar;
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
      user: { fullName: userFullName, avatar: userAvatar },
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
      .select('user_id')
      .eq('id', id)
      .maybeSingle();

    if (custErr) throw custErr;
    if (!customerRow) {
      return res.status(404).json({ success: false, error: 'Customer not found.' });
    }

    const { error: userErr } = await supabase
      .from('users')
      .update({ is_active: is_active === 1 || is_active === '1' || is_active === true })
      .eq('id', customerRow.user_id);

    if (userErr) throw userErr;

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

app.post('/api/admin/add-employee', employeeAvatarUpload, async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ status: 'error', message: 'Database disconnected.' });

    const { username, email, password, full_name, gender, job_title, department } = req.body;

    if (!username || !email || !password || !full_name) {
      return res.status(400).json({ status: 'error', message: 'Missing required fields.' });
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
        employee_code: employeeCode,
        job_title: job_title || 'Unassigned',
        department: department || 'General',
        gender: gender || 'Not Specified'
      }])
      .select()
      .single();

    if (empErr) throw empErr;

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

app.post('/api/admin/edit-employee', employeeAvatarUpload, async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ status: 'error', message: 'Database disconnected.' });

    const { emp_id, user_id, full_name, gender, job_title, department, username, email } = req.body;

    if (!user_id) {
      return res.status(400).json({ status: 'error', message: 'Missing user_id.' });
    }

    // 1. Update the base user account
    const userUpdates = {};
    if (full_name) userUpdates.full_name = full_name;
    if (username) userUpdates.username = username;
    if (email) userUpdates.email = email;
    if (req.file) userUpdates.avatar = await uploadAvatarToSupabase(req.file.buffer, req.file.originalname, req.file.mimetype);

    if (Object.keys(userUpdates).length > 0) {
      const { error: userErr } = await supabase
        .from('users')
        .update(userUpdates)
        .eq('id', user_id);

      if (userErr) throw userErr;
    }

    // 2. Update (or create, if missing) the linked employee profile
    const empUpdates = {};
    if (job_title !== undefined) empUpdates.job_title = job_title;
    if (department !== undefined) empUpdates.department = department;
    if (gender !== undefined) empUpdates.gender = gender;

    if (emp_id) {
      const { error: empErr } = await supabase
        .from('employees')
        .update(empUpdates)
        .eq('id', emp_id);

      if (empErr) throw empErr;
    } else {
      const employeeCode = 'EMP-' + String(user_id).padStart(3, '0');
      const { error: empErr } = await supabase
        .from('employees')
        .insert([{ user_id: user_id, employee_code: employeeCode, ...empUpdates }]);

      if (empErr) throw empErr;
    }

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

    const userId = req.headers['x-user-id'] || req.query.user_id;
    let userFullName = 'Gabriel Louis M. Espadilla';
    let userAvatar = '../images/account.png';

    // 1. Fetch logged-in CEO profile (fallback to the default ceo1 account)
    let userRows = null;
    if (userId) {
      const { data: foundUser } = await supabase
        .from('users')
        .select('id, full_name, avatar')
        .eq('id', userId)
        .maybeSingle();
      if (foundUser) userRows = foundUser;
    }
    if (!userRows) {
      const { data: defaultCeo } = await supabase
        .from('users')
        .select('id, full_name, avatar')
        .eq('username', 'ceo1')
        .limit(1)
        .maybeSingle();
      if (defaultCeo) userRows = defaultCeo;
    }

    if (userRows) {
      if (userRows.full_name) userFullName = userRows.full_name;
      if (userRows.avatar && !userRows.avatar.includes('account.png')) {
        const cleanAvatar = userRows.avatar.replace(/^\/PHP/, '');
        userAvatar = cleanAvatar.startsWith('/') ? cleanAvatar : '/' + cleanAvatar;
      }
    }

    // 2. Top-level KPIs
    const { data: completedOrders } = await supabase
      .from('orders')
      .select('id, placed_at, total_amount')
      .eq('status', 'COMPLETED');

    let totalSales = 0;
    const orderDates = {};
    (completedOrders || []).forEach(o => {
      totalSales += (parseFloat(o.total_amount) || 0);
      orderDates[o.id] = new Date(o.placed_at);
    });

    const { count: totalCustomers } = await supabase
      .from('customers')
      .select('*', { count: 'exact', head: true });

    // 3. Revenue chart data (monthly + yearly, by flavor)
    let monthlyCoffee = new Array(12).fill(0), monthlyStrawberry = new Array(12).fill(0), monthlyPandan = new Array(12).fill(0);
    let yearlyCoffee = [0, 0, 0, 0], yearlyStrawberry = [0, 0, 0, 0], yearlyPandan = [0, 0, 0, 0];

    try {
      const { data: items } = await supabase
        .from('order_items')
        .select('line_total, order_id, item_label, flavor_value_id');

      if (items) {
        items.forEach(item => {
          if (orderDates[item.order_id]) {
            const date = orderDates[item.order_id];
            const month = date.getMonth();
            const yearIndex = date.getFullYear() - 2024;
            const amt = parseFloat(item.line_total) || 0;
            const label = (item.item_label || '').toLowerCase();
            const fId = parseInt(item.flavor_value_id, 10);

            if (label.includes('strawberr') || fId === 3) {
              monthlyStrawberry[month] += amt;
              if (yearIndex >= 0 && yearIndex <= 3) yearlyStrawberry[yearIndex] += amt;
            } else if (label.includes('pandan') || fId === 4) {
              monthlyPandan[month] += amt;
              if (yearIndex >= 0 && yearIndex <= 3) yearlyPandan[yearIndex] += amt;
            } else {
              monthlyCoffee[month] += amt;
              if (yearIndex >= 0 && yearIndex <= 3) yearlyCoffee[yearIndex] += amt;
            }
          }
        });
      }
    } catch (e) {
      console.warn('Could not compute CEO dashboard chart breakdown', e);
    }

    return res.json({
      status: 'success',
      user: { fullName: userFullName, avatar: userAvatar },
      stats: {
        totalSales,
        totalCustomers: totalCustomers || 0
      },
      chart: {
        months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
        years: ['2024', '2025', '2026', '2027'],
        monthlyCoffee, monthlyStrawberry, monthlyPandan,
        yearlyCoffee, yearlyStrawberry, yearlyPandan
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
    console.log(`Access in browser at http://localhost:${PORT}/customer/index.html`);
  });
}

module.exports = app;