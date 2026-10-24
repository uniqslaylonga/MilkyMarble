#!/usr/bin/env node
/**
 * Milky Marble - CSD Fair 2026 event data importer (Oct 8-10, 2026)
 *
 * Loads the data from "Milky Marble - Final" (the 3-day event report) into the
 * system's Supabase database WITHOUT creating duplicates:
 *
 *   - Every record is looked up first (orders by order_number, expenses by
 *     item + date, Z-reports by code, drawer counts by period end, etc.).
 *   - Not found  -> inserted.
 *   - Found      -> only the EMPTY fields are filled in. Values that are already
 *                   in the database are left alone. (Use --overwrite to force the
 *                   report's values over existing ones.)
 *   - Running the script again is safe: the second run changes nothing.
 *
 * Usage (from the project root, same folder as server.js):
 *   node scripts/importEventData.js --dry-run     # preview only, writes nothing
 *   node scripts/importEventData.js               # import / fill missing data
 *   node scripts/importEventData.js --overwrite   # also replace existing values
 *
 * Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local (or .env).
 * The anon key usually cannot write because of Row Level Security.
 */
const fs = require('fs');
const path = require('path');

const DATA = require('./eventData.json');

// ---------------------------------------------------------------- static data
const EVENT = {
  name: 'CSD Fair 2026',
  store_name: 'Sari-sari stores, Bayan, Novaliches',
  purchase_date: '2026-10-05',
  days: { 1: '2026-10-08', 2: '2026-10-09', 3: '2026-10-10' }
};

// Expense Register E-01 .. E-16 (all bought Oct 5, 2026 by the Procurement Officer)
const EXPENSES = [
  ['E-01', 'Gulaman Buko Pandan',      '1 box (10 pcs)', 160.00, 160.00],
  ['E-02', 'Gulaman Coffee Jelly',     '1 box (10 pcs)', 160.00, 160.00],
  ['E-03', 'Gulaman Strawberry',       '1 box (10 pcs)', 160.00, 160.00],
  ['E-04', 'Sprinkles, assorted',      '1/4 kg',          50.00,  50.00],
  ['E-05', 'Sprinkles, chocolate',     '1/4 kg',          50.00,  50.00],
  ['E-06', 'Doreen (milk)',            '4 kg',           108.50, 434.00],
  ['E-07', 'Nescafe sticks',           '48 pcs (pack)',  131.00, 131.00],
  ['E-08', 'Nuts',                     '2 packs',         25.00,  50.00],
  ['E-09', 'Sugar',                    '1/2 kg',          38.00,  38.00],
  ['E-10', 'Tapioca',                  '1 kg',            60.00,  60.00],
  ['E-11', 'Mallows',                  '1 kg',           130.00, 130.00],
  ['E-12', 'Chocolate chips',          '250 g',           45.00,  45.00],
  ['E-13', 'Straws',                   '200 pcs',          0.50, 100.00],
  ['E-14', 'Spoons',                   '100 pcs',          0.58,  58.00],
  ['E-15', 'Cups with lids, 8oz',      '50 pcs',           1.00,  50.00],
  ['E-16', 'Cups with lids, 12oz',     '150 pcs',          1.00, 150.00]
].map(([code, item_name, qty, unit, total]) => ({
  code, item_name, qty, unit, total,
  category: code <= 'E-12' ? 'Product purchase' : 'Packaging'
}));

// Cash and E-wallet Reconciliation (Section 6) + Z-readings
const DAILY = [
  { day: 1, cash: 949,  counted: 949,  ewallet: 250, close: '15:00:00' },
  { day: 2, cash: 0,    counted: 0,    ewallet: 277, close: '23:59:59' },
  { day: 3, cash: 1624, counted: 1624, ewallet: 0,   close: '15:00:00' }
];

// ------------------------------------------------------------------- helpers
const isMissing = v => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
const round2 = n => Math.round(n * 100) / 100;

function makeReporter() {
  const stats = {};
  const warnings = new Set();
  const bump = (table, key) => {
    stats[table] = stats[table] || { inserted: 0, filled: 0, unchanged: 0, failed: 0 };
    stats[table][key]++;
  };
  return { stats, warnings, bump };
}

async function run(supabase, opts = {}) {
  const dryRun = !!opts.dryRun;
  const overwrite = !!opts.overwrite;
  const log = opts.log || console.log;
  const { stats, warnings, bump } = makeReporter();

  // Drop columns that do not exist in this database and retry, so a column
  // that is not in your schema never blocks the rest of the row.
  async function withColumnRetry(table, payload, exec) {
    const body = { ...payload };
    for (let i = 0; i < 12; i++) {
      const res = await exec(body);
      if (!res.error) return res;
      const m = /Could not find the '([^']+)' column/.exec(res.error.message || '');
      if (res.error.code === 'PGRST204' && m && m[1] in body) {
        warnings.add(`${table}.${m[1]} does not exist in your database - skipped`);
        delete body[m[1]];
        continue;
      }
      return res;
    }
    return { error: { message: 'too many missing columns' } };
  }

  /**
   * Insert the row if it does not exist, otherwise fill its empty fields.
   * `find(query)` narrows `select('*')` to the matching record.
   */
  async function upsertRow(table, find, row, { zeroIsMissing = [] } = {}) {
    const { data: found, error: findErr } = await find(supabase.from(table).select('*')).limit(1);
    if (findErr) { bump(table, 'failed'); log(`  ! ${table}: lookup failed: ${findErr.message}`); return null; }
    const existing = found && found[0];

    if (!existing) {
      if (dryRun) { bump(table, 'inserted'); return { id: null, _new: true }; }
      const res = await withColumnRetry(table, row, body => supabase.from(table).insert([body]).select().single());
      if (res.error) { bump(table, 'failed'); log(`  ! ${table}: insert failed: ${res.error.message}`); return null; }
      bump(table, 'inserted');
      return res.data;
    }

    const patch = {};
    for (const [k, v] of Object.entries(row)) {
      if (isMissing(v) || !(k in existing)) continue;           // nothing to write / column absent
      const cur = existing[k];
      const empty = isMissing(cur) || (zeroIsMissing.includes(k) && Number(cur) === 0);
      if ((overwrite || empty) && String(cur) !== String(v)) {
        // timestamps/dates: compare by instant so formats don't cause fake diffs
        if (/(_at|_start|_end)$/.test(k) && cur && new Date(cur).getTime() === new Date(v).getTime()) continue;
        patch[k] = v;
      }
    }
    if (!Object.keys(patch).length) { bump(table, 'unchanged'); return existing; }
    if (dryRun) { bump(table, 'filled'); return existing; }
    const res = await withColumnRetry(table, patch, body => supabase.from(table).update(body).eq('id', existing.id));
    if (res.error) { bump(table, 'failed'); log(`  ! ${table}: update failed: ${res.error.message}`); return existing; }
    bump(table, 'filled');
    return { ...existing, ...patch };
  }

  async function userId(namePart) {
    const { data } = await supabase.from('users').select('id, full_name').ilike('full_name', `%${namePart}%`).limit(1);
    return (data && data[0] && data[0].id) || null;
  }

  // ------------------------------------------------------------------ lookups
  const reconByOrder = {};
  DATA.recon.filter(r => r.method === 'E-wallet').forEach(r => { reconByOrder[r.order_id] = r; });
  const financeId = await userId('Reyes');            // Kerstin E. Reyes - Finance Officer
  const procurementId = await userId('Leodones');     // Rhodalyn D. Leodones - Procurement
  log(`Users found: finance=${financeId ? 'yes' : 'no (left blank)'}, procurement=${procurementId ? 'yes' : 'no (left blank)'}`);

  // ------------------------------------------------- 1) orders + order_items
  log(`\n[1/6] Orders & order items (${DATA.orders.length} orders)`);
  async function importOrder(o) {
    const isEw = o.method === 'ewallet';
    const pickup = EVENT.days[o.day];
    const paymentMethod = isEw ? 'E-Wallet' : (o.pos ? 'Cash on Counter' : 'Cash on Pick-Up');
    const rec = isEw ? reconByOrder[o.order_number] : null;
    const digits = o.order_number.replace(/\D/g, '');

    const row = {
      order_number: o.order_number,
      order_type: 'preset',
      status: 'COMPLETED',
      subtotal: o.total,
      discount_amount: 0,
      total_amount: o.total,
      payment_method: paymentMethod,
      transaction_id: isEw ? rec.ref : `CASH-${o.placed_at.slice(0, 10).replace(/-/g, '')}-${digits}`,
      pickup_date: pickup,
      pickup_instructions: `Pick-up: ${pickup} | Payment: ${paymentMethod}`,
      guest_name: o.pos ? 'Walk-in Counter' : 'Online Customer',   // names are protected in the report
      placed_at: o.placed_at,
      completed_at: (isEw && o.day === 3) ? `${pickup}T10:00:00+08:00` : o.placed_at
    };
    if (isEw) {
      row.payment_reference = rec.ref;
      row.payment_amount = o.total;
      row.payment_submitted_at = rec.ts;
      row.payment_verified_at = rec.ts;
    }

    const order = await upsertRow('orders', q => q.eq('order_number', o.order_number), row);
    if (!order) return;

    // One cup line per order. If the order already has a line, fill it - never add a second.
    const itemRow = {
      order_id: order.id,
      item_label: o.item_label,
      quantity: 1,
      size: o.size,
      unit_price: o.total,
      line_total: o.total,
      is_custom: false,
      toppings: o.topping ? `${o.topping} (+PHP ${o.topping_price})` : null
    };
    if (order._new && order.id === null) { bump('order_items', 'inserted'); return; }   // dry-run, new order
    await upsertRow('order_items', q => q.eq('order_id', order.id), itemRow);
  }
  for (let i = 0; i < DATA.orders.length; i += 6) {
    await Promise.all(DATA.orders.slice(i, i + 6).map(importOrder));
  }

  // ---------------------------------------------------- 2) shift Z-readings
  log('\n[2/6] Z-readings (one per event day)');
  for (const d of DAILY) {
    await upsertRow('shift_z_reports', q => q.eq('z_report_code', `Z-CSD2026-DAY${d.day}`), {
      z_report_code: `Z-CSD2026-DAY${d.day}`,
      cashier_name: 'Reeze Laureen A. Alapide',
      expected_cash: d.cash,
      actual_cash: d.counted,
      variance: round2(d.counted - d.cash),
      digital_inflow: d.ewallet,
      status: 'RECONCILED',
      notes: `CSD Fair 2026 Day ${d.day} (${EVENT.days[d.day]}). Cash PHP ${d.cash.toFixed(2)}, e-wallet (Maribank) PHP ${d.ewallet.toFixed(2)}. Difference PHP 0.00.`
    });
  }

  // ------------------------------------------- 3) cash drawer reconciliations
  log('\n[3/6] Cash drawer reconciliations');
  for (const d of DAILY) {
    const periodEnd = `${EVENT.days[d.day]}T${d.close}+08:00`;
    await upsertRow('drawer_reconciliations', q => q.eq('period_end', periodEnd), {
      counted_amount: d.counted,
      expected_amount: d.cash,
      variance: round2(d.counted - d.cash),
      period_start: `${EVENT.days[d.day]}T00:00:00+08:00`,
      period_end: periodEnd,
      notes: `CSD Fair 2026 Day ${d.day} | E-Wallet/QR Ph: PHP ${d.ewallet.toFixed(2)} | Walk-in Cash: PHP ${d.cash.toFixed(2)} | Checked by Kerstin E. Reyes, no discrepancy`,
      recorded_by: financeId
    }, { zeroIsMissing: [] });
  }

  // ------------------------------------------------------ 4) budget / capital
  log('\n[4/6] Capital (budget cycle)');
  const spent = round2(EXPENSES.reduce((s, e) => s + e.total, 0));       // 1,826.00
  await upsertRow('budget_cycles', q => q.eq('cycle_name', EVENT.name), {
    cycle_name: EVENT.name,
    allocation_date: EVENT.purchase_date,
    capital: 2100,                                // 7 members x PHP 300, received Oct 5, 2026
    raw_material: spent,                          // supplies purchased
    petty_cash_fund: round2(2100 - spent),        // PHP 274 unspent
    emergency_funds: 0,
    manpower_cost: 0,
    status: 'RECONCILED',
    created_by: financeId
  }, { zeroIsMissing: ['capital', 'raw_material', 'petty_cash_fund'] });

  // ---------------------------------------------------------- 5) expenses
  log(`\n[5/6] Expenses (${EXPENSES.length} purchases, total PHP ${spent.toFixed(2)})`);
  for (const e of EXPENSES) {
    await upsertRow('expenses', q => q.eq('item_name', e.item_name).eq('expense_date', EVENT.purchase_date), {
      item_name: e.item_name,
      store_name: EVENT.store_name,
      amount: e.total,
      tier: e.total > 500 ? 'major' : (e.total > 300 ? 'medium' : 'micro'),
      status: 'RECEIVED',
      category: 'cogs',
      requested_by: procurementId,
      expense_date: EVENT.purchase_date,
      notes: `${e.code} | ${e.category} | Qty ${e.qty} @ PHP ${e.unit.toFixed(2)} | Purchase list P-01, no official receipt`
    });
  }

  // ----------------------------------------------------------- 6) vendor
  log('\n[6/6] Vendor');
  await upsertRow('vendors', q => q.eq('vendor_name', EVENT.store_name), {
    vendor_name: EVENT.store_name,
    category_desc: 'Ingredients and packaging (sari-sari stores)',
    contact_email: '',
    status: 'Active',
    total_spent: spent
  }, { zeroIsMissing: ['total_spent'] });

  // ------------------------------------------------------------- summary
  log('\n==== ' + (dryRun ? 'DRY RUN - nothing was written' : 'DONE') + ' ====');
  log('table'.padEnd(26) + 'inserted  filled  unchanged  failed');
  for (const [t, s] of Object.entries(stats)) {
    log(t.padEnd(26) + String(s.inserted).padEnd(10) + String(s.filled).padEnd(8) + String(s.unchanged).padEnd(11) + s.failed);
  }
  if (warnings.size) { log('\nNotes:'); warnings.forEach(w => log('  - ' + w)); }

  // Verify against the report (orders only, read-only)
  if (!dryRun) {
    const nums = DATA.orders.map(o => o.order_number);
    let count = 0, total = 0, cash = 0, ew = 0;
    for (let i = 0; i < nums.length; i += 80) {
      const { data } = await supabase.from('orders').select('order_number, total_amount, payment_method').in('order_number', nums.slice(i, i + 80));
      (data || []).forEach(r => {
        count++; const a = Number(r.total_amount) || 0; total += a;
        if (/cash/i.test(r.payment_method || '')) cash += a; else ew += a;
      });
    }
    log(`\nCheck vs report -> orders ${count}/168, total PHP ${total.toFixed(2)}/3100.00, cash ${cash.toFixed(2)}/2573.00, e-wallet ${ew.toFixed(2)}/527.00`);
  }
  return { stats, warnings: [...warnings] };
}

module.exports = { run };

// ------------------------------------------------------------------ CLI
if (require.main === module) {
  const dotenv = require('dotenv');
  for (const f of ['.env.local', '.env']) {
    const p = path.join(__dirname, '..', f);
    if (fs.existsSync(p)) dotenv.config({ path: p });
  }
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) { console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local'); process.exit(1); }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.warn('Warning: SUPABASE_SERVICE_ROLE_KEY is not set. The anon key will probably be blocked by Row Level Security.\n');
  }
  const { createClient } = require('@supabase/supabase-js');
  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const argv = process.argv.slice(2);
  run(supabase, { dryRun: argv.includes('--dry-run'), overwrite: argv.includes('--overwrite') })
    .catch(e => { console.error(e); process.exit(1); });
}
