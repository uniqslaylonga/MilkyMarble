// src/routes/notificationRoutes.js
// Customer notifications (bell + Sweet Updates page), read from the `notifications`
// table. Rows are written by database triggers (supabase/notifications.sql).
const express = require('express');
const router = express.Router();
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { REDEEMABLE_STATUSES, isWithinWindow } = require('../utils/promoRules');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;

// Login cookies win; the query/header id is only a fallback when there is no
// session cookie (same rule as GET /api/orders).
async function resolveCustomerId(req) {
  if (!supabase) return null;
  const cookieUserId = parseInt(req.cookies?.user_id, 10);
  if (Number.isFinite(cookieUserId)) {
    const { data } = await supabase.from('customers').select('id').eq('user_id', cookieUserId).maybeSingle();
    if (data) return data.id;
  }
  const cookieCustomerId = parseInt(req.cookies?.customer_id, 10);
  if (Number.isFinite(cookieCustomerId)) {
    const { data } = await supabase.from('customers').select('id').eq('id', cookieCustomerId).maybeSingle();
    if (data) return data.id;
  }
  const fallback = parseInt(req.query?.customer_id || req.body?.customer_id || req.headers['x-customer-id'], 10);
  return Number.isFinite(fallback) ? fallback : null;
}

// GET /api/notifications?limit=N
router.get('/', async (req, res) => {
  if (!supabase) return res.json({ status: 'success', notifications: [] });
  try {
    const customerId = await resolveCustomerId(req);
    if (!customerId) return res.json({ status: 'success', notifications: [] });

    const parsed = parseInt(req.query.limit, 10);
    const limit = (Number.isFinite(parsed) && parsed > 0) ? Math.min(parsed, 100) : 50;

    const { data: rows, error } = await supabase
      .from('notifications')
      .select('id, type, status, title, message, order_id, promo_id, data, created_at')
      .or(`customer_id.eq.${customerId},customer_id.is.null`)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;

    // A promo notification only shows while the promo can still be redeemed.
    const promoIds = [...new Set((rows || []).filter(r => r.promo_id).map(r => r.promo_id))];
    const livePromos = new Map();
    if (promoIds.length) {
      const { data: promos } = await supabase.from('promotions').select('*').in('id', promoIds);
      const now = new Date();
      (promos || []).forEach(p => {
        const ok = REDEEMABLE_STATUSES.includes(String(p.status || '').toUpperCase())
          && isWithinWindow(p, now) && (!p.usage_cap || (p.usage_count || 0) < p.usage_cap);
        if (ok) livePromos.set(p.id, p);
      });
    }

    const ids = (rows || []).map(r => r.id);
    const readSet = new Set();
    if (ids.length) {
      const { data: reads } = await supabase
        .from('notification_reads').select('notification_id')
        .eq('customer_id', customerId).in('notification_id', ids);
      (reads || []).forEach(r => readSet.add(r.notification_id));
    }

    const notifications = (rows || [])
      .filter(r => !r.promo_id || livePromos.has(r.promo_id))
      .map(r => ({
        ...r,
        promo: r.promo_id ? { id: r.promo_id, code: livePromos.get(r.promo_id).code } : null,
        is_read: readSet.has(r.id)
      }));

    return res.json({ status: 'success', notifications });
  } catch (err) {
    console.error('[notifications] load error:', err.message);
    return res.status(500).json({ status: 'error', message: 'Could not load notifications.', notifications: [] });
  }
});

// POST /api/notifications/read   { ids: [1,2,3] }  or  { all: true }
router.post('/read', async (req, res) => {
  if (!supabase) return res.json({ status: 'success' });
  try {
    const customerId = await resolveCustomerId(req);
    if (!customerId) return res.json({ status: 'success' });

    let ids = Array.isArray(req.body?.ids) ? req.body.ids.map(n => parseInt(n, 10)).filter(Number.isFinite) : [];
    if (req.body?.all) {
      const { data } = await supabase
        .from('notifications').select('id')
        .or(`customer_id.eq.${customerId},customer_id.is.null`)
        .order('created_at', { ascending: false }).limit(200);
      ids = (data || []).map(r => r.id);
    }
    if (!ids.length) return res.json({ status: 'success' });

    const { error } = await supabase
      .from('notification_reads')
      .upsert(ids.map(id => ({ customer_id: customerId, notification_id: id })), { onConflict: 'customer_id,notification_id', ignoreDuplicates: true });
    if (error) throw error;
    return res.json({ status: 'success' });
  } catch (err) {
    console.error('[notifications] read error:', err.message);
    return res.status(500).json({ status: 'error', message: 'Could not save read state.' });
  }
});

module.exports = router;
