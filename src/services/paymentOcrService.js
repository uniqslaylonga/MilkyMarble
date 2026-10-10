// src/services/paymentOcrService.js
// Reads the 13-digit reference number (and amount) off a payment-receipt
// screenshot using Gemini vision. Best-effort only: the customer always sees
// the result in an editable field, and the Sales Officer makes the final call.
require('dotenv').config();

const OCR_MODEL = process.env.GEMINI_OCR_MODEL || 'gemini-3.8-flash';
const FALLBACK_MODEL = process.env.GEMINI_OCR_FALLBACK_MODEL || 'gemini-3.5-flash-lite';

function getApiKey() {
  return String(process.env.GEMINI_API_KEY || '').trim().replace(/^["']|["']$/g, '');
}

function isConfigured() {
  return Boolean(getApiKey());
}

// "1234 567 890123" / "1234-567-890123" -> "1234567890123"
function digitsOnly(value) {
  return String(value == null ? '' : value).replace(/\D/g, '');
}

function pickReference(candidates) {
  for (const c of candidates) {
    const d = digitsOnly(c);
    if (d.length === 13) return d;
  }
  return null;
}

function parseAmount(value) {
  if (value == null) return null;
  const n = parseFloat(String(value).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? Number(n.toFixed(2)) : null;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function extractReceiptDetails(buffer, mimeType) {
  if (!isConfigured()) {
    const err = new Error('Automatic reading is not configured.');
    err.code = 'OCR_NOT_CONFIGURED';
    throw err;
  }

  const prompt = [
    'This is a screenshot of a Philippine InstaPay / QR Ph / e-wallet payment receipt.',
    'Extract:',
    '- "reference": the 13-digit reference number (labelled "Ref No.", "Reference No." or similar). It may be printed with spaces or dashes; return digits only. If several numbers are shown, choose the one that is exactly 13 digits.',
    '- "amount": the amount paid, as a plain number with no currency symbol or commas.',
    'If a field is not visible, use null. Do not guess.',
    'Respond ONLY with JSON: {"reference": string|null, "amount": number|null}'
  ].join('\n');

  // Gemini 3.x models no longer accept temperature/top_p/top_k, so only the
  // JSON response type is requested.
  const body = JSON.stringify({
    contents: [{
      parts: [
        { inline_data: { mime_type: mimeType || 'image/jpeg', data: buffer.toString('base64') } },
        { text: prompt }
      ]
    }],
    generationConfig: { responseMimeType: 'application/json' }
  });

  // Try the main model twice, then the fallback model twice, but only when
  // Google reports a temporary problem (429 / 500 / 503).
  let res;
  let json;
  for (const model of [OCR_MODEL, FALLBACK_MODEL]) {
    for (let attempt = 0; attempt < 2; attempt++) {
      res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': getApiKey() },
          body
        }
      );
      json = await res.json().catch(() => null);
      if (res.ok || ![429, 500, 503].includes(res.status)) break;
      await sleep(800);
    }
    if (res.ok) break;
  }

  if (!res.ok) {
    throw new Error((json && json.error && json.error.message) || `OCR request failed (${res.status})`);
  }

  const text = json && json.candidates && json.candidates[0] && json.candidates[0].content
    && json.candidates[0].content.parts && json.candidates[0].content.parts.map(p => p.text || '').join('');
  let parsed = {};
  try {
    parsed = JSON.parse(String(text || '{}').replace(/```json|```/g, '').trim());
  } catch {
    parsed = {};
  }

  return {
    reference: pickReference([parsed.reference]),
    amount: parseAmount(parsed.amount)
  };
}

module.exports = { isConfigured, extractReceiptDetails, digitsOnly };