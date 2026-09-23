// src/services/paymongoService.js
// Thin wrapper around PayMongo's v2 Checkout Sessions API.
// Docs: https://docs.paymongo.com/docs/payment-channels-hosted-checkout
require('dotenv').config();

const PAYMONGO_API_BASE = 'https://api.paymongo.com/v2';
// Retrieve/Expire Checkout Session only exist under PayMongo's v1 API -
// there is no v2 equivalent. Hitting v2 for these returns a 404
// ("The requested route does not exist"), which is why payment verification
// was failing even though the v2-created session and payment worked fine.
const PAYMONGO_API_BASE_V1 = 'https://api.paymongo.com/v1';
const EWALLET_METHOD_TYPES = ['qrph'];

function getSecretKey() {
  return process.env.PAYMONGO_SECRET_KEY;
}

function isConfigured() {
  const key = getSecretKey();
  return Boolean(key && !key.includes('REPLACE_WITH'));
}

function isLiveKey() {
  const key = getSecretKey() || '';
  return key.startsWith('sk_live_');
}

function authHeader() {
  const key = getSecretKey() || '';
  return 'Basic ' + Buffer.from(`${key}:`).toString('base64');
}

async function pmFetch(path, options = {}, base = PAYMONGO_API_BASE) {
  const res = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: authHeader(),
      ...(options.headers || {})
    }
  });

  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }

  if (!res.ok) {
    const detail = json && json.errors && json.errors[0] && json.errors[0].detail;
    const err = new Error(detail || `PayMongo request failed (${res.status})`);
    err.status = res.status;
    err.paymongoErrors = json ? json.errors : null;
    throw err;
  }

  return json.data;
}

/**
 * Create a live PayMongo Checkout Session scoped to QR Ph.
 */
async function createEwalletCheckoutSession({
  amount,
  description,
  referenceNumber,
  successUrl,
  cancelUrl,
  billingName,
  billingEmail,
  metadata
}) {
  if (!isConfigured()) {
    throw new Error('PayMongo is not configured. Set PAYMONGO_SECRET_KEY in your .env file.');
  }

  const centavos = Math.round(Number(amount) * 100);
  if (!Number.isFinite(centavos) || centavos < 100) {
    throw new Error('Payment amount must be at least ₱1.00.');
  }

  const attributes = {
    line_items: [
      {
        name: description || 'Milky Marble Order',
        amount: centavos,
        currency: 'PHP',
        quantity: 1
      }
    ],
    payment_method_types: EWALLET_METHOD_TYPES,
    success_url: successUrl,
    cancel_url: cancelUrl,
    reference_number: referenceNumber,
    send_email_receipt: true,
    description: description || 'Milky Marble Order',
    metadata: metadata || {}
  };

  if (billingName || billingEmail) {
    attributes.billing = {
      name: billingName || undefined,
      email: billingEmail || undefined
    };
  }

  return pmFetch('/checkout_sessions', {
    method: 'POST',
    body: JSON.stringify({ data: { attributes } })
  });
}

async function retrieveCheckoutSession(sessionId) {
  if (!isConfigured()) {
    throw new Error('PayMongo is not configured. Set PAYMONGO_SECRET_KEY in your .env file.');
  }
  return pmFetch(`/checkout_sessions/${sessionId}`, { method: 'GET' }, PAYMONGO_API_BASE_V1);
}

/** True if the given Checkout Session data object has a successful payment attached. */
function checkoutSessionIsPaid(sessionData) {
  const attrs = (sessionData && sessionData.attributes) || {};
  const payments = Array.isArray(attrs.payments) ? attrs.payments : [];
  if (payments.some((p) => p && p.attributes && p.attributes.status === 'paid')) return true;
  if (attrs.payment_intent && attrs.payment_intent.status === 'succeeded') return true;
  return false;
}

module.exports = {
  EWALLET_METHOD_TYPES,
  isConfigured,
  isLiveKey,
  createEwalletCheckoutSession,
  retrieveCheckoutSession,
  checkoutSessionIsPaid
};