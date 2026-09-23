// src/routes/promoRoutes.js
const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');

// POST /api/promo/apply
router.post('/apply', async (req, res) => {
  try {
    const code = (req.body.code || '').trim().toUpperCase();
    const subtotal = parseFloat(req.body.subtotal || 0);

    if (!code) {
      return res.status(400).json({
        status: 'error',
        message: 'Please enter a promotion code.'
      });
    }

    // 1. Suriin sa Supabase promotions table
    try {
      const { data: promo, error } = await supabase
        .from('promotions')
        .select('*')
        .eq('code', code)
        .eq('status', 'ACTIVE')
        .maybeSingle();

      if (!error && promo) {
        const discountType = promo.discount_type;
        const discountVal = parseFloat(promo.discount_value || 0);
        let discountAmount = 0;

        if (discountType === 'percent') {
          discountAmount = subtotal * (discountVal / 100);
        } else {
          discountAmount = Math.min(discountVal, subtotal);
        }

        return res.json({
          status: 'success',
          code: promo.code,
          title: promo.title || promo.code,
          discount_amount: Math.round(discountAmount * 100) / 100,
          message: `Promotion '${promo.code}' applied!`
        });
      }
    } catch (dbErr) {
      // Fallback sa static promo codes kung walang promotions table
    }

    // 2. Static Fallback Promo Codes
    const promoMap = {
      'MILKY10': { discount: 10.00, message: '₱10.00 discount applied!' },
      'MARBLE20': { discount: 20.00, message: '₱20.00 discount applied!' },
      'SWEETSIP': { discount: subtotal * 0.10, message: '10% discount applied!' }
    };

    if (promoMap[code]) {
      return res.json({
        status: 'success',
        code: code,
        discount_amount: Math.round(promoMap[code].discount * 100) / 100,
        message: promoMap[code].message
      });
    }

    return res.status(400).json({
      status: 'error',
      message: 'Invalid or expired promotion code.'
    });

  } catch (err) {
    return res.status(500).json({
      status: 'error',
      message: `Server error: ${err.message}`
    });
  }
});

module.exports = router;