// src/routes/customerRoutes.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

// Supabase client initialization
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
);

// 1. Siguraduhing may target upload directory
// NOTE: Vercel's serverless filesystem is read-only outside of os.tmpdir(),
// so on Vercel we fall back to a temp directory. Uploaded files there are
// NOT persistent across requests/deployments — for production, move avatar
// storage to Supabase Storage (or another object store) instead of disk.
const uploadDir = process.env.VERCEL
  ? path.join(require('os').tmpdir(), 'milky-marble-uploads')
  : path.join(__dirname, '../../public/images/uploads');
try {
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }
} catch (e) {
  console.warn('[Notice] Could not prepare upload directory:', e.message);
}

// 2. Setup Multer Storage para sa profile pictures
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const uniqueName = `avatar_${Date.now()}_${Math.random().toString(36).substring(2, 7)}${ext}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|webp|gif/;
    const isExtValid = allowed.test(path.extname(file.originalname).toLowerCase());
    const isMimeValid = allowed.test(file.mimetype);
    if (isExtValid && isMimeValid) {
      return cb(null, true);
    }
    cb(new Error('Tanging JPG, PNG, WEBP, o GIF lamang ang pinapayagan.'));
  }
});

// Helper: Alamin ang customer_id mula sa cookies o headers
function resolveCustomerId(req) {
  const cookieVal = req.cookies?.customer_id;
  if (cookieVal && cookieVal !== 'null' && cookieVal !== 'undefined') {
    const parsed = parseInt(cookieVal, 10);
    if (!isNaN(parsed)) return parsed;
  }
  const headerVal = req.headers['x-customer-id'] || req.query.customer_id || req.body?.customer_id;
  if (headerVal && headerVal !== 'null' && headerVal !== 'undefined') {
    const parsed = parseInt(headerVal, 10);
    return isNaN(parsed) ? null : parsed;
  }
  return null;
}

// GET /api/customer/profile (Kino-connect ang customers at users table)
router.get('/profile', async (req, res) => {
  try {
    const customerId = resolveCustomerId(req);
    const userIdCookie = req.cookies?.user_id;

    let query = supabase
      .from('customers')
      .select(`
        id,
        user_id,
        loyalty_points,
        phone,
        users:user_id (
          id,
          username,
          full_name,
          email,
          avatar
        )
      `);

    if (customerId) {
      query = query.or(`id.eq.${customerId},user_id.eq.${customerId}`);
    } else if (userIdCookie) {
      query = query.eq('user_id', parseInt(userIdCookie, 10));
    } else {
      return res.status(400).json({ status: 'error', message: 'Customer ID is required.' });
    }

    const { data: customer, error } = await query.maybeSingle();

    if (error || !customer) {
      return res.status(404).json({
        status: 'error',
        message: 'Customer record not found.'
      });
    }

    const pointsNum = parseFloat(customer.loyalty_points || 0);
    const userRec = customer.users || {};

    const profileData = {
      id: customer.id,
      customer_id: customer.id,
      user_id: customer.user_id,
      loyalty_points: pointsNum,
      loyalty_points_formatted: `${pointsNum.toFixed(1)} pts`,
      loyalty_peso_value: `₱${pointsNum.toFixed(2)}`,
      phone: customer.phone || '',
      phone_number: customer.phone || '',
      full_name: userRec.full_name || '',
      username: userRec.username || '',
      email: userRec.email || '',
      avatar: userRec.avatar || '/customer/images/account.png',
      users: userRec
    };

    return res.json({
      status: 'success',
      data: profileData,
      customer: profileData
    });
  } catch (err) {
    console.error('Customer profile fetch error:', err);
    return res.status(500).json({ status: 'error', message: 'Server error loading profile.' });
  }
});

// POST /api/customer/profile/upload (Ina-update ang avatar sa users table)
router.post('/profile/upload', upload.single('profile_picture'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ status: 'error', message: 'No file uploaded.' });
    }

    const avatarUrl = `/images/uploads/${req.file.filename}`;
    let targetUserId = req.body.user_id || req.cookies?.user_id;
    const targetCustomerId = req.body.customer_id || resolveCustomerId(req);

    // Kung walang direct user_id, kunin mula sa customers table
    if (!targetUserId && targetCustomerId) {
      const { data: custData } = await supabase
        .from('customers')
        .select('user_id')
        .or(`id.eq.${targetCustomerId},user_id.eq.${targetCustomerId}`)
        .maybeSingle();

      if (custData && custData.user_id) {
        targetUserId = custData.user_id;
      }
    }

    if (!targetUserId) {
      return res.status(400).json({
        status: 'error',
        message: 'Could not identify target user record.'
      });
    }

    // UPDATE DIREKTA SA USERS TABLE
    const { data: updatedUser, error: updateErr } = await supabase
      .from('users')
      .update({ avatar: avatarUrl })
      .eq('id', targetUserId)
      .select('id, full_name, username, email, avatar')
      .single();

    if (updateErr) {
      console.error('Database update error on users table:', updateErr);
      return res.status(500).json({ status: 'error', message: updateErr.message });
    }

    return res.json({
      status: 'success',
      message: 'Avatar saved to users table successfully!',
      avatar: avatarUrl,
      user: updatedUser
    });
  } catch (err) {
    console.error('Upload route error:', err);
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

// PUT /api/customer/profile (Ina-update ang details sa users at customers table)
router.put('/profile', async (req, res) => {
  try {
    const customerId = resolveCustomerId(req);
    const { full_name, username, phone_number, phone, avatar } = req.body;

    if (!customerId) {
      return res.status(400).json({ status: 'error', message: 'Customer ID is required.' });
    }

    const { data: customer } = await supabase
      .from('customers')
      .select('id, user_id')
      .or(`id.eq.${customerId},user_id.eq.${customerId}`)
      .maybeSingle();

    if (!customer) {
      return res.status(404).json({ status: 'error', message: 'Customer record not found.' });
    }

    const userPayload = {};
    if (full_name !== undefined) userPayload.full_name = full_name;
    if (username !== undefined) userPayload.username = username;
    if (avatar !== undefined) userPayload.avatar = avatar;

    if (Object.keys(userPayload).length > 0) {
      const { error: userErr } = await supabase
        .from('users')
        .update(userPayload)
        .eq('id', customer.user_id);

      if (userErr) return res.status(400).json({ status: 'error', message: userErr.message });
    }

    const rawPhone = phone !== undefined ? phone : phone_number;
    if (rawPhone !== undefined) {
      const cleanPhone = rawPhone ? rawPhone.toString().replace(/[^0-9]/g, '') : null;
      await supabase
        .from('customers')
        .update({ phone: cleanPhone })
        .eq('id', customer.id);
    }

    return res.json({
      status: 'success',
      message: 'Profile details updated successfully.'
    });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

module.exports = router;