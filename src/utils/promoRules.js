// src/utils/promoRules.js
// Special rules for individual promo codes (on top of the generic
// promotions table). SWEETSIP10 is the welcome code from the signup email.
const PROMO_RULES = {
  SWEETSIP10: { minItems: 2, oneTimeUse: true }
};

function getPromoRule(code) {
  return PROMO_RULES[String(code || '').trim().toUpperCase()] || null;
}

// Total number of items (sum of quantities) in a cart / order.
function countItems(items) {
  if (!Array.isArray(items)) return 0;
  return items.reduce((n, it) => n + Math.max(1, parseInt(it.quantity || 1, 10) || 1), 0);
}

// Has this customer / guest email already used this code on a non-cancelled order?
// Requires the orders.promo_code column (see supabase/promo_one_time_use.sql).
async function hasUsedPromo(supabase, code, { customerId, email }) {
  const upper = String(code).trim().toUpperCase();
  const filters = [];
  if (customerId) filters.push(`customer_id.eq.${parseInt(customerId, 10)}`);
  if (email) filters.push(`guest_email.ilike.${String(email).trim().replace(/[,()]/g, '')}`);
  if (!filters.length) return false;

  const { data, error } = await supabase
    .from('orders')
    .select('id')
    .eq('promo_code', upper)
    .neq('status', 'CANCELLED')
    .or(filters.join(','))
    .limit(1);

  if (error) {
    console.error('[promo] redemption lookup failed:', error.message);
    // Fail closed for one-time codes so a DB hiccup can't allow reuse.
    return true;
  }
  return !!(data && data.length);
}

// Returns null if OK, otherwise an error message string.
async function checkPromoEligibility(supabase, code, { itemCount, customerId, email }) {
  const rule = getPromoRule(code);
  if (!rule) return null;

  if (rule.minItems && itemCount < rule.minItems) {
    return `${String(code).toUpperCase()} is valid only when you order at least ${rule.minItems} items (this order has ${itemCount}).`;
  }
  if (rule.oneTimeUse && (customerId || email)) {
    if (await hasUsedPromo(supabase, code, { customerId, email })) {
      return `${String(code).toUpperCase()} is one-time use and has already been redeemed.`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Promotions table rules (shared by /api/promotions/validate and order creation
// so the checkout screen and the real order can never disagree).
// ---------------------------------------------------------------------------

// Only these statuses can be redeemed. PENDING_APPROVAL / REJECTED / EXPIRED /
// PROPOSED never are - a promo is live only after the CEO approves it.
const REDEEMABLE_STATUSES = ['ACTIVE', 'APPROVED'];

// Validity dates are calendar days in Philippine time (UTC+8): a promo that
// "ends 2026-11-30" works until 11:59 PM that day, wherever the server runs.
const PH_OFFSET = '+08:00';
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

// Turns the pitch form's two dates into timestamps. validUntil is required,
// validFrom is optional (blank = starts immediately).
function parsePromoWindow(validFrom, validUntil, now = new Date()) {
  if (!validUntil || !DAY_RE.test(String(validUntil))) {
    return { error: 'Please choose the last day this promo is valid.' };
  }
  const until = new Date(`${validUntil}T23:59:59.999${PH_OFFSET}`);
  if (isNaN(until.getTime())) return { error: 'The end date is not a valid date.' };

  let from = now;
  if (validFrom) {
    if (!DAY_RE.test(String(validFrom))) return { error: 'The start date is not a valid date.' };
    from = new Date(`${validFrom}T00:00:00.000${PH_OFFSET}`);
    if (isNaN(from.getTime())) return { error: 'The start date is not a valid date.' };
  }
  if (until < now) return { error: 'The end date cannot be in the past.' };
  if (until < from) return { error: 'The end date must be on or after the start date.' };
  return { from, until };
}

// Rows from before validity dates existed have both columns empty; they stay
// open-ended instead of suddenly expiring.
function isWithinWindow(promo, now = new Date()) {
  const from = promo.valid_from ? new Date(promo.valid_from) : null;
  const until = promo.valid_until ? new Date(promo.valid_until) : null;
  if (from && from > now) return false;
  if (until && until < now) return false;
  return true;
}

function computePromoDiscount(promo, subtotal) {
  const sub = Math.max(0, parseFloat(subtotal) || 0);
  const val = parseFloat(promo.discount_value) || 0;
  const type = String(promo.discount_type || '').toLowerCase();
  const raw = (type === 'percent' || type === 'percentage') ? sub * (val / 100) : Math.min(val, sub);
  return Math.round(Math.min(raw, sub) * 100) / 100;
}

// Looks a code up and answers: is it redeemable RIGHT NOW?
// -> { promo } or { error, httpStatus }
async function getRedeemablePromo(supabase, code, now = new Date()) {
  const clean = String(code || '').trim();
  if (!clean) return { error: 'Promo code is required.', httpStatus: 400 };
  // Letters/digits/_/- only, so the code can't smuggle wildcard characters into the lookup.
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(clean)) return { error: 'Invalid promo code.', httpStatus: 404 };

  const { data, error } = await supabase
    .from('promotions')
    .select('*')
    .ilike('code', clean)
    .limit(10);
  if (error) {
    console.error('[promo] lookup failed:', error.message);
    return { error: 'Could not verify the promo code right now.', httpStatus: 503 };
  }

  // ilike treats "_" as a wildcard, so keep exact matches only.
  const rows = (data || []).filter(r => String(r.code || '').toUpperCase() === clean.toUpperCase());
  if (!rows.length) return { error: 'Invalid promo code.', httpStatus: 404 };

  const live = rows.filter(r => REDEEMABLE_STATUSES.includes(String(r.status || '').toUpperCase()));
  if (!live.length) return { error: 'This promo code is no longer active.', httpStatus: 400 };

  const valid = live.find(r => isWithinWindow(r, now));
  if (!valid) return { error: 'This promo code is not valid today.', httpStatus: 400 };

  return { promo: valid };
}

module.exports = {
  getPromoRule, countItems, hasUsedPromo, checkPromoEligibility,
  REDEEMABLE_STATUSES, parsePromoWindow, isWithinWindow, computePromoDiscount, getRedeemablePromo
};
