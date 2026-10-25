// src/utils/orderNumber.js
// Order numbers used to be `MM-` + the last 6 digits of Date.now(), which
// repeats about every 17 minutes and nothing stopped two orders sharing one.
//
// Now: a random 8-digit number (100 million possibilities), and the database
// has the final say. orders.order_number has a UNIQUE constraint (see
// supabase/order_number_unique.sql). If an insert is ever rejected because the
// number is taken, we simply pick a new number and try again, so a duplicate can
// never be saved. Do NOT drop the constraint: it is what makes this safe.
const crypto = require('crypto');

function generateOrderNumber(prefix = 'MM') {
  const n = crypto.randomInt(10000000, 100000000); // 8 digits, never starts with 0
  return `${prefix}-${n}`;
}

// Postgres unique_violation is 23505. Only retry when it was the order number
// that clashed, not some other unique column.
function isOrderNumberConflict(err) {
  if (!err) return false;
  const text = `${err.message || ''} ${err.details || ''}`.toLowerCase();
  return err.code === '23505' && text.includes('order_number');
}

// Inserts into `orders`, assigning a fresh order_number each attempt.
// Returns the same { data, error } shape as a normal supabase call.
async function insertOrderWithUniqueNumber(supabase, payload, { prefix = 'MM', maxAttempts = 5 } = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const { data, error } = await supabase
      .from('orders')
      .insert([{ ...payload, order_number: generateOrderNumber(prefix) }])
      .select()
      .single();

    if (!error && data) return { data, error: null };
    lastError = error;
    if (!isOrderNumberConflict(error)) break; // a different failure: retrying won't help
    console.warn(`[orders] order_number collision (attempt ${attempt}/${maxAttempts}), retrying.`);
  }
  return { data: null, error: lastError };
}

module.exports = { generateOrderNumber, isOrderNumberConflict, insertOrderWithUniqueNumber };
