// src/routes/paymentRoutes.js
const express = require('express');
const router = express.Router();
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const multer = require('multer');
const ocr = require('../services/paymentOcrService');
const { dispatchOrderStatusEmail } = require('../services/mailServices');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;

// Sends the "order confirmed" email once a Sales Officer verifies an E-Wallet
// payment. Looks the order back up with items + recipient info since the
// the caller only has the order id. Never throws - a failed email
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


// ==========================================
// MANUAL INSTAPAY QR PAYMENTS
// Customer pays the shop's InstaPay QR, uploads the receipt screenshot, and
// the 13-digit reference is read off it (OCR) and saved on the order. A Sales
// Officer then Verifies / Rejects it (see employeeRoutes.js). PayMongo has
// been removed entirely.
// ==========================================
const PROOF_BUCKET = process.env.SUPABASE_PAYMENT_PROOF_BUCKET || 'payment-proofs';
const ALLOWED_PROOF_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_PROOF_BYTES = 4 * 1024 * 1024; // Vercel rejects request bodies over ~4.5MB

const proofUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PROOF_BYTES, files: 1 }
});

// Wraps multer so its errors come back as clean JSON instead of a stack trace.
function singleProof(req, res, next) {
  proofUpload.single('proof')(req, res, (err) => {
    if (!err) return next();
    const message = err.code === 'LIMIT_FILE_SIZE'
      ? 'That image is too large. Please upload a screenshot under 4 MB.'
      : 'Could not read the uploaded image.';
    return res.status(400).json({ status: 'error', message });
  });
}

function checkProofFile(file) {
  if (!file) return 'Please upload a screenshot of your payment receipt.';
  if (!ALLOWED_PROOF_TYPES.includes(file.mimetype)) return 'Please upload a JPG, PNG or WebP image.';
  return null;
}

function cleanReference(value) {
  return String(value == null ? '' : value).replace(/[\s-]/g, '');
}

// True if some OTHER order already carries this reference.
async function referenceInUse(reference, exceptOrderId) {
  let q = supabase.from('orders').select('id, order_number').eq('payment_reference', reference).limit(1);
  if (exceptOrderId) q = q.neq('id', exceptOrderId);
  const { data, error } = await q;
  if (error) throw error;
  return Boolean(data && data.length);
}

// The login cookies are the only identity the client can't forge (same rule as
// orderRoutes.resolveCustomer). Guests prove ownership with the order's email.
async function callerOwnsOrder(req, order, guestEmail) {
  const cookieUserId = parseInt(req.cookies && req.cookies.user_id, 10);
  const cookieCustomerId = parseInt(req.cookies && req.cookies.customer_id, 10);

  if (order.customer_id) {
    if (Number.isFinite(cookieCustomerId) && cookieCustomerId === order.customer_id) return true;
    if (Number.isFinite(cookieUserId)) {
      const { data } = await supabase.from('customers').select('id').eq('user_id', cookieUserId).maybeSingle();
      if (data && data.id === order.customer_id) return true;
    }
    return false;
  }

  const supplied = String(guestEmail || '').trim().toLowerCase();
  return Boolean(supplied && order.guest_email && supplied === String(order.guest_email).trim().toLowerCase());
}

// POST /api/payments/ocr   (multipart: proof)
// Reads the reference number + amount off the screenshot. Never blocks the
// customer: when reading fails they just type the number in.
router.post('/ocr', singleProof, async (req, res) => {
  const fileErr = checkProofFile(req.file);
  if (fileErr) return res.status(400).json({ status: 'error', message: fileErr });

  try {
    const { reference, amount } = await ocr.extractReceiptDetails(req.file.buffer, req.file.mimetype);
    const in_use = reference && supabase ? await referenceInUse(reference) : false;
    return res.json({ status: 'success', reference, amount, reference_in_use: in_use });
  } catch (err) {
    console.error('[payments] OCR failed:', err.message);
    return res.json({
      status: 'success',
      reference: null,
      amount: null,
      reference_in_use: false,
      ocr_failed: true,
      message: 'We could not read the reference number automatically. Please type it in.'
    });
  }
});

// GET /api/payments/reference-available?reference=1234567890123&order_id=12
// Live "already used" check while the customer types.
router.get('/reference-available', async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ status: 'error', message: 'Database is disconnected.' });
    const reference = cleanReference(req.query.reference);
    if (!/^\d{13}$/.test(reference)) {
      return res.json({ status: 'success', valid: false, available: false });
    }
    const used = await referenceInUse(reference, req.query.order_id);
    return res.json({ status: 'success', valid: true, available: !used });
  } catch (err) {
    console.error('[payments] reference-available error:', err.message);
    return res.status(500).json({ status: 'error', message: 'Could not check the reference number.' });
  }
});

// POST /api/payments/submit   (multipart: order_id, reference, amount?, email?, proof)
router.post('/submit', singleProof, async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ status: 'error', message: 'Database is disconnected.' });

    const orderId = parseInt(req.body.order_id, 10);
    const reference = cleanReference(req.body.reference);
    if (!Number.isFinite(orderId)) {
      return res.status(400).json({ status: 'error', message: 'order_id is required.' });
    }
    if (!/^\d{13}$/.test(reference)) {
      return res.status(400).json({ status: 'error', message: 'The reference number must be exactly 13 digits.' });
    }
    const fileErr = checkProofFile(req.file);
    if (fileErr) return res.status(400).json({ status: 'error', message: fileErr });

    const { data: order, error: orderErr } = await supabase
      .from('orders')
      .select('id, order_number, status, payment_method, total_amount, customer_id, guest_email, payment_reference')
      .eq('id', orderId)
      .maybeSingle();
    if (orderErr || !order) {
      return res.status(404).json({ status: 'error', message: 'Order not found.' });
    }
    if (!(await callerOwnsOrder(req, order, req.body.email))) {
      return res.status(403).json({ status: 'error', message: 'You can only submit payment for your own order.' });
    }
    if (order.payment_method !== 'E-Wallet') {
      return res.status(400).json({ status: 'error', message: 'This order is not an E-Wallet order.' });
    }
    if (order.status !== 'PENDING_PAYMENT') {
      return res.status(409).json({ status: 'error', message: 'This order is no longer waiting for payment.' });
    }
    if (order.payment_reference) {
      return res.status(409).json({ status: 'error', message: 'A payment reference was already submitted for this order and is awaiting review.' });
    }

    if (await referenceInUse(reference, order.id)) {
      return res.status(409).json({
        status: 'error',
        code: 'REFERENCE_IN_USE',
        message: 'That reference number has already been used on another order.'
      });
    }

    // Store the screenshot in the private bucket (staff view it via signed URL).
    const ext = req.file.mimetype === 'image/png' ? 'png' : (req.file.mimetype === 'image/webp' ? 'webp' : 'jpg');
    const proofPath = `order-${order.id}/${Date.now()}.${ext}`;
    const { error: uploadErr } = await supabase.storage
      .from(PROOF_BUCKET)
      .upload(proofPath, req.file.buffer, { contentType: req.file.mimetype, upsert: false });
    if (uploadErr) {
      console.error('[payments] proof upload failed:', uploadErr.message);
      return res.status(500).json({ status: 'error', message: 'Could not save your receipt image. Please try again.' });
    }

    const claimedAmount = parseFloat(req.body.amount);
    const { data: updated, error: updateErr } = await supabase
      .from('orders')
      .update({
        payment_reference: reference,
        payment_amount: Number.isFinite(claimedAmount) && claimedAmount > 0 ? Number(claimedAmount.toFixed(2)) : null,
        payment_proof_path: proofPath,
        payment_submitted_at: new Date().toISOString()
      })
      .eq('id', order.id)
      .eq('status', 'PENDING_PAYMENT')
      .is('payment_reference', null)
      .select('id, order_number, status, total_amount, payment_reference')
      .maybeSingle();

    if (updateErr) {
      // Unique index lost a race with another submission of the same reference.
      supabase.storage.from(PROOF_BUCKET).remove([proofPath]).catch(() => {});
      if (updateErr.code === '23505') {
        return res.status(409).json({
          status: 'error',
          code: 'REFERENCE_IN_USE',
          message: 'That reference number has already been used on another order.'
        });
      }
      throw updateErr;
    }
    if (!updated) {
      supabase.storage.from(PROOF_BUCKET).remove([proofPath]).catch(() => {});
      return res.status(409).json({ status: 'error', message: 'This order was already updated. Please refresh and check its status.' });
    }

    return res.json({ status: 'success', message: 'Payment submitted. A Sales Officer will verify it shortly.', order: updated });
  } catch (err) {
    console.error('[payments] submit error:', err.message);
    return res.status(500).json({ status: 'error', message: 'Failed to submit payment.' });
  }
});

router.sendPaidConfirmationEmail = sendPaidConfirmationEmail;
router.PROOF_BUCKET = PROOF_BUCKET;

module.exports = router;
