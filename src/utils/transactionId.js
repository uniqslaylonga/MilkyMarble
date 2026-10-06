// src/utils/transactionId.js
// Cash payments have no payment reference, so this generates an internal
// reference id instead, so cash sales still have something to display and
// reconcile against. E-Wallet orders use the customer's 13-digit InstaPay
// reference (orders.payment_reference), copied into transaction_id once a
// Sales Officer verifies the payment.
function generateCashTransactionId() {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, ''); // YYYYMMDD
  const rand = Math.floor(1000 + Math.random() * 9000); // 4-digit
  return `CASH-${dateStr}-${rand}`;
}

module.exports = { generateCashTransactionId };
