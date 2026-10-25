// src/utils/orderPricing.js
// The server works out what an order costs. The browser's subtotal, unit_price
// and price fields are NEVER trusted: anyone can edit the request and pay less.
//
// Keep these numbers in step with public/customer/js/home.js
// (calculateCustomTotal, TOPPING_PRICES, PRESET_SIGNATURES).
//
// Everything is calculated in whole centavos so there is no floating-point drift.

const BASE_PRICE_CENTS = {
  '8oz': 1500,   // ₱15.00
  '12oz': 1900   // ₱19.00
};

// Price of ONE extra add-on portion (centavos). Keys are lower-case.
const ADDON_PRICE_CENTS = {
  'cheese': 200,
  'tapioca': 200,
  'marshmallow': 200,
  'nuts': 200,
  'assorted sprinkles': 200,
  'choco sprinkles': 200,
  'choco chips': 500,
  'condensed milk': 500
};
// Same fallback the customer page uses for a name it doesn't know.
const DEFAULT_ADDON_PRICE_CENTS = 200;

const MAX_QTY_PER_ITEM = 99;
const MAX_ADDON_QTY = 20;
const MAX_ITEMS_PER_ORDER = 50;

class OrderPricingError extends Error {}

// "Extra Cheese (x2), Extra Choco Chips (x1)"  ->  [{ name: 'cheese', qty: 2 }, ...]
// Add-ons reach the server in two shapes, and both are read here:
//   - "Order now" sends them in item.addons ("+ Extra Cheese (x2) + With Spoon")
//   - the cart merges them into item.toppings ("Nuts (Extra Cheese (x2))")
// Free text such as "With Spoon" or the preset's included toppings is ignored.
function parseAddons(...texts) {
  const found = [];
  const re = /Extra\s+([A-Za-z][A-Za-z ]*?)\s*\(\s*x\s*(\d+)\s*\)/gi;
  for (const raw of texts) {
    const text = Array.isArray(raw) ? raw.join(', ') : String(raw || '');
    let m;
    while ((m = re.exec(text)) !== null) {
      found.push({
        name: m[1].trim().toLowerCase().replace(/\s+/g, ' '),
        qty: Math.min(parseInt(m[2], 10) || 0, MAX_ADDON_QTY)
      });
    }
  }
  return found;
}

function normalizeSize(size) {
  const s = String(size || '').trim().toLowerCase();
  if (s === '8oz') return '8oz';
  if (s === '12oz' || s === '') return '12oz'; // same default the cart uses
  return null;
}

// items: the array sent by the browser.
// Returns { items: [...with trusted unit_price/line_total/quantity/size], subtotal }
// Throws OrderPricingError (message is safe to show the customer).
function priceOrderItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new OrderPricingError('Your order has no items.');
  }
  if (items.length > MAX_ITEMS_PER_ORDER) {
    throw new OrderPricingError('Too many items in one order.');
  }

  let subtotalCents = 0;
  const priced = items.map((item) => {
    const size = normalizeSize(item && item.size);
    if (!size) throw new OrderPricingError('Invalid cup size in your order.');

    const rawQty = item && item.quantity !== undefined && item.quantity !== null && item.quantity !== ''
      ? Number(item.quantity)
      : 1;
    if (!Number.isInteger(rawQty) || rawQty < 1 || rawQty > MAX_QTY_PER_ITEM) {
      throw new OrderPricingError(`Quantity must be a whole number from 1 to ${MAX_QTY_PER_ITEM}.`);
    }

    let unitCents = BASE_PRICE_CENTS[size];
    for (const a of parseAddons(item.addons, item.toppings)) {
      const each = ADDON_PRICE_CENTS[a.name] !== undefined ? ADDON_PRICE_CENTS[a.name] : DEFAULT_ADDON_PRICE_CENTS;
      unitCents += each * a.qty;
    }

    const lineCents = unitCents * rawQty;
    subtotalCents += lineCents;

    return {
      ...item,
      size,
      quantity: rawQty,
      unit_price: unitCents / 100,
      line_total: lineCents / 100
    };
  });

  return { items: priced, subtotal: subtotalCents / 100 };
}

module.exports = { priceOrderItems, parseAddons, OrderPricingError, BASE_PRICE_CENTS, ADDON_PRICE_CENTS };
