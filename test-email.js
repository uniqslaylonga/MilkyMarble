// test-email.js
// Standalone test for the SMTP setup — does NOT need the Express server running.
//
// Usage:
//   node test-email.js your-real-email@example.com
//
// What it does:
//   1. Loads .env
//   2. Sends a test "security OTP" email using mailServices.js
//   3. Sends a test "order confirmed" email using mailServices.js
//   4. Prints SENT/FAILED for each, plus the real error if one failed
//
// If something fails, mailServices.js already logs the underlying
// Nodemailer error to the console (e.g. bad credentials, blocked port,
// wrong host) — read that line, it tells you exactly what's wrong.

require('dotenv').config();
const mail = require('./src/services/mailServices.js');

async function main() {
  const toEmail = process.argv[2];

  if (!toEmail) {
    console.error('Usage: node test-email.js your-real-email@example.com');
    process.exit(1);
  }

  console.log(`Using SMTP_HOST=${process.env.SMTP_HOST || 'smtp.gmail.com (default)'}`);
  console.log(`Using SMTP_PORT=${process.env.SMTP_PORT || '465 (default)'}`);
  console.log(`Using SMTP_USER=${process.env.SMTP_USER || '(not set!)'}`);
  console.log(`SMTP_PASS is set: ${Boolean(process.env.SMTP_PASS)}`);
  console.log('');

  console.log(`Sending test OTP email to ${toEmail} ...`);
  const otpOk = await mail.sendSecurityOtpEmail(toEmail, 'Test User', '123456', 'test');
  console.log(otpOk ? '  -> SENT ✅' : '  -> FAILED ❌ (see Nodemailer error above)');

  console.log('');
  console.log(`Sending test order-confirmed email to ${toEmail} ...`);
  const orderOk = await mail.sendOrderConfirmedEmail(toEmail, 'Test User', {
    order_ref: 'TEST-0001',
    pickup_date: 'Monday · 10:00 AM – 3:00 PM',
    payment_method: 'Cash on Pick-Up',
    total_price: 150,
    items: [
      {
        title: 'Choco Jelly Milk',
        size: '16oz',
        quantity: 2,
        unit_price: 75,
        toppings: ['Pearls'],
        addons: []
      }
    ]
  });
  console.log(orderOk ? '  -> SENT ✅' : '  -> FAILED ❌ (see Nodemailer error above)');

  console.log('');
  console.log('Done. Check the inbox (and spam folder) for', toEmail);
  process.exit(otpOk && orderOk ? 0 : 1);
}

main();