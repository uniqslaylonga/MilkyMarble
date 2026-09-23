const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');

// Recipe BOM at gram portions kada baso
const CUP_RECIPE_SPECS = {
  '8oz': {
    baseGulamanGrams: 100,
    condensedMilkOz: 0.7,
    extraCondensedMilkOz: 0.5,
    powderedMilkGrams: 2,
    cupItemName: '8oz Cup',
    toppingsGrams: {
      'pearls': 30,
      'tapioca': 30,
      'tapioca pearls': 30,
      'cheese': 5,
      'chocolate chip': 5,
      'marshmallow': 2,
      'nuts': 5,
      'sprinkles (chocolate)': 2,
      'sprinkles (assorted)': 2,
      'sprinkles': 2
    }
  },
  '12oz': {
    baseGulamanGrams: 200,
    condensedMilkOz: 1.5,
    extraCondensedMilkOz: 1.0,
    powderedMilkGrams: 3,
    cupItemName: '12oz Cup',
    toppingsGrams: {
      'pearls': 50,
      'tapioca': 50,
      'tapioca pearls': 50,
      'cheese': 7,
      'chocolate chip': 7,
      'marshmallow': 2,
      'nuts': 7,
      'sprinkles (chocolate)': 2,
      'sprinkles (assorted)': 2,
      'sprinkles': 2
    }
  }
};

// Batch yield ratios: 6 packs = 6,500g, 0.25 bag = 1,700g
const BATCH_YIELD_CONVERSIONS = {
  gulaman: {
    rawItemName: 'Gulaman Powder',
    cookedItemName: 'Cooked Gulaman Base',
    gramsPerPack: 6500 / 6
  },
  tapioca: {
    rawItemName: 'Raw Tapioca Pearls',
    cookedItemName: 'Cooked Tapioca Pearls',
    gramsPerBag: 1700 / 0.25
  }
};

// Awtomatikong nagbabawas sa kusina habang binubuo ang baso
async function deductInventoryForOrder(orderId, employeeName = 'Production Kitchen') {
  if (!supabase || !orderId) return;

  try {
    const { data: order, error: orderErr } = await supabase
      .from('orders')
      .select('id, order_items(item_label, quantity, size, toppings, is_custom)')
      .eq('id', orderId)
      .maybeSingle();

    if (orderErr || !order || !order.order_items) return;

    for (const item of order.order_items) {
      const qty = parseInt(item.quantity, 10) || 1;
      const rawLabel = String(item.item_label || '').toLowerCase();
      
      const is8oz = (item.size && item.size.includes('8oz')) || rawLabel.includes('8oz');
      const sizeKey = is8oz ? '8oz' : '12oz';
      const spec = CUP_RECIPE_SPECS[sizeKey];

      const toppingsStr = String(item.toppings || '').toLowerCase();
      const hasExtraCondensed = toppingsStr.includes('condensed');
      const totalCondensedOz = (spec.condensedMilkOz + (hasExtraCondensed ? spec.extraCondensedMilkOz : 0)) * qty;

      const deductions = [
        { name: 'Cooked Gulaman Base', qty: spec.baseGulamanGrams * qty },
        { name: 'Condensed Milk', qty: totalCondensedOz },
        { name: 'Powdered Milk', qty: spec.powderedMilkGrams * qty },
        { name: spec.cupItemName, qty: 1 * qty },
        { name: 'Cup Lids', qty: 1 * qty },
        { name: 'Boba Straws', qty: 1 * qty }
      ];

      const isPreset = !item.is_custom;

      if (isPreset || toppingsStr.includes('pearl') || toppingsStr.includes('tapioca')) {
        deductions.push({ name: 'Cooked Tapioca Pearls', qty: spec.toppingsGrams['pearls'] * qty });
      }
      if (toppingsStr.includes('cheese')) {
        deductions.push({ name: 'Cheese', qty: spec.toppingsGrams['cheese'] * qty });
      }
      if (toppingsStr.includes('chocolate chip')) {
        deductions.push({ name: 'Chocolate Chip', qty: spec.toppingsGrams['chocolate chip'] * qty });
      }
      if (toppingsStr.includes('marshmallow')) {
        deductions.push({ name: 'Marshmallow', qty: spec.toppingsGrams['marshmallow'] * qty });
      }
      if (toppingsStr.includes('nuts')) {
        deductions.push({ name: 'Nuts', qty: spec.toppingsGrams['nuts'] * qty });
      }
      if (toppingsStr.includes('sprinkles (chocolate)')) {
        deductions.push({ name: 'Sprinkles (Chocolate)', qty: spec.toppingsGrams['sprinkles (chocolate)'] * qty });
      } else if (toppingsStr.includes('sprinkles (assorted)')) {
        deductions.push({ name: 'Sprinkles (Assorted)', qty: spec.toppingsGrams['sprinkles (assorted)'] * qty });
      } else if (toppingsStr.includes('sprinkles')) {
        deductions.push({ name: 'Sprinkles', qty: spec.toppingsGrams['sprinkles'] * qty });
      }

      for (const d of deductions) {
        const { data: invRow } = await supabase
          .from('inventory_items')
          .select('id, on_hand, name')
          .ilike('name', `%${d.name}%`)
          .limit(1)
          .maybeSingle();

        if (invRow) {
          const currentQty = parseFloat(invRow.on_hand) || 0;
          const newQty = Math.max(0, currentQty - d.qty);

          await supabase
            .from('inventory_items')
            .update({ on_hand: newQty })
            .eq('id', invRow.id);

          await supabase.from('inventory_movement_logs').insert([{
            item_id: invRow.id,
            item_name: invRow.name,
            change_type: 'DEDUCT',
            quantity_changed: d.qty,
            employee_name: employeeName
          }]);
        }
      }
    }
  } catch (err) {
    console.error('[deductInventoryForOrder warning]:', err.message);
  }
}

// Helper: profile at avatar ng naka-login na staff
async function getEmployeeProfile(req) {
  const userId = req.headers['x-user-id'] || req.query.user_id || req.body?.user_id;
  let fullName = 'Employee';
  const DEFAULT_AVATAR = '/employee/images/account.png';
  let avatarUrl = DEFAULT_AVATAR;

  if (userId && supabase) {
    const { data: user } = await supabase
      .from('users')
      .select('full_name, username, avatar')
      .eq('id', userId)
      .maybeSingle();

    if (user) {
      const cleanFull = (user.full_name || '').trim();
      fullName = cleanFull || (user.username || '').trim() || fullName;
      const rawAvatar = user.avatar;
      if (rawAvatar && rawAvatar !== 'account.png') {
        if (rawAvatar.startsWith('http') || rawAvatar.startsWith('data:image') || rawAvatar.startsWith('/')) {
          avatarUrl = rawAvatar;
        } else if (rawAvatar.startsWith('images/') || rawAvatar.startsWith('uploads/')) {
          avatarUrl = '/' + rawAvatar;
        } else {
          avatarUrl = '/images/' + rawAvatar;
        }
        if (avatarUrl === '/images/account.png') avatarUrl = DEFAULT_AVATAR;
      }
    }
  }

  return { fullName, firstName: fullName.trim().split(' ')[0] || 'Employee', avatarSrc: avatarUrl };
}

function noDb(res) {
  return res.status(500).json({ status: 'error', message: 'Database disconnected.' });
}

function cleanItemLabel(rawLabel, fallback) {
  let cleanTitle = String(rawLabel || '')
    .replace(/\s*\((8oz|12oz)\)/gi, '')
    .replace(/(\+.*|\[.*\])/g, '')
    .replace(/^(8oz|12oz)\s*/gi, '')
    .trim();
  if (cleanTitle.endsWith('(')) cleanTitle = cleanTitle.slice(0, -1).trim();
  return cleanTitle || fallback;
}

// Sales Officer Helpers
const ORDER_REVIEW_STATUSES = ['CONFIRMED', 'PAID_VERIFIED'];

function startOfDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

function monthsAgo(months) {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d;
}

const phDateFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit'
});

function phDate(v) {
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d) ? '' : phDateFmt.format(d);
}

function phDayStartISO(dateStr) {
  return new Date(`${dateStr}T00:00:00+08:00`).toISOString();
}

function phAddDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00+08:00`);
  d.setUTCDate(d.getUTCDate() + n);
  return phDate(d);
}

const NOT_SALES = '(CANCELLED,PENDING_PAYMENT)';
const isSaleStatus = st => st !== 'CANCELLED' && st !== 'PENDING_PAYMENT';

async function fetchAllRows(buildQuery, pageSize = 1000) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await buildQuery().range(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

function resolveRange(range, dateStr) {
  const today = phDate(new Date());
  if (range === 'today') return { start: phDayStartISO(today), end: null };
  if (range === 'week') return { start: phDayStartISO(phAddDays(today, -7)), end: null };
  if (range === 'month') return { start: phDayStartISO(today.slice(0, 8) + '01'), end: null };
  if (range === 'custom' && /^\d{4}-\d{2}-\d{2}$/.test(dateStr || '')) {
    return { start: phDayStartISO(dateStr), end: phDayStartISO(phAddDays(dateStr, 1)) };
  }
  return { start: null, end: null };
}

function resolveAvatar(raw) {
  const DEFAULT_AVATAR = '/employee/images/account.png';
  if (!raw || raw === 'account.png') return DEFAULT_AVATAR;
  if (raw.startsWith('http') || raw.startsWith('data:image') || raw.startsWith('/')) return raw;
  if (raw.startsWith('images/') || raw.startsWith('uploads/')) return '/' + raw;
  return '/images/' + raw;
}

// Sales Officer Dashboard
async function buildSalesDashboard(req, res) {
  try {
    if (!supabase) return noDb(res);

    const userProfile = await getEmployeeProfile(req);
    const now = new Date();
    const todayStr = phDate(now);
    const todayStart = phDayStartISO(todayStr);

    const { data: todayOrdersData, error: todayErr } = await supabase
      .from('orders')
      .select('total_amount')
      .gte('placed_at', todayStart)
      .not('status', 'in', NOT_SALES);
    if (todayErr) throw todayErr;

    const { count: pendingCount, error: pendingErr } = await supabase
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .in('status', ORDER_REVIEW_STATUSES);
    if (pendingErr) throw pendingErr;

    const todayOrders = (todayOrdersData || []).length;
    const todaySales = (todayOrdersData || [])
      .reduce((sum, o) => sum + (parseFloat(o.total_amount) || 0), 0);

    const { data: recentOrders, error: recentErr } = await supabase
      .from('orders')
      .select('id, order_number, status, total_amount, payment_method, placed_at, guest_name, customer_id, customers(users(full_name))')
      .order('placed_at', { ascending: false })
      .limit(200);
    if (recentErr) throw recentErr;

    const formattedRecent = (recentOrders || []).map(o => ({
      id: o.id,
      order_number: o.order_number,
      status: o.status,
      payment_method: o.payment_method || 'N/A',
      total_amount: parseFloat(o.total_amount || 0),
      placed_at: o.placed_at,
      customer_id: o.customer_id,
      customer_name: (o.customers && o.customers.users && o.customers.users.full_name) || o.guest_name || 'Guest'
    }));

    const customersForAcq = await fetchAllRows(() =>
      supabase.from('customers').select('id, created_at').order('id', { ascending: true }));
    const acqDates = customersForAcq.map(c => new Date(c.created_at)).filter(d => !isNaN(d));
    const weekAgo = startOfDaysAgo(7);
    const monthAgo = monthsAgo(1);
    const threeMoAgo = monthsAgo(3);
    const sixMoAgo = monthsAgo(6);
    const newAccounts = {
      today: acqDates.filter(d => phDate(d) === todayStr).length,
      week: acqDates.filter(d => d >= weekAgo).length,
      month: acqDates.filter(d => d >= monthAgo).length,
      last3Months: acqDates.filter(d => d >= threeMoAgo).length,
      last6Months: acqDates.filter(d => d >= sixMoAgo).length
    };

    const salesOrders = await fetchAllRows(() =>
      supabase.from('orders').select('id, total_amount, customer_id').not('status', 'in', NOT_SALES).order('id', { ascending: true }));
    let registeredRevenue = 0, guestRevenue = 0;
    salesOrders.forEach(o => {
      const amt = parseFloat(o.total_amount) || 0;
      if (o.customer_id) registeredRevenue += amt; else guestRevenue += amt;
    });
    const totalRev = registeredRevenue + guestRevenue;
    const revenueSplit = {
      registeredRevenue,
      guestRevenue,
      registeredPercent: totalRev ? (registeredRevenue / totalRev) * 100 : 0,
      guestPercent: totalRev ? (guestRevenue / totalRev) * 100 : 0
    };

    const { data: registerSetting } = await supabase
      .from('system_settings')
      .select('setting_value')
      .eq('setting_key', 'register_status')
      .maybeSingle();
    const registerStatus = registerSetting?.setting_value || 'UNLOCKED';

    return res.json({
      status: 'success',
      user: userProfile,
      metrics: { todayOrders, todaySales, pendingOrders: pendingCount || 0 },
      recentOrders: formattedRecent,
      newAccounts,
      revenueSplit,
      registerStatus
    });
  } catch (error) {
    console.error('[sales-officer/dashboard] error:', error.message);
    return res.status(500).json({ status: 'error', message: error.message });
  }
}

router.get('/sales-officer/dashboard', buildSalesDashboard);

// X-Reading endpoint
router.get('/sales-officer/x-reading', async (req, res) => {
  try {
    if (!supabase) return noDb(res);
    const todayStr = phDate(new Date());
    const todayStart = phDayStartISO(todayStr);

    const { data: orders, error } = await supabase
      .from('orders')
      .select('total_amount, payment_method, order_type, status, order_items(quantity)')
      .gte('placed_at', todayStart)
      .not('status', 'in', NOT_SALES);

    if (error) throw error;

    let eWalletTotal = 0;
    let walkinCashTotal = 0;
    let preordersCount = 0;
    let presetsCount = 0;
    let cupsSold = 0;
    let claimedCount = 0;
    let claimedAmount = 0;
    let unclaimedCount = 0;
    let unclaimedAmount = 0;

    (orders || []).forEach(o => {
      const amt = parseFloat(o.total_amount) || 0;
      const method = String(o.payment_method || '').toLowerCase();
      const itemQty = (o.order_items || []).reduce((s, it) => s + (parseInt(it.quantity, 10) || 0), 0);
      const isCash = method.includes('cash');

      if (isCash) {
        walkinCashTotal += amt;
        presetsCount++;
        cupsSold += itemQty;
      } else {
        eWalletTotal += amt;
        preordersCount++;
        if (o.status === 'COMPLETED') {
          claimedCount++;
          claimedAmount += amt;
        } else {
          unclaimedCount++;
          unclaimedAmount += amt;
        }
      }
    });

    const openingFloat = 1000.00;
    const expectedDrawer = openingFloat + walkinCashTotal;
    const grossTotal = eWalletTotal + walkinCashTotal;

    return res.json({
      status: 'success',
      preordersCount,
      presetsCount,
      cupsSold,
      eWalletTotal,
      walkinCashTotal,
      claimedCount,
      claimedAmount,
      unclaimedCount,
      unclaimedAmount,
      openingFloat,
      expectedDrawer,
      grossTotal
    });
  } catch (error) {
    console.error('[sales-officer/x-reading] error:', error.message);
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

// Z-Reading endpoint
router.post('/sales-officer/z-reading', async (req, res) => {
  try {
    if (!supabase) return noDb(res);

    const userIdHeader = req.headers['x-user-id'] || req.body?.user_id;
    let recordedBy = null;
    if (userIdHeader && !isNaN(parseInt(userIdHeader, 10))) {
      const parsed = parseInt(userIdHeader, 10);
      const { data: userExists } = await supabase
        .from('users')
        .select('id')
        .eq('id', parsed)
        .maybeSingle();
      if (userExists) recordedBy = userExists.id;
    }

    const countedAmount = parseFloat(req.body?.actual_cash);
    const expectedAmount = parseFloat(req.body?.expected_cash) || 0;
    const variance = parseFloat(req.body?.variance) || (countedAmount - expectedAmount);
    const notes = req.body?.notes || 'Shift Z-Reading Transmitted from Sales Counter';

    if (isNaN(countedAmount) || countedAmount < 0) {
      return res.status(400).json({ status: 'error', message: 'actual_cash must be a valid number.' });
    }

    const { data: lastRecon } = await supabase
      .from('drawer_reconciliations')
      .select('period_end')
      .order('period_end', { ascending: false })
      .limit(1);

    const periodStart = (lastRecon && lastRecon.length && lastRecon[0].period_end)
      ? lastRecon[0].period_end
      : new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
    const periodEnd = new Date().toISOString();

    const { data: record, error: insertErr } = await supabase
      .from('drawer_reconciliations')
      .insert({
        counted_amount: countedAmount,
        expected_amount: expectedAmount,
        variance: Math.round(variance * 100) / 100,
        period_start: periodStart,
        period_end: periodEnd,
        notes,
        recorded_by: recordedBy
      })
      .select()
      .single();

    if (insertErr) {
      console.error('[sales-officer/z-reading] Insert error:', insertErr.message);
      return res.status(500).json({ status: 'error', message: insertErr.message });
    }

    try {
      await supabase.from('system_settings').upsert({
        setting_key: 'register_status',
        setting_value: 'LOCKED',
        description: 'Sales counter register lock state after Z-reading'
      }, { onConflict: 'setting_key' });
    } catch (e) {}

    return res.json({ status: 'success', message: 'Z-Reading saved successfully.', record });
  } catch (error) {
    console.error('[sales-officer/z-reading] error:', error.message);
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

// Order confirmation desk
router.get('/sales-officer/order-confirmation', async (req, res) => {
  try {
    if (!supabase) return noDb(res);
    const userProfile = await getEmployeeProfile(req);
    const todayStart = phDayStartISO(phDate(new Date()));

    const { data: pendingRows, error: pendingErr } = await supabase
      .from('orders')
      .select(`
        id, order_number, status, total_amount, payment_method, placed_at,
        guest_name, customer_id,
        customers(users(full_name)),
        order_items(item_label, quantity)
      `)
      .in('status', ORDER_REVIEW_STATUSES)
      .order('placed_at', { ascending: false });

    if (pendingErr) throw pendingErr;

    const pendingOrders = (pendingRows || []).map(o => {
      const itemLines = (o.order_items || []).map(
        it => `${it.quantity || 1}x ${cleanItemLabel(it.item_label, 'Item')}`
      );
      return {
        id: o.id,
        order_number: o.order_number,
        customer_id: o.customer_id,
        guest_name: o.guest_name,
        customer_name: (o.customers && o.customers.users && o.customers.users.full_name) || null,
        items_summary: itemLines.length ? itemLines.join(', ') : 'Custom drink order',
        payment_method: o.payment_method || 'N/A',
        total_amount: parseFloat(o.total_amount || 0),
        placed_at: o.placed_at
      };
    });

    const { count: confirmedToday } = await supabase
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .in('status', ['PREPARING', 'READY_FOR_PICKUP', 'COMPLETED'])
      .gte('placed_at', todayStart);

    const { count: rejectedCount } = await supabase
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'CANCELLED')
      .gte('placed_at', todayStart);

    return res.json({
      status: 'success',
      user: userProfile,
      metrics: {
        pendingCount: pendingOrders.length,
        confirmedToday: confirmedToday || 0,
        rejectedCount: rejectedCount || 0
      },
      pendingOrders
    });
  } catch (error) {
    console.error('[sales-officer/order-confirmation] error:', error.message);
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

// Order monitoring desk
router.get('/sales-officer/order-monitoring', async (req, res) => {
  try {
    if (!supabase) return noDb(res);
    const userProfile = await getEmployeeProfile(req);
    const todayStart = phDayStartISO(phDate(new Date()));

    const { count: preparingCount, error: e1 } = await supabase
      .from('orders').select('*', { count: 'exact', head: true }).eq('status', 'PREPARING');
    const { count: readyCount, error: e2 } = await supabase
      .from('orders').select('*', { count: 'exact', head: true }).eq('status', 'READY_FOR_PICKUP');
    const { count: claimedToday, error: e3 } = await supabase
      .from('orders').select('*', { count: 'exact', head: true })
      .eq('status', 'COMPLETED').gte('completed_at', todayStart);
    if (e1 || e2 || e3) throw (e1 || e2 || e3);

    const { data: activeOrders, error } = await supabase
      .from('orders')
      .select('id, order_number, status, total_amount, placed_at, guest_name, customer_id, customers(users(full_name)), order_items(item_label, quantity)')
      .in('status', ['PREPARING', 'READY_FOR_PICKUP'])
      .order('placed_at', { ascending: false });
    if (error) throw error;

    const formattedActive = (activeOrders || []).map(o => {
      const lines = (o.order_items || []).map(it => `${it.quantity || 1}x ${cleanItemLabel(it.item_label, 'Item')}`);
      return {
        id: o.id,
        order_number: o.order_number,
        status: o.status,
        total_amount: parseFloat(o.total_amount || 0),
        placed_at: o.placed_at,
        customer_id: o.customer_id,
        guest_name: o.guest_name,
        customer_name: (o.customers && o.customers.users && o.customers.users.full_name) || o.guest_name || 'Guest',
        item_count: (o.order_items || []).length || 1,
        items_summary: lines.length ? lines.join(', ') : 'Custom drink order'
      };
    });

    return res.json({
      status: 'success',
      user: userProfile,
      metrics: { preparingCount: preparingCount || 0, transitCount: readyCount || 0, claimedToday: claimedToday || 0 },
      activeOrders: formattedActive
    });
  } catch (error) {
    console.error('[sales-officer/order-monitoring] error:', error.message);
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

// Releasing/Claiming lamang sa sales counter; walang bawas ng sangkap dito
router.post('/sales-officer/order-monitoring/update', async (req, res) => {
  try {
    if (!supabase) return noDb(res);
    const { order_id, action } = req.body;
    if (!order_id || !action) {
      return res.status(400).json({ status: 'error', message: 'Missing order_id or action.' });
    }
    const newStatus = action === 'complete' ? 'COMPLETED' : 'CANCELLED';
    const { error } = await supabase
      .from('orders')
      .update({ status: newStatus, completed_at: new Date().toISOString() })
      .eq('id', order_id);

    if (error) throw error;
    return res.json({ status: 'success', message: `Order updated to ${newStatus}.` });
  } catch (error) {
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

// Customer records
router.get('/sales-officer/customer-records', async (req, res) => {
  try {
    if (!supabase) return noDb(res);
    const userProfile = await getEmployeeProfile(req);
    const todayStr = phDate(new Date());

    const customers = await fetchAllRows(() => supabase
      .from('customers')
      .select(`
        id, phone, created_at,
        users(full_name, email, avatar),
        orders(id, order_number, total_amount, status, placed_at, payment_method, order_items(id))
      `)
      .order('id', { ascending: true }));

    const summarise = (orders) => {
      const valid = (orders || []).filter(o => isSaleStatus(o.status));
      valid.sort((a, b) => new Date(b.placed_at) - new Date(a.placed_at));
      const payCounts = {};
      valid.forEach(o => { if (o.payment_method) payCounts[o.payment_method] = (payCounts[o.payment_method] || 0) + 1; });
      const preferred = Object.keys(payCounts).sort((a, b) => payCounts[b] - payCounts[a])[0] || 'N/A';
      return {
        preferred_payment: preferred,
        total_orders: valid.length,
        total_spent: valid.reduce((sum, o) => sum + (parseFloat(o.total_amount) || 0), 0),
        last_order_at: valid.length ? valid[0].placed_at : null,
        hasOrderToday: valid.some(o => phDate(o.placed_at) === todayStr),
        recent_orders: valid.slice(0, 5).map(o => ({
          order_number: o.order_number,
          placed_at: o.placed_at,
          total_amount: parseFloat(o.total_amount) || 0,
          item_count: (o.order_items || []).length || 1
        }))
      };
    };

    const registered = customers.map(c => {
      const userObj = Array.isArray(c.users) ? c.users[0] : c.users;
      return {
        id: c.id,
        type: 'registered',
        full_name: (userObj && userObj.full_name) || 'Customer',
        email: (userObj && userObj.email) || '',
        phone: c.phone || 'N/A',
        avatar: resolveAvatar(userObj && userObj.avatar),
        address: null,
        created_at: c.created_at,
        ...summarise(c.orders)
      };
    });

    const guestOrders = await fetchAllRows(() => supabase
      .from('orders')
      .select('id, order_number, status, total_amount, payment_method, placed_at, guest_name, guest_email, order_items(id)')
      .is('customer_id', null)
      .order('id', { ascending: true }));

    const guestMap = new Map();
    guestOrders.forEach(o => {
      const key = (o.guest_email || '').trim().toLowerCase() || (o.guest_name || '').trim().toLowerCase() || `order-${o.id}`;
      if (!guestMap.has(key)) guestMap.set(key, { name: o.guest_name, email: o.guest_email, orders: [] });
      const g = guestMap.get(key);
      if (!g.name && o.guest_name) g.name = o.guest_name;
      if (!g.email && o.guest_email) g.email = o.guest_email;
      g.orders.push(o);
    });

    let guestIdx = 0;
    const guests = [...guestMap.values()].map(g => {
      const sum = summarise(g.orders);
      return {
        id: `guest-${++guestIdx}`,
        type: 'guest',
        full_name: g.name || 'Guest',
        email: g.email || '',
        phone: 'N/A',
        avatar: resolveAvatar(null),
        address: null,
        created_at: g.orders[0] ? g.orders[0].placed_at : null,
        ...sum
      };
    }).filter(g => g.total_orders > 0);

    const weekAgo = startOfDaysAgo(7);
    const monthAgo = monthsAgo(1);
    const threeMoAgo = monthsAgo(3);
    const sixMoAgo = monthsAgo(6);
    const createdDates = registered.map(c => new Date(c.created_at)).filter(d => !isNaN(d));
    const acquisition = {
      today: createdDates.filter(d => phDate(d) === todayStr).length,
      week: createdDates.filter(d => d >= weekAgo).length,
      month: createdDates.filter(d => d >= monthAgo).length,
      last3Months: createdDates.filter(d => d >= threeMoAgo).length,
      last6Months: createdDates.filter(d => d >= sixMoAgo).length
    };

    const baseLastMonth = createdDates.filter(d => d < monthAgo).length;
    let registeredGrowth = '';
    if (baseLastMonth > 0) {
      const pct = ((registered.length - baseLastMonth) / baseLastMonth) * 100;
      registeredGrowth = `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}% vs last month`;
    } else if (acquisition.month > 0) {
      registeredGrowth = `+${acquisition.month} new this month`;
    }

    const sumCompleted = (orders) => {
      const done = (orders || []).filter(o => isSaleStatus(o.status));
      return { count: done.length, revenue: done.reduce((t, o) => t + (parseFloat(o.total_amount) || 0), 0) };
    };
    let memberRevenue = 0, memberOrders = 0;
    customers.forEach(c => { const r = sumCompleted(c.orders); memberRevenue += r.revenue; memberOrders += r.count; });
    const guestDone = sumCompleted(guestOrders);
    const segTotalRevenue = memberRevenue + guestDone.revenue;

    const segmentation = {
      memberCount: registered.length,
      guestCount: guests.length,
      memberRevenue,
      guestRevenue: guestDone.revenue,
      memberRevenuePercent: segTotalRevenue ? (memberRevenue / segTotalRevenue) * 100 : 0,
      guestRevenuePercent: segTotalRevenue ? (guestDone.revenue / segTotalRevenue) * 100 : 0,
      memberOrders,
      guestOrders: guestDone.count
    };

    const everyone = [...registered, ...guests];
    const activeToday = everyone.filter(c => c.hasOrderToday).length;

    return res.json({
      status: 'success',
      user: userProfile,
      metrics: {
        totalRegistered: registered.length,
        registeredGrowth,
        todaySignups: acquisition.today,
        activeToday,
        repeatRate: registered.length
          ? `${Math.round((registered.filter(c => c.total_orders > 1).length / registered.length) * 1000) / 10}%`
          : '0%',
        acquisition
      },
      segmentation,
      customers: everyone.map(({ hasOrderToday, ...rest }) => rest)
    });
  } catch (error) {
    console.error('[sales-officer/customer-records] error:', error.message);
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

// Promotions desk
router.get('/sales-officer/promotions', async (req, res) => {
  try {
    if (!supabase) return noDb(res);
    const userProfile = await getEmployeeProfile(req);

    const { data: promotions, error } = await supabase
      .from('promotions')
      .select('*')
      .order('id', { ascending: false });

    if (error) throw error;

    const campaigns = (promotions || []).map(p => ({
      id: p.id,
      code: p.code,
      discount_type: p.discount_type,
      discount_value: parseFloat(p.discount_value) || 0,
      target_segment: p.target_segment || 'all',
      min_spend: p.min_spend !== undefined ? p.min_spend : null,
      usage_cap: p.usage_cap !== undefined ? p.usage_cap : null,
      usage_count: p.usage_count || 0,
      status: p.status,
      pitch_note: p.pitch_note || p.title || '',
      rejection_reason: p.rejection_reason || null,
      created_at: p.created_at
    }));

    const activeCount = campaigns.filter(c => (c.status || '').toUpperCase() === 'ACTIVE').length;

    return res.json({
      status: 'success',
      user: userProfile,
      metrics: { totalPromosCount: campaigns.length, activePromosCount: activeCount },
      campaigns
    });
  } catch (error) {
    console.error('[sales-officer/promotions] error:', error.message);
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

router.post('/sales-officer/promotions/pitch', async (req, res) => {
  try {
    if (!supabase) return noDb(res);
    const { code, target_segment, discount_type, discount_value, min_spend, usage_cap, pitch_note } = req.body;

    if (!code || discount_value === undefined || discount_value === null) {
      return res.status(400).json({ status: 'error', message: 'Code and discount value are required.' });
    }

    const { data, error } = await supabase
      .from('promotions')
      .insert([{
        code: String(code).toUpperCase().trim(),
        title: pitch_note || `${code} promo`,
        discount_type: discount_type || 'percent',
        discount_value: parseFloat(discount_value) || 0,
        target_segment: target_segment || 'all',
        min_spend: min_spend !== undefined && min_spend !== null && min_spend !== '' ? parseFloat(min_spend) : null,
        usage_cap: usage_cap !== undefined && usage_cap !== null && usage_cap !== '' ? parseInt(usage_cap, 10) : null,
        usage_count: 0,
        pitch_note: pitch_note || '',
        status: 'PENDING_APPROVAL'
      }])
      .select()
      .single();

    if (error) throw error;
    return res.json({ status: 'success', message: 'Promotion pitched for CEO approval.', promotion: data });
  } catch (error) {
    console.error('[sales-officer/promotions/pitch] error:', error.message);
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

router.post('/sales-officer/promotions/create', async (req, res) => {
  try {
    if (!supabase) return noDb(res);
    const { code, discount_type, discount_value } = req.body;
    if (!code || !discount_value) {
      return res.status(400).json({ status: 'error', message: 'Code and discount value required.' });
    }
    const { data, error } = await supabase
      .from('promotions')
      .insert([{
        code: String(code).toUpperCase().trim(),
        discount_type: discount_type || 'percent',
        discount_value: parseFloat(discount_value),
        status: 'ACTIVE'
      }])
      .select()
      .single();

    if (error) throw error;
    return res.json({ status: 'success', promotion: data });
  } catch (error) {
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

router.post('/sales-officer/promotions/toggle', async (req, res) => {
  try {
    if (!supabase) return noDb(res);
    const { toggle_id, new_status } = req.body;
    const { error } = await supabase.from('promotions').update({ status: new_status }).eq('id', toggle_id);
    if (error) throw error;
    return res.json({ status: 'success', message: 'Status updated.' });
  } catch (error) {
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

// Sales reports
router.get('/sales-officer/sales-reports', async (req, res) => {
  try {
    if (!supabase) return noDb(res);
    const userProfile = await getEmployeeProfile(req);
    const { start, end } = resolveRange(req.query.range || 'month', req.query.date);

    const orders = await fetchAllRows(() => {
      let q = supabase
        .from('orders')
        .select('id, subtotal, total_amount, status, placed_at, order_items(item_label, quantity, line_total)')
        .not('status', 'in', NOT_SALES)
        .order('id', { ascending: true });
      if (start) q = q.gte('placed_at', start);
      if (end) q = q.lt('placed_at', end);
      return q;
    });

    const grossSales = orders.reduce((sum, o) => sum + (parseFloat(o.subtotal) || parseFloat(o.total_amount) || 0), 0);
    const netSales = orders.reduce((sum, o) => sum + (parseFloat(o.total_amount) || 0), 0);
    const aov = orders.length ? netSales / orders.length : 0;

    const skuByName = new Map();
    try {
      const { data: products } = await supabase.from('products').select('sku, name');
      (products || []).forEach(p => { if (p.name) skuByName.set(String(p.name).trim().toLowerCase(), p.sku); });
    } catch (e) {}

    const rank = new Map();
    orders.forEach(o => {
      (o.order_items || []).forEach(it => {
        const name = cleanItemLabel(it.item_label, 'Custom drink');
        const key = name.toLowerCase();
        if (!rank.has(key)) rank.set(key, { sku: skuByName.get(key) || null, name, units_sold: 0, revenue: 0 });
        const r = rank.get(key);
        r.units_sold += parseInt(it.quantity, 10) || 0;
        r.revenue += parseFloat(it.line_total) || 0;
      });
    });
    const productsRank = [...rank.values()].sort((a, b) => b.units_sold - a.units_sold || b.revenue - a.revenue);

    return res.json({
      status: 'success',
      user: userProfile,
      metrics: { grossSales, netSales, aov },
      productsRank
    });
  } catch (error) {
    console.error('[sales-officer/sales-reports] error:', error.message);
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

// Sales targets
router.get('/sales-officer/sales-target', async (req, res) => {
  try {
    if (!supabase) return noDb(res);
    const userProfile = await getEmployeeProfile(req);

    const todayStr = phDate(new Date());
    const todayStart = phDayStartISO(todayStr);
    const monthStart = phDayStartISO(todayStr.slice(0, 8) + '01');
    const historyStartDate = phAddDays(todayStr, -90);
    const historyStart = phDayStartISO(historyStartDate);
    const sinceISO = new Date(Math.min(new Date(monthStart), new Date(historyStart))).toISOString();

    let dailyTarget = 15000, monthlyTarget = 320000;
    try {
      const { data: targets } = await supabase.from('sales_targets').select('period, target_amount');
      (targets || []).forEach(t => {
        if (t.period === 'daily') dailyTarget = parseFloat(t.target_amount) || dailyTarget;
        if (t.period === 'monthly') monthlyTarget = parseFloat(t.target_amount) || monthlyTarget;
      });
    } catch (e) {}

    const orders = await fetchAllRows(() => supabase
      .from('orders')
      .select('id, total_amount, status, order_type, placed_at, order_items(item_label, quantity, line_total, size)')
      .not('status', 'in', NOT_SALES)
      .gte('placed_at', sinceISO)
      .order('id', { ascending: true }));

    let todaySales = 0, monthSales = 0;
    let dailyPre = 0, dailyWalk = 0, monthPre = 0, monthWalk = 0;
    let preordersTotal = 0, preordersClaimed = 0;
    const presetAgg = new Map();

    orders.forEach(o => {
      const amt = parseFloat(o.total_amount) || 0;
      const placed = new Date(o.placed_at);
      const isPre = o.order_type === 'custom_build';
      if (placed >= new Date(monthStart)) {
        monthSales += amt;
        if (isPre) monthPre += amt; else monthWalk += amt;
      }
      if (placed >= new Date(todayStart)) {
        todaySales += amt;
        if (isPre) {
          dailyPre += amt;
          preordersTotal++;
          if (o.status === 'COMPLETED') preordersClaimed++;
        } else {
          dailyWalk += amt;
        }
      }
      if (!isPre) {
        const day = phDate(placed);
        (o.order_items || []).forEach(it => {
          const name = cleanItemLabel(it.item_label, 'Preset drink');
          const key = `${day}|${name.toLowerCase()}`;
          if (!presetAgg.has(key)) presetAgg.set(key, { day, name, size: null, cups: 0, revenue: 0 });
          const r = presetAgg.get(key);
          r.cups += parseInt(it.quantity, 10) || 0;
          r.revenue += parseFloat(it.line_total) || 0;
          if (it.size) r.size = it.size;
        });
      }
    });

    const batchMap = new Map();
    try {
      const { data: batches } = await supabase
        .from('preset_batches').select('batch_date, item_label, prepared_qty').gte('batch_date', historyStartDate);
      (batches || []).forEach(b => {
        const name = cleanItemLabel(b.item_label, 'Preset drink');
        batchMap.set(`${b.batch_date}|${name.toLowerCase()}`, { day: b.batch_date, name, prepared: parseInt(b.prepared_qty, 10) || 0 });
      });
    } catch (e) {}

    const keys = new Set([...presetAgg.keys(), ...batchMap.keys()]);
    const presets = [...keys].map((key, i) => {
      const a = presetAgg.get(key);
      const b = batchMap.get(key);
      const cups = a ? a.cups : 0;
      return {
        id: i + 1,
        name: a ? a.name : b.name,
        cup_size: a ? a.size : null,
        sugar_level: null,
        prepared_batch: b ? b.prepared : null,
        cups_sold: cups,
        unit_price: a && cups ? a.revenue / cups : 0,
        target_date: phDayStartISO(a ? a.day : b.day)
      };
    }).sort((x, y) => (y.target_date.localeCompare(x.target_date)) || (y.cups_sold - x.cups_sold));

    const pct = (v, t) => (t ? Math.round((v / t) * 100) : 0);

    return res.json({
      status: 'success',
      user: userProfile,
      metrics: {
        todaySales, dailyTarget, dailyPct: pct(todaySales, dailyTarget),
        dailyPreorderRev: dailyPre, dailyWalkinRev: dailyWalk,
        monthSales, monthlyTarget, monthlyPct: pct(monthSales, monthlyTarget),
        monthPreorderRev: monthPre, monthWalkinRev: monthWalk,
        preordersClaimed, preordersTotal, fulfillmentPct: pct(preordersClaimed, preordersTotal)
      },
      presets
    });
  } catch (error) {
    console.error('[sales-officer/sales-target] error:', error.message);
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

// Finance Officer Dashboard
router.get('/finance-officer/dashboard', async (req, res) => {
  try {
    if (!supabase) return noDb(res);
    const userProfile = await getEmployeeProfile(req);
    const thisYear = new Date().getFullYear();

    const { data: paidOrdersData } = await supabase
      .from('orders').select('total_amount, placed_at').in('status', ['PAID_VERIFIED', 'COMPLETED']);
    const paidOrders = paidOrdersData || [];
    const totalRevenue = paidOrders.reduce((s, o) => s + (parseFloat(o.total_amount) || 0), 0);
    const totalPayments = totalRevenue;

    const { data: expenseRows } = await supabase.from('expenses').select('amount, status, expense_date');
    const totalExpenses = (expenseRows || [])
      .filter(e => ['APPROVED', 'PURCHASED'].includes(e.status))
      .reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
    const totalBudget = (expenseRows || []).reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);

    const monthlyInflow = Array(12).fill(0);
    paidOrders.forEach(o => {
      const d = new Date(o.placed_at);
      if (d.getFullYear() === thisYear) monthlyInflow[d.getMonth()] += parseFloat(o.total_amount) || 0;
    });

    const monthlyOutflow = Array(12).fill(0);
    (expenseRows || []).forEach(e => {
      if (!['APPROVED', 'PURCHASED'].includes(e.status)) return;
      const d = new Date(e.expense_date);
      if (d.getFullYear() === thisYear) monthlyOutflow[d.getMonth()] += parseFloat(e.amount) || 0;
    });

    let year2026 = 0, year2025 = 0, year2024 = 0;
    paidOrders.forEach(o => {
      const y = new Date(o.placed_at).getFullYear();
      const amt = parseFloat(o.total_amount) || 0;
      if (y === 2026) year2026 += amt;
      else if (y === 2025) year2025 += amt;
      else if (y === 2024) year2024 += amt;
    });
    const totalAllYears = year2026 + year2025 + year2024;
    const pct = (v) => totalAllYears > 0 ? Math.round((v / totalAllYears) * 100) : 0;

    return res.json({
      status: 'success',
      user: userProfile,
      metrics: { totalBudget, totalRevenue, totalPayments, totalExpenses },
      monthlyInflow,
      monthlyOutflow,
      yearlyTotals: { y2026: year2026, y2025: year2025, y2024: year2024 },
      yearlyPercentages: { p2026: pct(year2026), p2025: pct(year2025), p2024: pct(year2024) },
      weeklyWave: { series1: [0, 0, 0, 0, 0, 0, 0], series2: [0, 0, 0, 0, 0, 0, 0] }
    });
  } catch (error) {
    console.error('[finance-officer/dashboard] error:', error.message);
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

// Finance Revenue
router.get('/finance-officer/revenue', async (req, res) => {
  try {
    if (!supabase) return noDb(res);
    const userProfile = await getEmployeeProfile(req);
    const thisYear = new Date().getFullYear();

    const { data: paidOrders } = await supabase
      .from('orders')
      .select('total_amount, placed_at, order_type')
      .in('status', ['PAID_VERIFIED', 'COMPLETED']);
    const totalRevenue = (paidOrders || []).reduce((s, o) => s + (parseFloat(o.total_amount) || 0), 0);
    const totalPayments = totalRevenue;

    let preordersInflow = 0, presetsInflow = 0;
    (paidOrders || []).forEach(o => {
      const amt = parseFloat(o.total_amount) || 0;
      if (o.order_type === 'custom_build') preordersInflow += amt;
      else presetsInflow += amt;
    });

    const tuesdays = [];
    const thursdays = [];
    (paidOrders || []).forEach(o => {
      const d = new Date(o.placed_at);
      const amt = parseFloat(o.total_amount) || 0;
      const dayKey = d.toISOString().slice(0, 10);
      const dow = d.getDay();
      if (dow === 2) tuesdays.push({ dayKey, amt });
      if (dow === 4) thursdays.push({ dayKey, amt });
    });
    const sumByDay = (arr) => {
      const map = {};
      arr.forEach(({ dayKey, amt }) => { map[dayKey] = (map[dayKey] || 0) + amt; });
      return Object.keys(map).sort().map(k => map[k]);
    };
    const tuesdayTotals = sumByDay(tuesdays).slice(-4);
    const thursdayTotals = sumByDay(thursdays).slice(-4);
    while (tuesdayTotals.length < 4) tuesdayTotals.unshift(0);
    while (thursdayTotals.length < 4) thursdayTotals.unshift(0);

    const { data: expenseRows } = await supabase.from('expenses').select('amount, status, expense_date, category');
    const totalExpenses = (expenseRows || [])
      .filter(e => ['APPROVED', 'PURCHASED'].includes(e.status))
      .reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
    const totalBudget = (expenseRows || []).reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);

    const { data: cupItems } = await supabase
      .from('order_items')
      .select('quantity, orders!inner(status)')
      .in('orders.status', ['PAID_VERIFIED', 'COMPLETED']);
    const totalCupsSold = (cupItems || []).reduce((s, it) => s + (parseInt(it.quantity, 10) || 0), 0);

    const totalCogs = (expenseRows || [])
      .filter(e => e.category === 'cogs' && ['APPROVED', 'PURCHASED'].includes(e.status))
      .reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);

    let avgCupMargin = null;
    let netProfitMarginPct = null;
    if (totalCupsSold > 0 && totalCogs > 0) {
      avgCupMargin = Math.round(((totalRevenue - totalCogs) / totalCupsSold) * 100) / 100;
      netProfitMarginPct = totalRevenue > 0
        ? Math.round(((totalRevenue - totalCogs) / totalRevenue) * 1000) / 10
        : null;
    }

    const revenueMonthly = Array(12).fill(0);
    const paymentsMonthly = Array(12).fill(0);
    (paidOrders || []).forEach(o => {
      const d = new Date(o.placed_at);
      if (d.getFullYear() === thisYear) {
        revenueMonthly[d.getMonth()] += parseFloat(o.total_amount) || 0;
        paymentsMonthly[d.getMonth()] += parseFloat(o.total_amount) || 0;
      }
    });

    const expensesMonthly = Array(12).fill(0);
    const budgetMonthly = Array(12).fill(0);
    (expenseRows || []).forEach(e => {
      const d = new Date(e.expense_date);
      if (d.getFullYear() !== thisYear) return;
      budgetMonthly[d.getMonth()] += parseFloat(e.amount) || 0;
      if (['APPROVED', 'PURCHASED'].includes(e.status)) expensesMonthly[d.getMonth()] += parseFloat(e.amount) || 0;
    });

    return res.json({
      status: 'success',
      user: userProfile,
      metrics: { totalBudget, totalRevenue, totalExpenses, totalPayments, preordersInflow, presetsInflow, avgCupMargin, netProfitMarginPct, totalCupsSold, totalCogs },
      percentages: {
        budget: totalBudget > 0 ? 100 : 0,
        revenue: totalRevenue > 0 ? 100 : 0,
        expenses: totalExpenses > 0 ? 100 : 0,
        payments: totalPayments > 0 ? 100 : 0
      },
      monthly: { budget: budgetMonthly, revenue: revenueMonthly, expenses: expensesMonthly, payments: paymentsMonthly },
      weeklyComparison: { tuesday: tuesdayTotals, thursday: thursdayTotals },
      channelShares: [preordersInflow, presetsInflow]
    });
  } catch (error) {
    console.error('[finance-officer/revenue] error:', error.message);
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

// Finance Budget Cycles
router.get('/finance-officer/budget', async (req, res) => {
  try {
    if (!supabase) return noDb(res);
    const userProfile = await getEmployeeProfile(req);

    const { data: cycles, error } = await supabase
      .from('budget_cycles')
      .select('id, cycle_name, allocation_date, capital, raw_material, petty_cash_fund, emergency_funds, manpower_cost, status, created_at')
      .order('allocation_date', { ascending: false });
    if (error) throw error;

    const records = (cycles || []).map(c => {
      const d = new Date(c.allocation_date);
      return {
        id: c.id,
        date: c.cycle_name || d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
        month_group: d.toLocaleDateString('en-US', { month: 'long' }).toLowerCase(),
        capital: parseFloat(c.capital) || 0,
        raw_material: parseFloat(c.raw_material) || 0,
        petty_cash_fund: parseFloat(c.petty_cash_fund) || 0,
        emergency_funds: parseFloat(c.emergency_funds) || 0,
        manpower_cost: parseFloat(c.manpower_cost) || 0,
        status: c.status
      };
    });

    return res.json({ status: 'success', user: userProfile, records });
  } catch (error) {
    console.error('[finance-officer/budget] error:', error.message);
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

router.post('/finance-officer/budget', async (req, res) => {
  try {
    if (!supabase) return noDb(res);
    const userId = req.headers['x-user-id'] || req.query.user_id || req.body?.user_id || null;

    const cycle_name = (req.body?.cycle_name || '').toString().trim();
    const allocation_date = (req.body?.allocation_date || '').toString().trim();
    const capital = parseFloat(req.body?.capital);
    const raw_material = parseFloat(req.body?.raw_material);
    const petty_cash_fund = parseFloat(req.body?.petty_cash_fund);
    const emergency_funds = parseFloat(req.body?.emergency_funds);
    const manpower_cost = parseFloat(req.body?.manpower_cost);

    if (!cycle_name || !allocation_date) {
      return res.status(400).json({ status: 'error', message: 'cycle_name and allocation_date are required.' });
    }
    if ([capital, raw_material, petty_cash_fund].some(v => isNaN(v) || v < 0)) {
      return res.status(400).json({ status: 'error', message: 'capital, raw_material, and petty_cash_fund must be valid non-negative numbers.' });
    }

    await supabase.from('budget_cycles').update({ status: 'RECONCILED' }).eq('status', 'ACTIVE');

    const { data: record, error: insertErr } = await supabase
      .from('budget_cycles')
      .insert({
        cycle_name,
        allocation_date,
        capital,
        raw_material,
        petty_cash_fund,
        emergency_funds: isNaN(emergency_funds) ? 0 : emergency_funds,
        manpower_cost: isNaN(manpower_cost) ? 0 : manpower_cost,
        status: 'ACTIVE',
        created_by: userId
      })
      .select()
      .single();
    if (insertErr) throw insertErr;

    return res.json({ status: 'success', record });
  } catch (error) {
    console.error('[finance-officer/budget POST] error:', error.message);
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

router.get('/finance-officer/expenses', async (req, res) => {
  try {
    if (!supabase) return noDb(res);
    const userProfile = await getEmployeeProfile(req);
    return res.json({ status: 'success', user: userProfile, records: [] });
  } catch (error) {
    console.error('[finance-officer/expenses] error:', error.message);
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

router.get('/finance-officer/payments', async (req, res) => {
  try {
    if (!supabase) return noDb(res);
    const userProfile = await getEmployeeProfile(req);

    const { data: paidOrders, error } = await supabase
      .from('orders')
      .select('id, order_number, total_amount, placed_at, payment_method, guest_name, customers(users(full_name, username))')
      .eq('status', 'PAID_VERIFIED')
      .order('placed_at', { ascending: false });
    if (error) throw error;

    const now = new Date();
    let monthlyTotal = 0, quarterlyTotal = 0, yearlyTotal = 0;
    const currentQuarter = Math.floor(now.getMonth() / 3);

    const payments = (paidOrders || []).map(o => {
      const amt = parseFloat(o.total_amount) || 0;
      const d = new Date(o.placed_at);
      if (d.getFullYear() === now.getFullYear()) {
        yearlyTotal += amt;
        if (Math.floor(d.getMonth() / 3) === currentQuarter) quarterlyTotal += amt;
        if (d.getMonth() === now.getMonth()) monthlyTotal += amt;
      }

      const userObj = o.customers && o.customers.users;
      const isCash = o.payment_method === 'Cash on Pick-Up';
      const channel = isCash ? 'cash' : 'ewallet';
      const channelLabel = isCash ? 'Cash on Counter' : 'E-Wallet';

      return {
        id: o.id,
        amount: amt,
        order_number: o.order_number,
        date: d.toLocaleString('en-US', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
        customer_name: (userObj && userObj.full_name) || o.guest_name || 'Guest Customer',
        user_identifier: (userObj && userObj.username) || 'N/A',
        channel,
        channel_label: channelLabel,
        ref_id: 'N/A',
        status_label: '✓ Verified'
      };
    });

    let latestReconciliation = null;
    const { data: reconRows, error: reconErr } = await supabase
      .from('drawer_reconciliations')
      .select('id, counted_amount, expected_amount, variance, period_start, period_end, notes, created_at')
      .order('period_end', { ascending: false })
      .limit(1);
    if (reconErr) throw reconErr;
    if (reconRows && reconRows.length) latestReconciliation = reconRows[0];

    return res.json({
      status: 'success',
      user: userProfile,
      summary: { monthlyTotal, quarterlyTotal, yearlyTotal },
      payments,
      latestReconciliation
    });
  } catch (error) {
    console.error('[finance-officer/payments] error:', error.message);
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

// Finance Drawer Breakdown Helper
async function computeDrawerBreakdown(periodStart, periodEnd) {
  const { data: orders, error } = await supabase
    .from('orders')
    .select('total_amount, payment_method')
    .gte('placed_at', periodStart)
    .lte('placed_at', periodEnd)
    .not('status', 'in', NOT_SALES);
  if (error) throw error;

  let eWalletTotal = 0, walkinCashTotal = 0, preordersCount = 0, presetsCount = 0;
  (orders || []).forEach(o => {
    const amt = parseFloat(o.total_amount) || 0;
    const method = String(o.payment_method || '').toLowerCase();
    const isCash = method.includes('cash');
    if (isCash) { walkinCashTotal += amt; presetsCount++; }
    else { eWalletTotal += amt; preordersCount++; }
  });

  const openingFloat = 1000.00;
  const expectedDrawer = openingFloat + walkinCashTotal;
  const grossTotal = eWalletTotal + walkinCashTotal;

  return { eWalletTotal, walkinCashTotal, openingFloat, expectedDrawer, grossTotal, preordersCount, presetsCount };
}

router.get('/finance-officer/reconciliation/preview', async (req, res) => {
  try {
    if (!supabase) return noDb(res);

    const { data: lastRecon, error: lastReconErr } = await supabase
      .from('drawer_reconciliations')
      .select('period_end, counted_amount, variance, notes, created_at')
      .order('period_end', { ascending: false })
      .limit(1);
    if (lastReconErr) throw lastReconErr;

    const periodStart = (lastRecon && lastRecon.length)
      ? lastRecon[0].period_end
      : new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
    const periodEnd = new Date().toISOString();

    const breakdown = await computeDrawerBreakdown(periodStart, periodEnd);

    return res.json({
      status: 'success',
      periodStart,
      periodEnd,
      lastReconciliation: (lastRecon && lastRecon.length) ? lastRecon[0] : null,
      ...breakdown
    });
  } catch (error) {
    console.error('[finance-officer/reconciliation/preview] error:', error.message);
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

router.post('/finance-officer/reconciliation', async (req, res) => {
  try {
    if (!supabase) return noDb(res);
    const userId = req.headers['x-user-id'] || req.query.user_id || req.body?.user_id || null;

    const countedAmount = parseFloat(req.body?.counted_amount);
    if (isNaN(countedAmount) || countedAmount < 0) {
      return res.status(400).json({ status: 'error', message: 'counted_amount is required and must be a non-negative number.' });
    }
    const notes = (req.body?.notes || '').toString().trim() || null;

    const { data: lastRecon, error: lastReconErr } = await supabase
      .from('drawer_reconciliations')
      .select('period_end')
      .order('period_end', { ascending: false })
      .limit(1);
    if (lastReconErr) throw lastReconErr;

    const periodStart = (lastRecon && lastRecon.length)
      ? lastRecon[0].period_end
      : new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
    const periodEnd = new Date().toISOString();

    const { expectedDrawer, eWalletTotal, walkinCashTotal } = await computeDrawerBreakdown(periodStart, periodEnd);
    const expectedAmount = expectedDrawer;
    const variance = Math.round((countedAmount - expectedAmount) * 100) / 100;
    const autoNote = `E-Wallet/QR Ph: ₱${eWalletTotal.toFixed(2)} | Walk-in Cash: ₱${walkinCashTotal.toFixed(2)}`;

    const { data: record, error: insertErr } = await supabase
      .from('drawer_reconciliations')
      .insert({
        counted_amount: countedAmount,
        expected_amount: expectedAmount,
        variance,
        period_start: periodStart,
        period_end: periodEnd,
        notes: notes ? `${notes} | ${autoNote}` : autoNote,
        recorded_by: userId
      })
      .select()
      .single();
    if (insertErr) throw insertErr;

    try {
      await supabase.from('system_settings').upsert({
        setting_key: 'register_status',
        setting_value: 'UNLOCKED',
        description: 'Sales counter register lock state after Z-reading'
      }, { onConflict: 'setting_key' });
    } catch (e) {}

    return res.json({ status: 'success', record });
  } catch (error) {
    console.error('[finance-officer/reconciliation] error:', error.message);
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

// Procurement Officer
function routeForAmount(amount) {
  const n = parseFloat(amount) || 0;
  return n > 500 ? 'ceo' : (n > 300 ? 'finance' : 'procure');
}

router.get('/procurement-officer/dashboard', async (req, res) => {
  try {
    if (!supabase) return noDb(res);
    const userProfile = await getEmployeeProfile(req);

    const { data: expenseRows, error: expErr } = await supabase
      .from('expenses')
      .select('id, item_name, store_name, amount, status, requested_by, created_at')
      .order('created_at', { ascending: false });
    if (expErr) throw expErr;
    const expenses = expenseRows || [];

    const directBuyCount = expenses.filter(e => routeForAmount(e.amount) === 'procure' && e.status !== 'PURCHASED').length;
    const escalatedCount = expenses.filter(e => routeForAmount(e.amount) !== 'procure' && ['PENDING_FINANCE', 'PENDING_CEO'].includes(e.status)).length;

    const latest = expenses.slice(0, 20);
    const requesterIds = [...new Set(latest.map(e => e.requested_by).filter(Boolean))];
    const requesterMap = {};
    if (requesterIds.length) {
      const { data: requesterUsers } = await supabase.from('users').select('id, full_name').in('id', requesterIds);
      (requesterUsers || []).forEach(u => { requesterMap[u.id] = u.full_name; });
    }

    const purchaseRequests = latest.map(e => ({
      id: e.id,
      pr_code: `PR-${1000 + e.id}`,
      name: e.item_name,
      supplier: e.store_name || '',
      requester_name: requesterMap[e.requested_by] || '',
      total_price: parseFloat(e.amount) || 0,
      route: routeForAmount(e.amount),
      status: e.status,
      created_at: e.created_at
    }));

    const { data: vendorRows } = await supabase.from('vendors').select('id, vendor_name, category_desc, status, updated_at').order('updated_at', { ascending: false });
    const vendors = vendorRows || [];
    const activeVendors = vendors.filter(v => v.status === 'Active').length;
    const totalVendorsCount = vendors.length;

    const { data: invRows } = await supabase.from('inventory_items').select('id, name, item_type, on_hand, reorder_point, unit_of_measure');
    const inventory = invRows || [];
    let ingUnits = 0, pkgUnits = 0, eqpUnits = 0;
    inventory.forEach(r => {
      const qty = parseFloat(r.on_hand) || 0;
      if (r.item_type === 'raw_material') ingUnits += qty;
      else if (r.item_type === 'packaging') pkgUnits += qty;
      else if (r.item_type === 'equipment') eqpUnits += qty;
    });

    const lowStock = inventory
      .filter(i => (parseFloat(i.reorder_point) || 0) > 0 && (parseFloat(i.on_hand) || 0) <= (parseFloat(i.reorder_point) || 0))
      .sort((a, b) => ((parseFloat(a.on_hand) || 0) / (parseFloat(a.reorder_point) || 1)) - ((parseFloat(b.on_hand) || 0) / (parseFloat(b.reorder_point) || 1)));

    return res.json({
      status: 'success',
      user: userProfile,
      metrics: { directBuyCount, escalatedCount, itemsMonitored: inventory.length, activeVendors },
      purchaseRequests,
      vendorsList: vendors.slice(0, 5),
      vendorStats: {
        totalVendorsCount,
        activeVendors,
        activeVendorsPercent: totalVendorsCount > 0 ? Math.round((activeVendors / totalVendorsCount) * 100) : null
      },
      inventoryCategory: { ingUnits, pkgUnits, eqpUnits, totalAvailableUnits: ingUnits + pkgUnits + eqpUnits },
      attentionCount: lowStock.length,
      lowStockItems: lowStock.slice(0, 3).map(i => ({ id: i.id, name: i.name, on_hand: parseFloat(i.on_hand) || 0, unit: i.unit_of_measure || '' }))
    });
  } catch (error) {
    console.error('[procurement-officer/dashboard] error:', error.message);
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

router.post('/procurement-officer/add-request', async (req, res) => {
  try {
    if (!supabase) return noDb(res);
    const { item_name, store_name, amount } = req.body;
    const userId = req.headers['x-user-id'] || req.body?.user_id || null;

    if (!item_name || !amount || parseFloat(amount) <= 0) {
      return res.status(400).json({ status: 'error', message: 'Item name and a valid amount are required.' });
    }

    const numAmount = parseFloat(amount);
    const route = routeForAmount(numAmount);
    const tier = route === 'ceo' ? 'major' : (route === 'finance' ? 'medium' : 'micro');
    const status = route === 'ceo' ? 'PENDING_CEO' : (route === 'finance' ? 'PENDING_FINANCE' : 'APPROVED');

    const { data: inserted, error } = await supabase.from('expenses').insert([{
      item_name,
      store_name: store_name || '',
      amount: numAmount,
      tier,
      status,
      requested_by: userId || null,
      expense_date: new Date().toISOString().split('T')[0]
    }]).select('id, status').single();
    if (error) throw error;

    return res.json({
      status: 'success',
      message: 'Purchase request added successfully.',
      request: { id: inserted.id, pr_code: `PR-${1000 + inserted.id}`, status: inserted.status, route }
    });
  } catch (error) {
    console.error('[procurement-officer/add-request] error:', error.message);
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

router.post('/procurement-officer/mark-purchased', async (req, res) => {
  try {
    if (!supabase) return noDb(res);
    const { expense_id } = req.body;
    if (!expense_id) {
      return res.status(400).json({ status: 'error', message: 'Expense ID is required.' });
    }

    const { data: exp, error: findErr } = await supabase
      .from('expenses').select('id, item_name, store_name, amount, status').eq('id', expense_id).maybeSingle();
    if (findErr) throw findErr;
    if (!exp) return res.status(404).json({ status: 'error', message: 'Purchase request not found.' });

    const amount = parseFloat(exp.amount) || 0;
    if (routeForAmount(amount) !== 'procure') {
      return res.status(403).json({ status: 'error', message: 'Only requests of PHP 300 or less can be bought directly. This one needs Finance / CEO approval.' });
    }
    if (exp.status === 'PURCHASED') {
      return res.status(400).json({ status: 'error', message: 'This request is already marked as purchased.' });
    }

    const { error } = await supabase.from('expenses').update({ status: 'PURCHASED' }).eq('id', exp.id);
    if (error) throw error;

    if (exp.store_name) {
      try {
        const { data: vendor } = await supabase.from('vendors').select('id, total_spent').eq('vendor_name', exp.store_name).limit(1).maybeSingle();
        if (vendor) {
          await supabase.from('vendors').update({
            total_spent: (parseFloat(vendor.total_spent) || 0) + amount,
            updated_at: new Date().toISOString()
          }).eq('id', vendor.id);
        }
      } catch (e) {
        console.warn('[procurement-officer/mark-purchased] could not update vendor total:', e.message);
      }
    }

    return res.json({ status: 'success', message: 'Marked as purchased.' });
  } catch (error) {
    console.error('[procurement-officer/mark-purchased] error:', error.message);
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

router.get('/procurement-officer/purchasing-vendor', async (req, res) => {
  try {
    if (!supabase) return noDb(res);
    const userProfile = await getEmployeeProfile(req);

    const { data: expenseRows } = await supabase
      .from('expenses')
      .select('id, item_name, store_name, amount, status, created_at, requested_by')
      .order('created_at', { ascending: false });

    const requesterIds = [...new Set((expenseRows || []).map(e => e.requested_by).filter(Boolean))];
    let requesterMap = {};
    if (requesterIds.length) {
      const { data: requesterUsers } = await supabase.from('users').select('id, full_name').in('id', requesterIds);
      (requesterUsers || []).forEach(u => { requesterMap[u.id] = u.full_name; });
    }

    const requests = (expenseRows || []).map(e => ({
      id: e.id,
      pr_code: `PR-${1000 + e.id}`,
      name: e.item_name,
      vendor_name: e.store_name || '',
      requester_name: requesterMap[e.requested_by] || '',
      total_price: parseFloat(e.amount) || 0,
      route: routeForAmount(e.amount),
      status: e.status,
      created_at: e.created_at
    }));

    const { data: vendors, error: vErr } = await supabase.from('vendors').select('*').order('id', { ascending: false });
    if (vErr) throw vErr;

    return res.json({ status: 'success', user: userProfile, requests, vendors: vendors || [] });
  } catch (error) {
    console.error('[procurement-officer/purchasing-vendor] error:', error.message);
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

router.post('/procurement-officer/add-vendor', async (req, res) => {
  try {
    if (!supabase) return noDb(res);
    const { vendor_name, category, contact, status } = req.body;
    if (!vendor_name) {
      return res.status(400).json({ status: 'error', message: 'Vendor name is required.' });
    }

    const { error } = await supabase.from('vendors').insert([{
      vendor_name,
      category_desc: category || '',
      contact_email: contact || '',
      status: status || 'Active',
      total_spent: 0
    }]);
    if (error) throw error;

    return res.json({ status: 'success', message: 'Vendor created successfully.' });
  } catch (error) {
    console.error('[procurement-officer/add-vendor] error:', error.message);
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

router.post('/procurement-officer/edit-vendor', async (req, res) => {
  try {
    if (!supabase) return noDb(res);
    const { vendor_id, vendor_name, category, contact, status } = req.body;
    if (!vendor_id || !vendor_name) {
      return res.status(400).json({ status: 'error', message: 'Vendor ID and name are required.' });
    }

    const { error } = await supabase.from('vendors').update({
      vendor_name,
      category_desc: category || '',
      contact_email: contact || '',
      status: status || 'Active',
      updated_at: new Date().toISOString()
    }).eq('id', vendor_id);
    if (error) throw error;

    return res.json({ status: 'success', message: 'Vendor updated successfully.' });
  } catch (error) {
    console.error('[procurement-officer/edit-vendor] error:', error.message);
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

router.get('/procurement-officer/inventory-section', async (req, res) => {
  try {
    if (!supabase) return noDb(res);
    const userProfile = await getEmployeeProfile(req);

    const { data: items, error } = await supabase.from('inventory_items').select('*').order('id', { ascending: false });
    if (error) throw error;

    const { data: vendorRows } = await supabase.from('vendors').select('vendor_name').order('vendor_name', { ascending: true });
    const vendorsList = (vendorRows || []).map(v => v.vendor_name);

    const totalCount = (items || []).length;
    let ingCount = 0, pkgCount = 0, eqpCount = 0;
    (items || []).forEach(it => {
      const type = String(it.item_type || '').toLowerCase();
      if (type === 'raw_material') ingCount++;
      else if (type === 'packaging') pkgCount++;
      else if (type === 'equipment') eqpCount++;
    });

    return res.json({
      status: 'success',
      user: userProfile,
      counts: { totalCount, ingCount, pkgCount, eqpCount },
      items: items || [],
      vendors: vendorsList
    });
  } catch (error) {
    console.error('[procurement-officer/inventory-section] error:', error.message);
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

async function getEmployeeNameForLog(req) {
  const userId = req.headers['x-user-id'] || req.body?.user_id;
  if (!userId || !supabase) return 'Staff';
  const { data: user } = await supabase.from('users').select('full_name').eq('id', userId).maybeSingle();
  return (user && user.full_name) || 'Staff';
}

router.post('/procurement-officer/add-stock', async (req, res) => {
  try {
    if (!supabase) return noDb(res);
    const { name, department, quantity, unit, reorder_level } = req.body;

    if (!name || isNaN(quantity)) {
      return res.status(400).json({ status: 'error', message: 'Item name and quantity are required.' });
    }

    const numQty = parseFloat(quantity);
    const numReorder = parseFloat(reorder_level || 10);
    const dbItemType = department === 'Packaging' ? 'packaging' : (department === 'Equipment' ? 'equipment' : 'raw_material');
    const empName = await getEmployeeNameForLog(req);

    const { data: existing } = await supabase.from('inventory_items').select('id, on_hand').eq('name', name).limit(1).maybeSingle();

    let itemId;
    if (existing) {
      itemId = existing.id;
      const { error } = await supabase.from('inventory_items').update({
        on_hand: (parseFloat(existing.on_hand) || 0) + numQty,
        reorder_point: numReorder,
        unit_of_measure: unit || 'grams',
        item_type: dbItemType,
        updated_at: new Date().toISOString()
      }).eq('id', itemId);
      if (error) throw error;
    } else {
      const { data: inserted, error } = await supabase.from('inventory_items').insert([{
        name, item_type: dbItemType, on_hand: numQty, reorder_point: numReorder, unit_of_measure: unit || 'grams'
      }]).select().single();
      if (error) throw error;
      itemId = inserted.id;
    }

    await supabase.from('inventory_movement_logs').insert([{
      item_id: itemId, item_name: name, change_type: 'ADD', quantity_changed: numQty, employee_name: empName
    }]);

    return res.json({ status: 'success', message: 'Stock added successfully.' });
  } catch (error) {
    console.error('[procurement-officer/add-stock] error:', error.message);
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

router.post('/procurement-officer/adjust-stock', async (req, res) => {
  try {
    if (!supabase) return noDb(res);
    const { item_id, name, department, quantity, unit, reorder_level } = req.body;

    if (!item_id || !name || isNaN(quantity)) {
      return res.status(400).json({ status: 'error', message: 'Item ID, name, and quantity are required.' });
    }

    const numQty = parseFloat(quantity);
    const numReorder = parseFloat(reorder_level || 10);
    const dbItemType = department === 'Packaging' ? 'packaging' : (department === 'Equipment' ? 'equipment' : 'raw_material');
    const empName = await getEmployeeNameForLog(req);

    const { data: prevRow } = await supabase.from('inventory_items').select('on_hand').eq('id', item_id).maybeSingle();
    const oldQty = prevRow ? parseFloat(prevRow.on_hand) || 0 : 0;
    const diff = numQty - oldQty;
    let changeType = 'ADJUST';
    if (diff < 0) changeType = 'DEDUCT';
    else if (diff > 0) changeType = 'ADD';

    const { error } = await supabase.from('inventory_items').update({
      name, on_hand: numQty, reorder_point: numReorder, unit_of_measure: unit || 'grams', item_type: dbItemType,
      updated_at: new Date().toISOString()
    }).eq('id', item_id);
    if (error) throw error;

    await supabase.from('inventory_movement_logs').insert([{
      item_id, item_name: name, change_type: changeType, quantity_changed: Math.abs(diff), employee_name: empName
    }]);

    return res.json({ status: 'success', message: 'Stock adjusted successfully.' });
  } catch (error) {
    console.error('[procurement-officer/adjust-stock] error:', error.message);
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

router.post('/procurement-officer/delete-stock', async (req, res) => {
  try {
    if (!supabase) return noDb(res);
    const { item_id } = req.body;
    if (!item_id) {
      return res.status(400).json({ status: 'error', message: 'Item ID is required.' });
    }
    const empName = await getEmployeeNameForLog(req);

    const { data: delRow } = await supabase.from('inventory_items').select('name, on_hand').eq('id', item_id).maybeSingle();
    const { error } = await supabase.from('inventory_items').delete().eq('id', item_id);
    if (error) throw error;

    if (delRow) {
      await supabase.from('inventory_movement_logs').insert([{
        item_id, item_name: delRow.name, change_type: 'DEDUCT', quantity_changed: parseFloat(delRow.on_hand) || 0, employee_name: empName
      }]);
    }

    return res.json({ status: 'success', message: 'Stock deleted successfully.' });
  } catch (error) {
    console.error('[procurement-officer/delete-stock] error:', error.message);
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

router.get('/procurement-officer/stock-control', async (req, res) => {
  try {
    if (!supabase) return noDb(res);
    const userProfile = await getEmployeeProfile(req);

    const { data: expenseRows } = await supabase.from('expenses').select('amount, status');
    const expenses = expenseRows || [];
    const directBuyCount = expenses.filter(e => routeForAmount(e.amount) === 'procure' && e.status !== 'PURCHASED').length;
    const escalatedCount = expenses.filter(e => routeForAmount(e.amount) !== 'procure' && ['PENDING_FINANCE', 'PENDING_CEO'].includes(e.status)).length;

    const { data: itemRows } = await supabase.from('inventory_items').select('*');
    const allItems = itemRows || [];
    const unitById = {};
    allItems.forEach(i => { unitById[i.id] = i.unit_of_measure || ''; });

    const tracksReserved = allItems.some(i => Object.prototype.hasOwnProperty.call(i, 'reserved_qty'));
    const reservedStocks = tracksReserved
      ? allItems.reduce((sum, i) => sum + (parseFloat(i.reserved_qty) || 0), 0)
      : null;

    const lowStockItems = allItems
      .filter(i => (parseFloat(i.on_hand) || 0) <= (parseFloat(i.reorder_point) || 0) && (parseFloat(i.reorder_point) || 0) > 0)
      .sort((a, b) => ((parseFloat(a.on_hand) || 0) / (parseFloat(a.reorder_point) || 1)) - ((parseFloat(b.on_hand) || 0) / (parseFloat(b.reorder_point) || 1)))
      .map(i => ({
        id: i.id,
        name: i.name,
        item_type: i.item_type,
        on_hand: parseFloat(i.on_hand) || 0,
        reorder_level: parseFloat(i.reorder_point) || 0,
        unit: i.unit_of_measure || ''
      }));

    const { data: rawLogs } = await supabase
      .from('inventory_movement_logs')
      .select('id, item_id, item_name, change_type, quantity_changed, employee_name, created_at')
      .order('created_at', { ascending: false })
      .limit(50);

    const todayStr = new Date().toISOString().split('T')[0];
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    const movementLogs = (rawLogs || []).map(log => {
      const createdAt = new Date(log.created_at);
      const logDateStr = createdAt.toISOString().split('T')[0];
      const timeStr = createdAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

      let dateGroup = 'older';
      let displayTime = `${createdAt.getMonth() + 1}/${createdAt.getDate()}/${String(createdAt.getFullYear()).slice(2)} - ${timeStr}`;

      if (logDateStr === todayStr) { dateGroup = 'today'; displayTime = `Today - ${timeStr}`; }
      else if (logDateStr === yesterdayStr) { dateGroup = 'yesterday'; displayTime = `Yesterday - ${timeStr}`; }

      return { ...log, unit: unitById[log.item_id] || '', dateGroup, displayTime };
    });

    return res.json({
      status: 'success',
      user: userProfile,
      metrics: { directBuyCount, escalatedCount, itemsMonitored: allItems.length, reservedStocks },
      lowStockItems,
      movementLogs
    });
  } catch (error) {
    console.error('[procurement-officer/stock-control] error:', error.message);
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

// Production Supervisor
router.get('/production-supervisor/dashboard', async (req, res) => {
  try {
    if (!supabase) return noDb(res);
    const userProfile = await getEmployeeProfile(req);
    const todayStr = new Date().toISOString().split('T')[0];

    const { data: completedTodayRows } = await supabase
      .from('orders').select('id').eq('status', 'COMPLETED').gte('completed_at', `${todayStr}T00:00:00`);
    let finalCompleted = (completedTodayRows || []).length;
    if (finalCompleted === 0) {
      const { count: totalCompleted } = await supabase.from('orders').select('*', { count: 'exact', head: true }).eq('status', 'COMPLETED');
      finalCompleted = totalCompleted || 0;
    }

    const { count: pendingOrders } = await supabase
      .from('orders').select('*', { count: 'exact', head: true }).in('status', ['PENDING_PAYMENT', 'PAID_VERIFIED']);
    const { count: inProduction } = await supabase
      .from('orders').select('*', { count: 'exact', head: true }).eq('status', 'PREPARING');

    const { count: claimedTodayCount } = await supabase
      .from('orders').select('*', { count: 'exact', head: true })
      .in('status', ['COMPLETED', 'READY_FOR_PICKUP']).gte('placed_at', `${todayStr}T00:00:00`);
    const { count: totalTodayCount } = await supabase
      .from('orders').select('*', { count: 'exact', head: true })
      .neq('status', 'CANCELLED').gte('placed_at', `${todayStr}T00:00:00`);

    const { data: pitchRows } = await supabase
      .from('expenses')
      .select('id, item_name, amount, status, created_at')
      .order('created_at', { ascending: false })
      .limit(10);
    const restockPitches = (pitchRows || []).map(e => {
      const route = routeForAmount(e.amount);
      const routeText = route === 'ceo' ? '🔴 Escalated to CEO' : (route === 'finance' ? '🟠 Requires Finance Approval' : '🟢 Direct Buy: Procurement');
      return {
        id: e.id,
        item_name: e.item_name,
        total_cost: parseFloat(e.amount) || 0,
        status: e.status,
        route, route_text: routeText
      };
    });
    const pendingRestocks = restockPitches.filter(p => !['PURCHASED', 'REJECTED'].includes(p.status)).length;

    const { data: rawOrders } = await supabase
      .from('orders')
      .select('id, order_number, status, total_amount, placed_at, pickup_instructions, guest_name, customers(users(full_name)), order_items(item_label, quantity)')
      .neq('status', 'CANCELLED')
      .order('placed_at', { ascending: false })
      .limit(5);

    const recentOrders = (rawOrders || []).map(o => {
      const firstItem = (o.order_items && o.order_items[0]) || {};
      const cleanTitle = cleanItemLabel(firstItem.item_label, 'Marble Cup');
      const rawStatus = String(o.status || '').toUpperCase();
      let statusClass = 'pending', statusLabel = 'Pending';
      if (rawStatus === 'PREPARING') { statusClass = 'inprogress'; statusLabel = 'In Progress'; }
      else if (rawStatus === 'READY_FOR_PICKUP' || rawStatus === 'COMPLETED') {
        statusClass = 'approved';
        statusLabel = rawStatus === 'READY_FOR_PICKUP' ? 'Ready' : 'Completed';
      }

      let scheduleText = 'Standard';
      const pickupMatch = o.pickup_instructions ? o.pickup_instructions.match(/Pick-up:\s*([^|]+)/i) : null;
      if (pickupMatch) {
        scheduleText = pickupMatch[1].trim();
      } else if (o.placed_at) {
        const pDate = new Date(o.placed_at);
        scheduleText = pDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ', ' +
          pDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
      }

      return {
        id: o.id,
        order_number: o.order_number,
        status: o.status,
        total_amount: parseFloat(o.total_amount || 0),
        placed_at: o.placed_at,
        item_label: firstItem.item_label || 'Milky Marble Cup',
        quantity: firstItem.quantity || 1,
        customer_name: (o.customers && o.customers.users && o.customers.users.full_name) || o.guest_name || 'Customer',
        cleanTitle, statusClass, statusLabel, scheduleText
      };
    });

    const { data: rawSchedule } = await supabase
      .from('orders')
      .select('id, order_number, status, placed_at, pickup_instructions')
      .in('status', ['PENDING_PAYMENT', 'PAID_VERIFIED', 'PREPARING', 'READY_FOR_PICKUP'])
      .not('pickup_instructions', 'is', null)
      .order('placed_at', { ascending: false })
      .limit(5);

    const scheduleList = (rawSchedule || []).map(sch => {
      const pDate = new Date(sch.placed_at);
      let dayName = pDate.toLocaleDateString('en-US', { weekday: 'long' });
      let timeStr = pDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

      const pickupMatch = sch.pickup_instructions ? sch.pickup_instructions.match(/Pick-up:\s*([^|]+)/i) : null;
      if (pickupMatch) {
        const cleanSched = pickupMatch[1].trim();
        const dateMatch = cleanSched.match(/([0-9]{4}-[0-9]{2}-[0-9]{2})/);
        const fullMatch = cleanSched.match(/([A-Za-z]+),\s*([A-Za-z]+)\s*([0-9]+).*·\s*([0-9:]+\s*[APM]+)/i);
        if (dateMatch) { dayName = new Date(dateMatch[1]).toLocaleDateString('en-US', { weekday: 'long' }); timeStr = 'Pick-up'; }
        else if (fullMatch) { dayName = fullMatch[1]; timeStr = fullMatch[4]; }
      }

      return { ...sch, dayName, timeStr };
    });

    return res.json({
      status: 'success',
      user: userProfile,
      metrics: {
        completedToday: finalCompleted,
        pendingOrders: pendingOrders || 0,
        inProduction: inProduction || 0,
        preordersClaimedStr: `${claimedTodayCount || 0} / ${totalTodayCount || 0}`,
        pendingRestocks
      },
      recentOrders,
      restockPitches,
      scheduleList
    });
  } catch (error) {
    console.error('[production-supervisor/dashboard] error:', error.message);
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

router.get('/production-supervisor/order-list', async (req, res) => {
  try {
    if (!supabase) return noDb(res);
    const userProfile = await getEmployeeProfile(req);

    const { count: pendingCount } = await supabase
      .from('orders').select('*', { count: 'exact', head: true }).in('status', ['PENDING_PAYMENT', 'PAID_VERIFIED']);
    const { count: inProgressCount } = await supabase
      .from('orders').select('*', { count: 'exact', head: true }).eq('status', 'PREPARING');
    const { count: readyCount } = await supabase
      .from('orders').select('*', { count: 'exact', head: true }).eq('status', 'READY_FOR_PICKUP');
    const { count: completedCount } = await supabase
      .from('orders').select('*', { count: 'exact', head: true }).eq('status', 'COMPLETED');

    const { data: rawOrders } = await supabase
      .from('orders')
      .select('id, order_number, status, total_amount, placed_at, guest_name, customers(users(full_name)), order_items(item_label, quantity, size, toppings, is_custom)')
      .neq('status', 'CANCELLED')
      .order('placed_at', { ascending: false });

    const ordersList = (rawOrders || []).map(ord => {
      const firstItem = (ord.order_items && ord.order_items[0]) || {};
      const cleanTitle = cleanItemLabel(firstItem.item_label, 'Milky Marble Cup');
      const size = firstItem.size || (String(firstItem.item_label || '').toLowerCase().includes('8oz') ? '8oz' : '12oz');
      const specs = firstItem.toppings ? `Toppings: ${firstItem.toppings}` : '';
      const type = firstItem.is_custom ? 'preorder' : 'preset';

      const rawStatus = String(ord.status || '').toUpperCase();
      let statusClass = 'pending', statusLabel = 'Pending';
      if (rawStatus === 'PREPARING') { statusClass = 'inprogress'; statusLabel = 'In Progress'; }
      else if (rawStatus === 'COMPLETED' || rawStatus === 'READY_FOR_PICKUP') {
        statusClass = 'complete';
        statusLabel = rawStatus === 'READY_FOR_PICKUP' ? 'Ready' : 'Complete';
      }

      return {
        id: ord.id,
        order_number: ord.order_number,
        status: ord.status,
        total_amount: parseFloat(ord.total_amount || 0),
        placed_at: ord.placed_at,
        item_label: firstItem.item_label || 'Custom Marble Cup',
        quantity: firstItem.quantity || 1,
        customer_name: (ord.customers && ord.customers.users && ord.customers.users.full_name) || ord.guest_name || 'Customer',
        cleanTitle, size, specs, type, statusClass, statusLabel,
        claim_slot: '', shelf_tag: ''
      };
    });

    const presetCards = [];

    return res.json({
      status: 'success',
      user: userProfile,
      kpis: {
        pendingCount: pendingCount || 0,
        inProgressCount: inProgressCount || 0,
        readyCount: readyCount || 0,
        completedCount: completedCount || 0
      },
      ordersList,
      presetCards
    });
  } catch (error) {
    console.error('[production-supervisor/order-list] error:', error.message);
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

router.get('/production-supervisor/order-production', async (req, res) => {
  try {
    if (!supabase) return noDb(res);
    const userProfile = await getEmployeeProfile(req);
    let requestedOrderId = parseInt(req.query.order_id || '0', 10);

    if (requestedOrderId <= 0) {
      const { data: fallback } = await supabase
        .from('orders').select('id')
        .in('status', ['PREPARING', 'PAID_VERIFIED', 'PENDING_PAYMENT'])
        .order('placed_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (fallback && fallback.id) requestedOrderId = fallback.id;
    }

    let orderData = null;

    if (requestedOrderId > 0) {
      const { data: order } = await supabase
        .from('orders')
        .select('id, order_number, status, pickup_instructions, guest_name, customers(users(full_name)), order_items(item_label, quantity, size, toppings, is_custom)')
        .eq('id', requestedOrderId)
        .maybeSingle();

      if (order) {
        const firstItem = (order.order_items && order.order_items[0]) || {};
        const itemLabel = firstItem.item_label || 'Milky Marble Cup';

        let claimSlot = '';
        const pickupMatch = order.pickup_instructions ? order.pickup_instructions.match(/Pick-up:\s*([^|]+)/i) : null;
        if (pickupMatch) claimSlot = pickupMatch[1].trim();

        orderData = {
          id: order.id,
          orderCode: order.order_number || `MM-${order.id}`,
          orderClient: (order.customers && order.customers.users && order.customers.users.full_name) || order.guest_name || 'Customer',
          orderStatus: (order.status || '').toUpperCase(),
          orderType: firstItem.is_custom ? 'Pre-Order' : 'Walk-in Preset',
          itemLabel,
          quantity: firstItem.quantity || 1,
          cupSize: firstItem.size || '',
          toppings: firstItem.toppings ? firstItem.toppings.split(',').map(t => t.trim()).filter(Boolean) : [],
          claimSlot
        };
      }
    }

    if (!orderData) {
      return res.status(404).json({ status: 'error', message: 'No order found to display.' });
    }

    const { data: invRows } = await supabase.from('inventory_items').select('*').order('id', { ascending: true });
    let materials;
    if (invRows && invRows.length > 0) {
      materials = invRows.map(inv => ({
        id: inv.id,
        name: inv.name,
        amount: parseFloat(inv.on_hand || 0),
        step: inv.unit_of_measure === 'pcs' ? 1 : 0.5,
        min: 0, max: 9999,
        unit: inv.unit_of_measure
      }));
    } else {
      materials = [];
    }

    return res.json({ status: 'success', user: userProfile, order: orderData, materials });
  } catch (error) {
    console.error('[production-supervisor/order-production] error:', error.message);
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

// Awtomatikong magbawas ng grams at packaging kapag naging ready for pickup sa kusina
router.post('/production-supervisor/complete-order', async (req, res) => {
  try {
    if (!supabase) return noDb(res);
    const { order_id } = req.body;
    if (!order_id) {
      return res.status(400).json({ status: 'error', message: 'Order ID is required.' });
    }

    const { error } = await supabase
      .from('orders')
      .update({ status: 'READY_FOR_PICKUP', completed_at: new Date().toISOString() })
      .eq('id', order_id);
    if (error) throw error;

    const empName = await getEmployeeProfile(req);
    await deductInventoryForOrder(order_id, empName.fullName || 'Production Kitchen');

    return res.json({ status: 'success', message: 'Order marked ready for pickup and ingredients deducted.' });
  } catch (error) {
    console.error('[production-supervisor/complete-order] error:', error.message);
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

// Kusina: Magluluto ng Raw Packs -> Magiging Grams sa Chiller
router.post('/production-supervisor/cook-batch', async (req, res) => {
  try {
    if (!supabase) return noDb(res);
    const { batch_type, raw_quantity } = req.body; 
    const numQty = parseFloat(raw_quantity);

    if (!batch_type || isNaN(numQty) || numQty <= 0) {
      return res.status(400).json({ status: 'error', message: 'Valid batch_type and quantity required.' });
    }

    const conversion = BATCH_YIELD_CONVERSIONS[batch_type.toLowerCase()];
    if (!conversion) {
      return res.status(400).json({ status: 'error', message: 'Invalid batch type.' });
    }

    const cookedGramsProduced = batch_type.toLowerCase() === 'gulaman' 
      ? Math.round(numQty * conversion.gramsPerPack)
      : Math.round(numQty * conversion.gramsPerBag);

    const empProfile = await getEmployeeProfile(req);
    const staffName = empProfile.fullName || 'Kitchen Staff';

    const { data: rawItem } = await supabase
      .from('inventory_items')
      .select('id, on_hand, name')
      .ilike('name', `%${conversion.rawItemName}%`)
      .limit(1)
      .maybeSingle();

    if (rawItem) {
      const remainingRaw = Math.max(0, (parseFloat(rawItem.on_hand) || 0) - numQty);
      await supabase
        .from('inventory_items')
        .update({ on_hand: remainingRaw })
        .eq('id', rawItem.id);

      await supabase.from('inventory_movement_logs').insert([{
        item_id: rawItem.id,
        item_name: rawItem.name,
        change_type: 'DEDUCT',
        quantity_changed: numQty,
        employee_name: staffName
      }]);
    }

    const { data: cookedItem } = await supabase
      .from('inventory_items')
      .select('id, on_hand, name')
      .ilike('name', `%${conversion.cookedItemName}%`)
      .limit(1)
      .maybeSingle();

    let cookedItemId = cookedItem?.id;
    if (cookedItem) {
      await supabase
        .from('inventory_items')
        .update({ on_hand: (parseFloat(cookedItem.on_hand) || 0) + cookedGramsProduced })
        .eq('id', cookedItem.id);
    } else {
      const { data: newCooked } = await supabase.from('inventory_items').insert([{
        name: conversion.cookedItemName,
        item_type: 'raw_material',
        unit_of_measure: 'grams',
        on_hand: cookedGramsProduced,
        reorder_point: 500
      }]).select().single();
      cookedItemId = newCooked?.id;
    }

    await supabase.from('inventory_movement_logs').insert([{
      item_id: cookedItemId,
      item_name: conversion.cookedItemName,
      change_type: 'ADD',
      quantity_changed: cookedGramsProduced,
      employee_name: staffName
    }]);

    return res.json({
      status: 'success',
      message: `Batch cooked successfully: -${numQty} raw deducted, +${cookedGramsProduced}g cooked base ready.`,
      gramsProduced: cookedGramsProduced
    });

  } catch (error) {
    console.error('[cook-batch error]:', error.message);
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

// Production planning
router.get('/production-supervisor/production-planning', async (req, res) => {
  try {
    if (!supabase) return noDb(res);
    const userProfile = await getEmployeeProfile(req);

    const todayStr = new Date().toISOString().split('T')[0];
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];

    let recipesList = [];
    try {
      const { data: rRows, error: rErr } = await supabase.from('recipes').select('id, flavor_name, yield_servings').order('flavor_name', { ascending: true });
      if (!rErr) recipesList = rRows || [];
    } catch {}

    const { data: todayPlans } = await supabase.from('production_orders').select('*').eq('due_date', todayStr).order('schedule_time', { ascending: true });
    const { data: tomorrowPlans } = await supabase.from('production_orders').select('*').eq('due_date', tomorrowStr).order('schedule_time', { ascending: true });
    const { data: allPlans } = await supabase.from('production_orders').select('*').order('due_date', { ascending: false }).order('schedule_time', { ascending: true });

    const curr = new Date();
    const first = curr.getDate() - curr.getDay() + 1;
    const monday = new Date(curr);
    monday.setDate(first);
    const sunday = new Date(curr);
    sunday.setDate(first + 6);
    const mText = monday.toLocaleDateString('en-US', { day: '2-digit', month: 'short' });
    const sText = sunday.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' });
    const dateRangeText = `${mText} — ${sText}`;

    return res.json({
      status: 'success',
      user: userProfile,
      dateRangeText,
      recipesList,
      todayPlans: todayPlans || [],
      tomorrowPlans: tomorrowPlans || [],
      allPlans: allPlans || []
    });
  } catch (error) {
    console.error('[production-supervisor/production-planning] error:', error.message);
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

router.post('/production-supervisor/add-plan', async (req, res) => {
  try {
    if (!supabase) return noDb(res);
    const { operation, due_date, schedule_time, status, target_liters } = req.body;
    if (!operation || !due_date || !schedule_time) {
      return res.status(400).json({ status: 'error', message: 'Operation name, due date, and schedule time are required.' });
    }

    const { count: totalCount } = await supabase.from('production_orders').select('*', { count: 'exact', head: true });
    const nextCode = 'MM-' + (24080 + (totalCount || 0) + 1);
    const numTargetLiters = target_liters !== undefined && target_liters !== '' ? parseFloat(target_liters) : null;

    const { error } = await supabase.from('production_orders').insert([{
      order_code: nextCode, operation, target_liters: numTargetLiters, due_date, schedule_time, status: status || 'PENDING'
    }]);
    if (error) throw error;

    return res.json({ status: 'success', message: 'Production plan created successfully.' });
  } catch (error) {
    console.error('[production-supervisor/add-plan] error:', error.message);
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

router.post('/production-supervisor/edit-plan', async (req, res) => {
  try {
    if (!supabase) return noDb(res);
    const { plan_id, operation, due_date, schedule_time, status } = req.body;
    if (!plan_id || !operation) {
      return res.status(400).json({ status: 'error', message: 'Plan ID and operation name are required.' });
    }

    const { error } = await supabase.from('production_orders').update({
      operation, due_date, schedule_time, status: status || 'PENDING'
    }).eq('id', plan_id);
    if (error) throw error;

    return res.json({ status: 'success', message: 'Production plan updated successfully.' });
  } catch (error) {
    console.error('[production-supervisor/edit-plan] error:', error.message);
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

module.exports = router;