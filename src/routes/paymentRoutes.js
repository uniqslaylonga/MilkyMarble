// src/routes/paymentRoutes.js
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const paymongo = require('../services/paymongoService');
const { dispatchOrderStatusEmail } = require('../services/mailServices');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;

// Sends the "order confirmed" email once an E-Wallet order actually clears
// payment. Looks the order back up with items + recipient info since the
// callers above only select a few columns. Never throws - a failed email
// should never break payment verification.
async function sendPaidConfirmationEmail(orderId) {
  try {
    const { data: order } = await supabase
      .from('orders')
      .select(`
        id, order_number, total_amount, subtotal, discount_amount, payment_method, pickup_date, pickup_instructions,
        guest_name, guest_email, customer_id,
        order_items (item_label, quantity, unit_price),
        customers ( user_id, users ( email, full_name, username ) )
      `)
      .eq('id', orderId)
      .maybeSingle();

    if (!order) return;

    const recipientEmail = order.guest_email || order.customers?.users?.email;
    if (!recipientEmail) return;
    const recipientName = order.guest_name || order.customers?.users?.full_name || order.customers?.users?.username || 'Valued Customer';

    let schedule = order.pickup_date || 'N/A';
    if (schedule === 'N/A' && order.pickup_instructions) {
      const match = order.pickup_instructions.match(/Pick-up:\s*([^|]+)/i);
      if (match) schedule = match[1].trim();
    }

    await dispatchOrderStatusEmail(recipientEmail, recipientName, order.order_number, 'PAID_VERIFIED', schedule, {
      order_ref: order.order_number,
      pickup_date: schedule,
      payment_method: order.payment_method,
      total_price: order.total_amount,
      subtotal: order.subtotal,
      discount: order.discount_amount,
      items: (order.order_items || []).map(it => ({
        title: it.item_label,
        quantity: it.quantity,
        unit_price: it.unit_price
      }))
    });
  } catch (err) {
    console.error('[payments] Order-confirmed email failed:', err.message);
  }
}

const APP_BASE_URL_ENV = (process.env.APP_BASE_URL || '').replace(/\/$/, '');
const SESSION_TAG_REGEX = /PayMongoSession:\s*(\S+)/i;

// Prefer an explicit APP_BASE_URL if it's actually set to something real.
// Otherwise derive the live URL from the request itself (works automatically
// on Vercel - including preview deployments - without needing the env var),
// only falling back to localhost for local dev with no request context.
function resolveAppBaseUrl(req) {
  if (APP_BASE_URL_ENV && !APP_BASE_URL_ENV.includes('localhost')) {
    return APP_BASE_URL_ENV;
  }
  if (req) {
    const forwardedProto = req.headers['x-forwarded-proto'];
    const proto = (forwardedProto ? String(forwardedProto).split(',')[0] : req.protocol) || 'https';
    const host = req.headers['x-forwarded-host'] || req.get('host');
    if (host) return `${proto}://${host}`;
  }
  return APP_BASE_URL_ENV || 'http://localhost:3000';
}

function extractSessionId(pickupInstructions) {
  const match = String(pickupInstructions || '').match(SESSION_TAG_REGEX);
  return match ? match[1] : null;
}

// ==========================================
// POST /api/payments/create-checkout
// Creates a LIVE PayMongo Checkout Session (QR Ph)
// for an already-placed order that's waiting on E-Wallet payment.
// ==========================================
router.post('/create-checkout', async (req, res) => {
  try {
    if (!supabase) {
      return res.status(500).json({ status: 'error', message: 'Database is disconnected.' });
    }
    if (!paymongo.isConfigured()) {
      return res.status(500).json({
        status: 'error',
        message: 'PayMongo is not configured yet. Please add PAYMONGO_SECRET_KEY to the server .env file.'
      });
    }

    const { order_id, billing_name, billing_email, customer_id, user_id } = req.body;
    if (!order_id) {
      return res.status(400).json({ status: 'error', message: 'order_id is required.' });
    }

    const { data: order, error: orderErr } = await supabase
      .from('orders')
      .select('id, order_number, total_amount, status, pickup_instructions')
      .eq('id', order_id)
      .single();

    if (orderErr || !order) {
      return res.status(404).json({ status: 'error', message: 'Order not found.' });
    }

    if (order.status === 'PAID_VERIFIED') {
      return res.json({ status: 'success', already_paid: true, order });
    }

    // Reuse an existing, still-open checkout session instead of creating a new one
    // every time the customer re-opens the payment step.
    const existingSessionId = extractSessionId(order.pickup_instructions);
    if (existingSessionId) {
      try {
        const existingSession = await paymongo.retrieveCheckoutSession(existingSessionId);
        const checkoutUrl = existingSession && existingSession.attributes && existingSession.attributes.checkout_url;
        if (checkoutUrl) {
          return res.json({ status: 'success', checkout_url: checkoutUrl, session_id: existingSessionId });
        }
      } catch {
        // Session may have expired/been consumed - fall through and create a new one.
      }
    }

    const APP_BASE_URL = resolveAppBaseUrl(req);
    const sessionParams = new URLSearchParams();
    if (customer_id) sessionParams.set('customer_id', String(customer_id));
    if (user_id) sessionParams.set('user_id', String(user_id));
    const sessionQuery = sessionParams.toString() ? `&${sessionParams.toString()}` : '';

    const successUrl = `${APP_BASE_URL}/customer/paymentReturn.html?order_id=${order.id}${sessionQuery}`;
    const cancelUrl = `${APP_BASE_URL}/customer/paymentReturn.html?order_id=${order.id}&cancelled=1${sessionQuery}`;

    const session = await paymongo.createEwalletCheckoutSession({
      amount: order.total_amount,
      description: `Milky Marble Order ${order.order_number}`,
      referenceNumber: order.order_number,
      successUrl,
      cancelUrl,
      billingName: billing_name,
      billingEmail: billing_email,
      metadata: { order_id: String(order.id) }
    });

    const updatedInstructions = `${order.pickup_instructions || ''} | PayMongoSession: ${session.id}`;
    await supabase
      .from('orders')
      .update({ pickup_instructions: updatedInstructions })
      .eq('id', order.id);

    return res.json({
      status: 'success',
      checkout_url: session.attributes.checkout_url,
      session_id: session.id,
      livemode: paymongo.isLiveKey()
    });
  } catch (err) {
    console.error('[PayMongo] create-checkout error:', err.message);
    return res.status(400).json({ status: 'error', message: err.message || 'Failed to start PayMongo checkout.' });
  }
});

// ==========================================
// GET /api/payments/verify/:orderId
// Polled by paymentReturn.html after the customer comes back from PayMongo.
// ==========================================
router.get('/verify/:orderId', async (req, res) => {
  try {
    if (!supabase) {
      return res.status(500).json({ status: 'error', message: 'Database is disconnected.' });
    }

    const { orderId } = req.params;
    const { data: order, error: orderErr } = await supabase
      .from('orders')
      .select('id, order_number, total_amount, status, pickup_instructions')
      .eq('id', orderId)
      .single();

    if (orderErr || !order) {
      return res.status(404).json({ status: 'error', message: 'Order not found.' });
    }

    if (order.status === 'PAID_VERIFIED') {
      return res.json({ status: 'success', paid: true, order });
    }

    const sessionId = extractSessionId(order.pickup_instructions);
    if (!sessionId || !paymongo.isConfigured()) {
      return res.json({ status: 'success', paid: false, order });
    }

    const session = await paymongo.retrieveCheckoutSession(sessionId);
    const paid = paymongo.checkoutSessionIsPaid(session);

    if (paid) {
      const { data: updatedOrder } = await supabase
        .from('orders')
        .update({ status: 'PAID_VERIFIED' })
        .eq('id', order.id)
        .select()
        .single();

      sendPaidConfirmationEmail(order.id);
      return res.json({ status: 'success', paid: true, order: updatedOrder || order });
    }

    return res.json({ status: 'success', paid: false, order });
  } catch (err) {
    console.error('[PayMongo] verify error:', err.message);
    return res.status(400).json({ status: 'error', message: err.message || 'Failed to verify payment.' });
  }
});

// ==========================================
// POST /api/payments/webhook
// Live PayMongo webhook: checkout_session.payment.paid
// Requires the raw request body (captured in server.js via express.json's `verify`)
// to validate the Paymongo-Signature header.
// ==========================================
router.post('/webhook', async (req, res) => {
  try {
    const secret = process.env.PAYMONGO_WEBHOOK_SECRET;
    const signatureHeader = req.headers['paymongo-signature'];

    if (secret && !secret.includes('REPLACE_WITH') && signatureHeader && req.rawBody) {
      const parts = {};
      String(signatureHeader).split(',').forEach((chunk) => {
        const [k, v] = chunk.split('=');
        if (k && v) parts[k.trim()] = v.trim();
      });

      const timestamp = parts.t;
      const expectedSignature = parts.li || parts.te;
      const signedPayload = `${timestamp}.${req.rawBody.toString('utf8')}`;
      const computedSignature = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');

      const isValid = expectedSignature
        && computedSignature.length === expectedSignature.length
        && crypto.timingSafeEqual(Buffer.from(computedSignature), Buffer.from(expectedSignature));

      if (!isValid) {
        console.warn('[PayMongo Webhook] Invalid signature - rejecting.');
        return res.status(400).json({ status: 'error', message: 'Invalid signature.' });
      }
    } else {
      console.warn('[PayMongo Webhook] PAYMONGO_WEBHOOK_SECRET not set - skipping signature check.');
    }

    const event = req.body;
    const eventType = event && event.data && event.data.type;
    const resource = event && event.data && event.data.data;
    const referenceNumber = resource && resource.attributes && resource.attributes.reference_number;

    if (eventType === 'checkout_session.payment.paid' && referenceNumber && supabase) {
      const { data: order } = await supabase
        .from('orders')
        .select('id, status')
        .eq('order_number', referenceNumber)
        .single();

      if (order && order.status !== 'PAID_VERIFIED') {
        await supabase.from('orders').update({ status: 'PAID_VERIFIED' }).eq('id', order.id);
        console.log(`[PayMongo Webhook] Order ${referenceNumber} marked PAID_VERIFIED.`);
        sendPaidConfirmationEmail(order.id);
      }
    }

    return res.status(200).json({ status: 'success', received: true });
  } catch (err) {
    console.error('[PayMongo Webhook] error:', err.message);
    // Still ack with 200 so PayMongo doesn't hammer retries for a local bug;
    // the order can be reconciled via GET /api/payments/verify/:orderId.
    return res.status(200).json({ status: 'error', message: err.message });
  }
});

module.exports = router;