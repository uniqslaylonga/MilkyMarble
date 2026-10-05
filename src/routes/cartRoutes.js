const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');

// Sort and normalize toppings for matching
function normalizeToppings(toppings) {
  if (!toppings) return '';
  let list = [];
  if (Array.isArray(toppings)) {
    list = toppings.map(t => String(t).trim()).filter(Boolean);
  } else if (typeof toppings === 'string') {
    list = toppings.split(',').map(t => t.trim()).filter(Boolean);
  }
  list.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  return list.join(', ');
}

// Main cart action handler
router.post('/', async (req, res) => {
  const { action, item, id, quantity, customer_id } = req.body;

  if (!action) {
    return res.status(400).json({ status: 'error', message: 'Invalid request data' });
  }

  // Determine user identity from session or request payload
  const customerId = req.session?.customer_id || req.user?.customer_id || customer_id || null;
  const isLoggedIn = !!customerId;

  try {
    // Action 1: Add item to cart
    if (action === 'add') {
      if (!item) {
        return res.status(400).json({ status: 'error', message: 'Item details missing' });
      }

      const addQty = Math.max(1, parseInt(item.quantity, 10) || 1);
      const normalizedNewToppings = normalizeToppings(item.toppings);
      const itemTitle = (item.title || '').trim();
      const itemSize = (item.size || '').trim();
      const itemFlavor = (item.flavor || '').trim();
      const itemVariation = (item.variation || '').trim();

      if (isLoggedIn) {
        // Find existing cart items for the customer
        const { data: existingRows, error: fetchErr } = await supabase
          .from('cart_items')
          .select('id, quantity, toppings')
          .eq('customer_id', customerId)
          .eq('title', itemTitle)
          .eq('size', itemSize)
          .eq('flavor', itemFlavor)
          .eq('variation', itemVariation);

        if (fetchErr) throw fetchErr;

        let matchedRowId = null;
        let matchedCurrentQty = 0;

        // Check for matching toppings
        if (existingRows && existingRows.length > 0) {
          for (const row of existingRows) {
            const rowNormalized = normalizeToppings(row.toppings);
            if (rowNormalized.toLowerCase() === normalizedNewToppings.toLowerCase()) {
              matchedRowId = row.id;
              matchedCurrentQty = parseInt(row.quantity, 10) || 0;
              break;
            }
          }
        }

        if (matchedRowId !== null) {
          // Increment quantity and update timestamp to bring to top
          const newQty = matchedCurrentQty + addQty;
          const { error: updateErr } = await supabase
            .from('cart_items')
            .update({
              quantity: newQty,
              is_selected: true,
              created_at: new Date().toISOString()
            })
            .eq('id', matchedRowId)
            .eq('customer_id', customerId);

          if (updateErr) throw updateErr;
        } else {
          // Insert new cart item
          const { error: insertErr } = await supabase
            .from('cart_items')
            .insert([
              {
                customer_id: customerId,
                title: itemTitle,
                size: itemSize,
                flavor: itemFlavor,
                variation: itemVariation,
                toppings: normalizedNewToppings,
                unit_price: parseFloat(item.unit_price) || 0,
                quantity: addQty,
                is_selected: true,
                accent_color: item.accent_color || '#664638',
                image: item.image || 'images/Bubbly Coffee Jelly.png',
                created_at: new Date().toISOString()
              }
            ]);

          if (insertErr) throw insertErr;
        }
      } else {
        // Manage guest session cart
        if (!req.session) req.session = {};
        if (!req.session.guest_cart) req.session.guest_cart = [];

        let existingGuestIndex = -1;

        for (let i = 0; i < req.session.guest_cart.length; i++) {
          const gItem = req.session.guest_cart[i];
          const gToppings = normalizeToppings(gItem.toppings);

          if (
            (gItem.title || '').trim().toLowerCase() === itemTitle.toLowerCase() &&
            (gItem.size || '').trim().toLowerCase() === itemSize.toLowerCase() &&
            (gItem.flavor || '').trim().toLowerCase() === itemFlavor.toLowerCase() &&
            (gItem.variation || '').trim().toLowerCase() === itemVariation.toLowerCase() &&
            gToppings.toLowerCase() === normalizedNewToppings.toLowerCase()
          ) {
            existingGuestIndex = i;
            break;
          }
        }

        if (existingGuestIndex !== -1) {
          const matchedItem = req.session.guest_cart[existingGuestIndex];
          matchedItem.quantity = (parseInt(matchedItem.quantity, 10) || 0) + addQty;
          matchedItem.selected = true;

          req.session.guest_cart.splice(existingGuestIndex, 1);
          req.session.guest_cart.unshift(matchedItem);
        } else {
          const newItem = {
            id: 'guest_' + Date.now() + Math.random().toString(36).substring(2, 7),
            title: itemTitle,
            size: itemSize,
            flavor: itemFlavor,
            variation: itemVariation,
            toppings: normalizedNewToppings ? normalizedNewToppings.split(', ') : [],
            unit_price: parseFloat(item.unit_price) || 0,
            quantity: addQty,
            selected: true,
            accent_color: item.accent_color || '#664638',
            image: item.image || 'images/Bubbly Coffee Jelly.png'
          };

          req.session.guest_cart.unshift(newItem);
        }
      }

      return res.json({ status: 'success', message: 'Added to cart!' });
    }

    // Action 2: Update item quantity
    if (action === 'update_qty') {
      const itemId = id;
      const newQty = Math.max(1, parseInt(quantity, 10) || 1);

      if (isLoggedIn) {
        const { error: updateErr } = await supabase
          .from('cart_items')
          .update({
            quantity: newQty,
            created_at: new Date().toISOString()
          })
          .eq('id', parseInt(itemId, 10))
          .eq('customer_id', customerId);

        if (updateErr) throw updateErr;
      } else {
        if (req.session?.guest_cart) {
          const foundIndex = req.session.guest_cart.findIndex(
            gItem => String(gItem.id) === String(itemId)
          );

          if (foundIndex !== -1) {
            const matchedItem = req.session.guest_cart[foundIndex];
            matchedItem.quantity = newQty;

            req.session.guest_cart.splice(foundIndex, 1);
            req.session.guest_cart.unshift(matchedItem);
          }
        }
      }

      return res.json({ status: 'success' });
    }

    // Action 3: Delete item from cart
    if (action === 'delete') {
      const itemId = id;

      if (isLoggedIn) {
        const { error: deleteErr } = await supabase
          .from('cart_items')
          .delete()
          .eq('id', parseInt(itemId, 10))
          .eq('customer_id', customerId);

        if (deleteErr) throw deleteErr;
      } else {
        if (req.session?.guest_cart) {
          req.session.guest_cart = req.session.guest_cart.filter(
            gItem => String(gItem.id) !== String(itemId)
          );
        }
      }

      return res.json({ status: 'success' });
    }

    return res.status(400).json({ status: 'error', message: 'Unrecognized action' });

  } catch (err) {
    console.error('Cart operation error:', err);
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

// GET /api/cart/count (Badge counter sa navbar)
router.get('/count', async (req, res) => {
  try {
    const customerId = req.session?.customer_id || req.query.customer_id;
    if (!customerId) return res.json({ count: 0 });

    const { count, error } = await supabase
      .from('cart_items')
      .select('*', { count: 'exact', head: true })
      .eq('customer_id', customerId);

    if (error) throw error;
    res.json({ count: count || 0 });
  } catch (err) {
    res.status(500).json({ count: 0 });
  }
});

module.exports = router;