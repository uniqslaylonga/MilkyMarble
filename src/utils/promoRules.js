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
    return `${String(code).toUpperCase()} is valid only when you order at least ${rule.minItems} items.`;
  }
  if (rule.oneTimeUse && (customerId || email)) {
    if (await hasUsedPromo(supabase, code, { customerId, email })) {
      return `${String(code).toUpperCase()} is one-time use and has already been redeemed.`;
    }
  }
  return null;
}

module.exports = { getPromoRule, countItems, hasUsedPromo, checkPromoEligibility };