// src/utils/transactionId.js
// Cash payments never touch PayMongo, so there's no gateway-issued
// transaction id to store for them. This generates an internal reference
// id instead, so cash sales still have something to display/reconcile
// against, the same way E-Wallet orders get PayMongo's real payment id
// (see paymongoService.getPaymentTransactionId).
function generateCashTransactionId() {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, ''); // YYYYMMDD
  const rand = Math.floor(1000 + Math.random() * 9000); // 4-digit
  return `CASH-${dateStr}-${rand}`;
}

module.exports = { generateCashTransactionId };
