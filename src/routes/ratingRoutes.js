// src/routes/ratingRoutes.js
const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');

/**
 * GET /api/ratings
 * Kumukuha ng lahat ng reviews at kinalkulang average score para sa isang specific drink.
 * Dating api_get_ratings.php
 */
router.get('/', async (req, res) => {
  const productTitle = (req.query.title || '').trim();

  // Validation: Siguraduhing may ipinasang title
  if (!productTitle) {
    return res.status(400).json({
      status: 'error',
      message: 'Product title required.'
    });
  }

  try {
    // 1. Linisin ang title (alisin ang mga size tags tulad ng '8oz' o '12oz' para sa matching)
    const cleanTitle = productTitle
      .replace(/\s*\((8oz|12oz)\)/gi, '')
      .replace(/^(8oz|12oz)\s*/gi, '')
      .trim();

    // 2. Query sa Supabase ratings table kasama ang relational join sa customers at users
    const { data: rawReviews, error } = await supabase
      .from('ratings')
      .select(`
        id,
        order_id,
        customer_id,
        product_title,
        rating_score,
        experience_tags,
        review_text,
        created_at,
        customers (
          users (
            username,
            full_name,
            avatar
          )
        )
      `)
      .ilike('product_title', `%${cleanTitle}%`)
      .order('created_at', { ascending: false });

    if (error) throw error;

    // 3. I-format ang array at tukuyin ang reviewer name
    const reviews = (rawReviews || []).map(rev => {
      const user = rev.customers?.users;
      const reviewerName = user?.username || user?.full_name || 'Marble Sips Fan';

      let reviewerAvatar = user?.avatar || '/customer/images/account.png';
      if (!reviewerAvatar.startsWith('http') && !reviewerAvatar.startsWith('/') && !reviewerAvatar.startsWith('data:image')) {
        reviewerAvatar = '/' + reviewerAvatar;
      }

      return {
        id: rev.id,
        order_id: rev.order_id,
        customer_id: rev.customer_id,
        product_title: rev.product_title,
        rating_score: rev.rating_score,
        experience_tags: rev.experience_tags,
        review_text: rev.review_text,
        created_at: rev.created_at,
        reviewer_name: reviewerName,
        reviewer_avatar: reviewerAvatar
      };
    });

    // 4. Kalkulahin ang total reviews at average score
    const totalReviews = reviews.length;
    const totalScore = reviews.reduce((sum, rev) => sum + Number(rev.rating_score || 0), 0);
    const averageScore = totalReviews > 0 ? (totalScore / totalReviews).toFixed(1) : '0.0';

    return res.json({
      status: 'success',
      average_score: averageScore,
      total_reviews: totalReviews,
      reviews: reviews
    });

  } catch (error) {
    console.error('Error fetching ratings:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Database error: ' + error.message
    });
  }
});

/**
 * POST /api/ratings
 * Nagsusumite at nagse-save ng bagong product review at star rating sa Supabase.
 * Dating api_rating.php
 */
router.post('/', async (req, res) => {
  try {
    // 1. Session / Identity Verification
    const customerId = req.session?.customer_id || req.user?.customer_id || req.body.customer_id;

    if (!customerId) {
      return res.status(401).json({
        status: 'error',
        message: 'Please log in to submit a rating.'
      });
    }

    const { order_id, product_title, rating_score, tags, review_text } = req.body;

    // 2. Sanitize at i-validate ang mga inputs
    const orderId = order_id ? parseInt(order_id, 10) : null;
    const title = (product_title || 'Milky Marble Cup').trim();
    const parsedScore = parseInt(rating_score, 10) || 5;
    const score = Math.max(1, Math.min(5, parsedScore));

    let experienceTags = '';
    if (Array.isArray(tags)) {
      experienceTags = tags.join(', ');
    } else if (typeof tags === 'string') {
      experienceTags = tags.trim();
    }

    const review = (review_text || '').trim();

    // 3. I-insert ang record sa Supabase 'ratings' table
    const { data, error } = await supabase
      .from('ratings')
      .insert([
        {
          order_id: orderId,
          customer_id: customerId,
          product_title: title,
          rating_score: score,
          experience_tags: experienceTags,
          review_text: review
        }
      ])
      .select();

    if (error) throw error;

    return res.json({
      status: 'success',
      message: `Thank you! Your ${score}-star review has been saved.`
    });

  } catch (error) {
    console.error('Rating submission error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Database error: ' + error.message
    });
  }
});

module.exports = router;