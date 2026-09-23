const nodemailer = require('nodemailer');

// 1. Transporter configuration (RFC-compliant Gmail SMTP)
const smtpPort = parseInt(process.env.SMTP_PORT || '465', 10);

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: smtpPort,
    secure: smtpPort === 465, // 465 = implicit TLS (secure:true), 587 = STARTTLS (secure:false)
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    },
    tls: {
        rejectUnauthorized: false // katumbas ng verify_peer: false sa PHPMailer
    },
    headers: {
        'Auto-Submitted': 'auto-generated',
        'X-Auto-Response-Suppress': 'OOF, AutoReply'
    }
});

const DEFAULT_FROM = '"Milky Marble" <milkymarble.supportcenter@gmail.com>';
const DEFAULT_REPLY_TO = 'milkymarble.supportcenter@gmail.com';

// Utility: HTML Escaping para maiwasan ang injection sa emails
function escapeHtml(str = '') {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Master Template Wrapper na may UCC Congressional & Social Channels
 */
function renderEmailLayout(badgeText, mainHeading, bodyHtml) {
    const currentYear = new Date().getFullYear();

    return `
    <!DOCTYPE html>
    <html lang='en'>
    <head>
        <meta charset='UTF-8'>
        <meta name='viewport' content='width=device-width, initial-scale=1.0'>
        <title>${escapeHtml(mainHeading)}</title>
    </head>
    <body style='margin: 0; padding: 0; background-color: #FAF4EF; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #44332C; -webkit-font-smoothing: antialiased;'>
        <table border='0' cellpadding='0' cellspacing='0' width='100%' style='background-color: #FAF4EF; padding: 32px 14px;'>
            <tr>
                <td align='center'>
                    <table border='0' cellpadding='0' cellspacing='0' width='100%' style='max-width: 540px; background-color: #FFFFFF; border-radius: 20px; border: 1px solid #EADCD4; overflow: hidden; box-shadow: 0 6px 18px rgba(89,74,66,0.05);'>
                        
                        <!-- BRAND HEADER -->
                        <tr>
                            <td align='center' style='padding: 28px 24px 20px 24px; border-bottom: 2px dashed #F2E3DB; background-color: #FFFDFB;'>
                                <span style='display: inline-block; padding: 4px 14px; background-color: #FFF0F1; border: 1px solid #FCD4D7; border-radius: 99px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #D9656B; margin-bottom: 8px;'>${escapeHtml(badgeText)}</span>
                                <h1 style='margin: 0; font-size: 24px; font-weight: 800; color: #5C3B28; letter-spacing: -0.5px;'>Milky Marble</h1>
                                <div style='font-size: 13px; color: #8C7A70; margin-top: 4px;'>Customized Jelly Milk & Sweet Sips</div>
                            </td>
                        </tr>

                        <!-- MAIN BODY CONTENT -->
                        <tr>
                            <td style='padding: 26px 28px;'>
                                ${bodyHtml}
                            </td>
                        </tr>

                        <!-- CUSTOMER SERVICE, UCC LOCATION & SOCIALS -->
                        <tr>
                            <td style='padding: 0 28px 26px 28px;'>
                                <div style='background-color: #FAF6F3; border: 1px solid #EDE2DC; border-radius: 14px; padding: 18px 20px;'>
                                    <div style='font-size: 13px; font-weight: 700; color: #5C3B28; margin-bottom: 6px;'>Need Assistance or Have Questions?</div>
                                    <p style='margin: 0 0 12px 0; font-size: 12.5px; line-height: 1.5; color: #6E5C53;'>
                                        Got questions about your custom jelly cuts, schedule adjustments, or payments? Feel free to visit our counter or message us directly!
                                    </p>
                                    
                                    <div style='font-size: 12px; color: #6E5C53; line-height: 1.7;'>
                                        <b>Pick-up Location:</b> Milky Marble, UCC Congressional Campus<br>
                                        <b>Store Days:</b> Mondays & Thursdays only · 10:00 AM – 3:00 PM<br>
                                        <b>Email:</b> <a href='mailto:milkymarble.supportcenter@gmail.com' style='color: #D9656B; text-decoration: none;'>milkymarble.supportcenter@gmail.com</a><br>
                                        <b>Connect With Us:</b> Search <b>@Milky Marble</b> on Instagram, Facebook & TikTok
                                    </div>
                                </div>
                            </td>
                        </tr>

                        <!-- FOOTER -->
                        <tr>
                            <td align='center' style='background-color: #F8F2ED; padding: 18px 24px; border-top: 1px solid #EADCD4; font-size: 11.5px; color: #9E8D83; line-height: 1.5;'>
                                Milky Marble · UCC Congressional Campus, Caloocan City<br>
                                You received this automated notification regarding your customer account or order.<br>
                                © ${currentYear} Milky Marble. All rights reserved.
                            </td>
                        </tr>

                    </table>
                </td>
            </tr>
        </table>
    </body>
    </html>`;
}

// -------------------------------------------------------------
// STAGE 1: CONFIRMED (Order Receipt)
// -------------------------------------------------------------
async function sendOrderConfirmedEmail(toEmail, recipientName, orderData = {}) {
    if (!toEmail) return false;

    try {
        const orderRef      = orderData.order_ref || 'MM-1048';
        const pickupDate    = orderData.pickup_date || 'Monday / Thursday · 10:00 AM – 3:00 PM';
        const paymentMethod = orderData.payment_method || 'Cash on Pick-Up';
        const totalPrice    = Number(orderData.total_price || 0).toFixed(2);
        const subtotal      = Number(orderData.subtotal ?? orderData.total_price ?? 0).toFixed(2);
        const discount      = Number(orderData.discount || 0).toFixed(2);

        let itemsHtml = '';
        let itemsPlain = '';

        for (const item of (orderData.items || [])) {
            const itemTitle = escapeHtml(item.title || 'Custom Cup');
            const itemSize  = escapeHtml(item.size || '12oz');
            const qty       = parseInt(item.quantity || 1, 10);
            const linePrice = (Number(item.unit_price || 19) * qty).toFixed(2);

            const topStr = Array.isArray(item.toppings) ? item.toppings.join(', ') : (item.toppings || '');
            const addStr = Array.isArray(item.addons) ? item.addons.join(', ') : (item.addons || '');

            let extras = '';
            if (topStr) extras += `<br><span style='font-size: 11.5px; color: #8C7A70;'>Toppings: ${escapeHtml(topStr)}</span>`;
            if (addStr) extras += `<br><span style='font-size: 11.5px; color: #8C7A70;'>Add-ons: ${escapeHtml(addStr)}</span>`;

            itemsHtml += `
            <tr style='border-bottom: 1px solid #F0E4DC;'>
                <td style='padding: 10px 0; font-size: 13.5px; color: #44332C; vertical-align: top;'>
                    <b>${itemSize} ${itemTitle}</b>
                    ${extras}
                </td>
                <td style='padding: 10px 8px; font-size: 13.5px; text-align: center; color: #44332C; vertical-align: top;'>${qty}x</td>
                <td style='padding: 10px 0; font-size: 13.5px; font-weight: 700; text-align: right; color: #44332C; vertical-align: top;'>PHP ${linePrice}</td>
            </tr>`;

            itemsPlain += `• ${qty}x ${itemSize} ${itemTitle} — PHP ${linePrice}\n`;
        }

        const bodyContent = `
        <p style='font-size: 14.5px; margin: 0 0 10px 0;'>Hello <b>${escapeHtml(recipientName)}</b>,</p>
        <p style='font-size: 14px; line-height: 1.6; margin: 0 0 18px 0; color: #55443D;'>
            Thank you for ordering with us! We have confirmed your cup order and added it to our counter prep list at UCC Congressional Campus.
        </p>

        <div style='background-color: #FFF9F7; border: 1px solid #F5DBD2; border-radius: 10px; padding: 14px 16px; margin-bottom: 20px; font-size: 13px; line-height: 1.6;'>
            <div><b>Order Reference:</b> #${escapeHtml(orderRef)}</div>
            <div><b>Target Pick-up:</b> ${escapeHtml(pickupDate)}</div>
            <div><b>Location:</b> UCC Congressional Campus</div>
            <div><b>Payment Method:</b> ${escapeHtml(paymentMethod)}</div>
        </div>

        <table style='width: 100%; border-collapse: collapse; margin-bottom: 16px;'>
            <thead>
                <tr style='border-bottom: 2px solid #5C3B28; font-size: 11.5px; text-transform: uppercase; color: #5C3B28;'>
                    <th align='left' style='padding-bottom: 6px;'>Item Selection</th>
                    <th align='center' style='padding-bottom: 6px;'>Qty</th>
                    <th align='right' style='padding-bottom: 6px;'>Subtotal</th>
                </tr>
            </thead>
            <tbody>${itemsHtml}</tbody>
        </table>

        <div style='border-top: 1px solid #EADCD4; padding-top: 10px; font-size: 13.5px; line-height: 1.6;'>
            <div style='display: flex; justify-content: space-between;'>
                <span>Subtotal</span><span>PHP ${subtotal}</span>
            </div>
            ${Number(discount) > 0 ? `
            <div style='display: flex; justify-content: space-between; color: #2E7D32;'>
                <span>Discount Applied</span><span>- PHP ${discount}</span>
            </div>` : ''}
            <div style='display: flex; justify-content: space-between; font-size: 16px; font-weight: 800; border-top: 2px solid #5C3B28; padding-top: 8px; margin-top: 6px; color: #5C3B28;'>
                <span>Total Amount Due</span><span style='color: #D9656B;'>PHP ${totalPrice}</span>
            </div>
        </div>`;

        await transporter.sendMail({
            from: DEFAULT_FROM,
            to: `"${recipientName || 'Valued Customer'}" <${toEmail}>`,
            replyTo: DEFAULT_REPLY_TO,
            subject: `Order Confirmed #${orderRef} - Milky Marble`,
            html: renderEmailLayout('Stage 1 · Order Confirmed', 'Order Confirmed', bodyContent),
            text: `Hello ${recipientName},\n\nYour order #${orderRef} is confirmed!\n\nPick-up at UCC Congressional Campus\nStore Days: Mon & Thu (10 AM - 3 PM)\nPayment: ${paymentMethod}\n\nItems:\n${itemsPlain}\nTotal: PHP ${totalPrice}\n\nQuestions? Chat with us on FB, IG, or TikTok: @Milky Marble.`
        });

        return true;
    } catch (err) {
        console.error('Nodemailer Confirmed Error:', err.message);
        return false;
    }
}

const sendOrderReceiptEmail = sendOrderConfirmedEmail;

// -------------------------------------------------------------
// STAGE 2: PREPARING (Kitchen Prep)
// -------------------------------------------------------------
async function sendOrderPreparingEmail(toEmail, recipientName, orderRef) {
    if (!toEmail) return false;

    try {
        const bodyContent = `
        <p style='font-size: 14.5px; margin: 0 0 10px 0;'>Hello <b>${escapeHtml(recipientName)}</b>,</p>
        <p style='font-size: 14px; line-height: 1.6; margin: 0 0 18px 0; color: #55443D;'>
            Great news! Our store crew has begun making your Jelly Milk. We are slicing your jelly cuts, chilling the milky bases, and layering the toppings fresh.
        </p>

        <div style='background-color: #FFFDF9; border-left: 4px solid #E28A47; border: 1px solid #F7EADF; border-left-width: 4px; border-radius: 10px; padding: 14px 18px; margin-bottom: 20px;'>
            <div style='font-size: 13px; color: #7C4F38;'><b>Current Status:</b> Handcrafted in Counter Prep</div>
            <div style='font-size: 13px; color: #7C4F38; margin-top: 4px;'><b>Tracking Code:</b> #${escapeHtml(orderRef)}</div>
        </div>

        <p style='font-size: 13.5px; line-height: 1.5; color: #6E5C53;'>
            We will send another notification as soon as your cup is ready to pick up at our UCC Congressional Campus.
        </p>`;

        await transporter.sendMail({
            from: DEFAULT_FROM,
            to: `"${recipientName || 'Valued Customer'}" <${toEmail}>`,
            replyTo: DEFAULT_REPLY_TO,
            subject: `Now Crafting Your Sips #${orderRef} - Milky Marble`,
            html: renderEmailLayout('Stage 2 · Kitchen Prep', 'Crafting Your Order', bodyContent),
            text: `Hello ${recipientName},\n\nOur crew is crafting your order #${orderRef}!\nPick-up Location: UCC Congressional Campus (Mon & Thu, 10 AM - 3 PM).\nChat with us on IG, FB, or TikTok @Milky Marble.`
        });

        return true;
    } catch (err) {
        console.error('Nodemailer Preparing Error:', err.message);
        return false;
    }
}

// -------------------------------------------------------------
// STAGE 3: READY FOR PICKUP (Campus Counter Alert)
// -------------------------------------------------------------
async function sendOrderReadyEmail(toEmail, recipientName, orderRef, pickupSchedule = '') {
    if (!toEmail) return false;

    try {
        const bodyContent = `
        <p style='font-size: 14.5px; margin: 0 0 10px 0;'>Hello <b>${escapeHtml(recipientName)}</b>,</p>
        <p style='font-size: 14px; line-height: 1.6; margin: 0 0 18px 0; color: #55443D;'>
            Your customized Jelly Milk is freshly prepared and waiting for you at our UCC Congressional Campus counter!
        </p>

        <div style='text-align: center; background-color: #F8FBF6; border: 1.5px dashed #6E9E39; border-radius: 12px; padding: 18px; margin: 20px 0;'>
            <div style='font-size: 12px; font-weight: 700; text-transform: uppercase; color: #4A6E24; letter-spacing: 0.5px;'>Present This Reference Upon Claim:</div>
            <div style='font-size: 26px; font-weight: 800; color: #2E7D32; letter-spacing: 2px; margin: 6px 0;'>#${escapeHtml(orderRef)}</div>
            <div style='font-size: 12px; color: #6E5C53;'>Milky Marble Counter · UCC Congressional Campus</div>
        </div>

        <p style='font-size: 13.5px; line-height: 1.5; color: #6E5C53;'>
            Our store counter is open every <b>Monday and Thursday from 10:00 AM to 3:00 PM</b>.
        </p>`;

        await transporter.sendMail({
            from: DEFAULT_FROM,
            to: `"${recipientName || 'Valued Customer'}" <${toEmail}>`,
            replyTo: DEFAULT_REPLY_TO,
            subject: `Your Drinks Are Ready for Pick-Up! #${orderRef} - Milky Marble`,
            html: renderEmailLayout('Stage 3 · Ready for Pick-Up', 'Ready for Claim', bodyContent),
            text: `Hello ${recipientName},\n\nYour drinks are ready for pick-up!\nCode: #${orderRef}\nLocation: UCC Congressional Campus (Mon & Thu · 10 AM - 3 PM).\nChat with us on FB, IG, or TikTok: @Milky Marble.`
        });

        return true;
    } catch (err) {
        console.error('Nodemailer Ready Error:', err.message);
        return false;
    }
}

// -------------------------------------------------------------
// STAGE 4: COMPLETED (Order Received)
// -------------------------------------------------------------
async function sendOrderCompletedEmail(toEmail, recipientName, orderRef) {
    if (!toEmail) return false;

    try {
        const bodyContent = `
        <p style='font-size: 14.5px; margin: 0 0 10px 0;'>Hello <b>${escapeHtml(recipientName)}</b>,</p>
        <p style='font-size: 14px; line-height: 1.6; margin: 0 0 16px 0; color: #55443D;'>
            Thank you for picking up your sweet treat at Milky Marble! We hope your custom jelly cup brightened up your campus day.
        </p>

        <div style='background-color: #FFF8F8; border: 1px solid #FCD4D7; border-radius: 12px; padding: 16px; margin: 18px 0; text-align: center;'>
            <div style='font-size: 13.5px; font-weight: 700; color: #5C3B28; margin-bottom: 4px;'>Share Your Sips!</div>
            <p style='margin: 0; font-size: 12.5px; color: #6E5C53;'>
                Don't forget to snap a photo and tag <b>@Milky Marble</b> on Instagram, TikTok, and Facebook! We’d love to see your favorite topping combos.
            </p>
        </div>`;

        await transporter.sendMail({
            from: DEFAULT_FROM,
            to: `"${recipientName || 'Valued Customer'}" <${toEmail}>`,
            replyTo: DEFAULT_REPLY_TO,
            subject: `Order Completed #${orderRef} — Hope You Loved Every Sip!`,
            html: renderEmailLayout('Stage 4 · Completed', 'Order Fulfilled', bodyContent),
            text: `Hello ${recipientName},\n\nThank you for claiming order #${orderRef} at Milky Marble UCC Congressional!\nTag us on IG, TikTok & FB @Milky Marble.`
        });

        return true;
    } catch (err) {
        console.error('Nodemailer Completed Error:', err.message);
        return false;
    }
}

// -------------------------------------------------------------
// STAGE 5: CANCELLED (Cancellation Notice)
// -------------------------------------------------------------
async function sendOrderCancelledEmail(toEmail, recipientName, orderRef) {
    if (!toEmail) return false;

    try {
        const bodyContent = `
        <p style='font-size: 14.5px; margin: 0 0 10px 0;'>Hello <b>${escapeHtml(recipientName)}</b>,</p>
        <p style='font-size: 14px; line-height: 1.6; margin: 0 0 18px 0; color: #55443D;'>
            This is an official notice to confirm that your order <b>#${escapeHtml(orderRef)}</b> has been cancelled.
        </p>

        <div style='background-color: #FFF5F5; border-left: 4px solid #DC3545; border: 1px solid #FCD4D7; border-left-width: 4px; border-radius: 10px; padding: 14px 16px; margin-bottom: 18px; font-size: 13px; color: #721C24;'>
            <b>Cancellation Confirmed:</b> Your queued Jelly Milk order have been removed from our preparation list.
        </div>

        <p style='font-size: 13.5px; line-height: 1.6; color: #6E5C53;'>
            If this was unintended, or if you have questions, please reach out directly through our social pages (<b>@Milky Marble</b> on IG, FB, or TikTok) or visit our counter at UCC Congressional Campus on Mondays and Thursdays.
        </p>`;

        await transporter.sendMail({
            from: DEFAULT_FROM,
            to: `"${recipientName || 'Valued Customer'}" <${toEmail}>`,
            replyTo: DEFAULT_REPLY_TO,
            subject: `Order Cancellation Notice #${orderRef} - Milky Marble`,
            html: renderEmailLayout('Stage 5 · Cancelled', 'Order Cancelled', bodyContent),
            text: `Hello ${recipientName},\n\nYour order #${orderRef} has been cancelled. If this was a mistake, chat with us on FB, IG, or TikTok: @Milky Marble.`
        });

        return true;
    } catch (err) {
        console.error('Nodemailer Cancelled Error:', err.message);
        return false;
    }
}

// -------------------------------------------------------------
// STAGE 6: WELCOME VOUCHER (VIP Club Perks)
// -------------------------------------------------------------
async function sendPromoWelcomeEmail(toEmail, recipientName) {
    if (!toEmail) return false;

    try {
        const bodyContent = `
        <p style='font-size: 14.5px; margin: 0 0 10px 0;'>Hello <b>${escapeHtml(recipientName)}</b>,</p>
        <p style='font-size: 14px; line-height: 1.6; margin: 0 0 18px 0; color: #55443D;'>
            Welcome to the Sweet Club! You will now be the first to know whenever we drop limited seasonal jelly cuts, secret menu toppings, and flash discounts at UCC Congressional Campus.
        </p>

        <div style='background-color: #FFF5F4; border: 2px dashed #D9656B; border-radius: 14px; padding: 18px; text-align: center; margin: 20px 0;'>
            <div style='font-size: 11.5px; font-weight: 700; text-transform: uppercase; color: #7C4F38; letter-spacing: 1px;'>Your Exclusive Welcome Perk:</div>
            <div style='font-size: 24px; font-weight: 800; color: #D9656B; letter-spacing: 3px; margin: 6px 0;'>SWEETSIP10</div>
            <div style='font-size: 12.5px; color: #5C3B28; font-weight: 600;'>Get 10% discount on your next counter order!</div>
        </div>

        <p style='font-size: 13px; color: #8C7A70; text-align: center; margin: 0;'>
            Drop by our campus counter every Monday or Thursday from 10:00 AM to 3:00 PM to claim your treat!
        </p>`;

        await transporter.sendMail({
            from: DEFAULT_FROM,
            to: `"${recipientName || 'Sweet Sips Lover'}" <${toEmail}>`,
            replyTo: DEFAULT_REPLY_TO,
            subject: 'Welcome to the Milky Marble Sweet Club! Enjoy 10% Off',
            html: renderEmailLayout('VIP Club · Welcome', 'Welcome to the Club', bodyContent),
            text: `Hello ${recipientName},\n\nWelcome to Milky Marble! Use promo code SWEETSIP10 for 10% off at our UCC Congressional Campus counter (Mon & Thu · 10 AM - 3 PM).\nFollow @Milky Marble on IG, TikTok & FB.`
        });

        return true;
    } catch (err) {
        console.error('Nodemailer Promo Welcome Error:', err.message);
        return false;
    }
}

// -------------------------------------------------------------
// OTP SECURITY EMAIL (Verification Code)
// -------------------------------------------------------------
async function sendSecurityOtpEmail(toEmail, recipientName, otpCode, purpose = 'email_change') {
    if (!toEmail) return false;

    try {
        const bodyContent = `
        <p style='font-size: 14.5px; margin: 0 0 10px 0;'>Hello <b>${escapeHtml(recipientName)}</b>,</p>
        <p style='font-size: 14px; line-height: 1.6; margin: 0 0 16px 0; color: #55443D;'>
            Here is your requested single-use authentication code to verify your Milky Marble account:
        </p>

        <div style='text-align: center; margin: 24px 0;'>
            <div style='display: inline-block; padding: 12px 28px; background-color: #FFF5F4; border: 1.5px dashed #D9656B; border-radius: 12px; font-size: 30px; font-weight: 800; letter-spacing: 8px; color: #5C3B28;'>
                ${escapeHtml(otpCode)}
            </div>
            <div style='font-size: 12px; color: #8C7A70; margin-top: 8px;'>This temporary code is valid for 10 minutes.</div>
        </div>

        <p style='font-size: 12.5px; line-height: 1.5; color: #8C7A70;'>
            <b>Security Reminder:</b> If you did not request this verification code, please ignore this email. Milky Marble staff will never ask for your code.
        </p>`;

        await transporter.sendMail({
            from: DEFAULT_FROM,
            to: `"${recipientName || 'Valued Customer'}" <${toEmail}>`,
            replyTo: DEFAULT_REPLY_TO,
            subject: `${otpCode} is your Milky Marble security verification code`,
            html: renderEmailLayout('Security · Verification', 'Account Verification', bodyContent),
            text: `Hello ${recipientName},\n\nYour Milky Marble security verification code is: ${otpCode}\nValid for 10 minutes. For assistance, chat with @Milky Marble on IG, FB, or TikTok.`
        });

        return true;
    } catch (err) {
        console.error('Nodemailer OTP Error:', err.message);
        return false;
    }
}

// -------------------------------------------------------------
// ORDER STATUS DISPATCHER
// -------------------------------------------------------------
async function dispatchOrderStatusEmail(toEmail, recipientName, orderRef, status, pickupSchedule = '', extraOrderData = {}) {
    const cleanStatus = (status || '').toUpperCase().trim();

    switch (cleanStatus) {
        case 'CONFIRMED':
        case 'PENDING_PAYMENT':
        case 'PAID_VERIFIED':
            return extraOrderData?.items?.length ? await sendOrderConfirmedEmail(toEmail, recipientName, extraOrderData) : true;
        case 'PREPARING':
            return await sendOrderPreparingEmail(toEmail, recipientName, orderRef);
        case 'READY_FOR_PICKUP':
        case 'READY FOR PICKUP':
            return await sendOrderReadyEmail(toEmail, recipientName, orderRef, pickupSchedule);
        case 'COMPLETED':
            return await sendOrderCompletedEmail(toEmail, recipientName, orderRef);
        case 'CANCELLED':
            return await sendOrderCancelledEmail(toEmail, recipientName, orderRef);
        default:
            return false;
    }
}

module.exports = {
    renderEmailLayout,
    sendOrderConfirmedEmail,
    sendOrderPreparingEmail,
    sendOrderReadyEmail,
    sendOrderCompletedEmail,
    sendOrderCancelledEmail,
    sendPromoWelcomeEmail,
    sendSecurityOtpEmail,
    dispatchOrderStatusEmail
};