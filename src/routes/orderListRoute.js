const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');

// Inisyalisasyon ng Supabase client gamit ang environment variables
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

// Helper function para gawing malinis na Title Case ang anumang status
function cleanStatusFormat(rawStatus) {
  if (!rawStatus) return 'In Progress';

  const statusKey = String(rawStatus).toUpperCase().trim();

  const statusMap = {
    'READY_FOR_PICKUP': 'Ready for Pickup',
    'PREPARING': 'In Progress',
    'COMPLETED': 'Completed',
    'CONFIRMED': 'Confirmed',
    'PAID_VERIFIED': 'Payment Verified',
    'PENDING_PAYMENT': 'Pending Payment',
    'CANCELLED': 'Cancelled'
  };

  if (statusMap[statusKey]) {
    return statusMap[statusKey];
  }

  // Fallback: paghiwalayin ang underscores o camelCase at gawing Title Case
  return statusKey
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, char => char.toUpperCase());
}

router.get('/api/production-supervisor/order-list', async (req, res) => {
  try {
    const currentUserId = req.headers['x-user-id'];

    // 1. Kunin ang detalye ng naka-login na Supervisor
    let currentUser = {
      fullName: 'Production Supervisor',
      avatarSrc: '/customer/images/account.png'
    };

    if (currentUserId) {
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('full_name, avatar')
        .eq('id', currentUserId)
        .single();

      if (!userError && userData) {
        currentUser.fullName = userData.full_name || 'Production Supervisor';
        currentUser.avatarSrc = userData.avatar || '/customer/images/account.png';
      }
    }

    // 2. Kunin ang active orders mula sa Supabase kasama ang customer at items
    const { data: dbOrders, error: ordersError } = await supabase
      .from('orders')
      .select(`
        id,
        order_number,
        order_type,
        status,
        pickup_instructions,
        placed_at,
        guest_name,
        customer:customers (
          user:users (
            full_name
          )
        ),
        order_items (
          id,
          item_label,
          quantity,
          custom_details,
          toppings,
          size
        )
      `)
      .neq('status', 'CANCELLED')
      .order('placed_at', { ascending: false });

    if (ordersError) throw ordersError;

    // 3. Bilangin ang KPIs at i-format ang bawat order
    let pendingCount = 0;
    let inProgressCount = 0;
    let readyCount = 0;
    let completedCount = 0;

    const formattedOrdersList = (dbOrders || []).map(order => {
      const rawStatus = (order.status || '').toUpperCase();

      if (['PENDING_PAYMENT', 'PAID_VERIFIED', 'CONFIRMED'].includes(rawStatus)) {
        pendingCount++;
      } else if (rawStatus === 'PREPARING') {
        inProgressCount++;
      } else if (rawStatus === 'READY_FOR_PICKUP') {
        readyCount++;
      } else if (rawStatus === 'COMPLETED') {
        completedCount++;
      }

      // Customer name resolver
      const customerName = order.customer?.user?.full_name || order.guest_name || 'Walk-in Customer';

      // Type mapping
      const type = order.order_type === 'preset' ? 'preset' : 'preorder';

      // Clean Label & Class mapping
      const statusLabel = cleanStatusFormat(rawStatus);
      let statusClass = 'inprep';

      if (rawStatus === 'READY_FOR_PICKUP') {
        statusClass = 'ready';
      } else if (rawStatus === 'COMPLETED') {
        statusClass = 'completed';
      } else if (['PENDING_PAYMENT', 'PAID_VERIFIED', 'CONFIRMED'].includes(rawStatus)) {
        statusClass = 'pending';
      } else {
        statusClass = 'inprep';
      }

      // Items at custom specs
      const primaryItem = order.order_items?.[0] || {};
      const cleanTitle = primaryItem.item_label || 'Custom Drink';
      const specs = primaryItem.custom_details || primaryItem.toppings || 'Standard Recipe';
      const totalQty = (order.order_items || []).reduce((acc, curr) => acc + (curr.quantity || 1), 0) || 1;

      return {
        id: order.id,
        order_number: order.order_number,
        customer_name: customerName,
        type: type,
        cleanTitle: cleanTitle,
        specs: specs,
        quantity: totalQty,
        claim_slot: order.pickup_instructions || 'Counter Release',
        shelf_tag: 'Chiller Section',
        status: rawStatus,
        statusLabel: statusLabel,
        statusClass: statusClass
      };
    });

    // 4. Kunin ang Walk-in Preset Batch data para sa kasalukuyang araw
    const today = new Date().toISOString().split('T')[0];
    const { data: batchesData, error: batchesError } = await supabase
      .from('preset_batches')
      .select('id, batch_date, item_label, prepared_qty')
      .eq('batch_date', today);

    if (batchesError) throw batchesError;

    // Kunin ang yield servings mula sa recipes table
    const { data: recipesData } = await supabase
      .from('recipes')
      .select('flavor_name, yield_servings');

    const recipeYieldMap = {};
    (recipesData || []).forEach(r => {
      recipeYieldMap[r.flavor_name] = r.yield_servings;
    });

    const presetCards = (batchesData || []).map(batch => {
      const target = recipeYieldMap[batch.item_label] || 30;
      return {
        id: batch.id,
        name: batch.item_label,
        sealed_count: batch.prepared_qty,
        target_batch: target,
        specs: 'Standard Recipe Batch',
        chiller_rack: 'Main Chiller Rack'
      };
    });

    res.json({
      user: currentUser,
      kpis: {
        pendingCount,
        inProgressCount,
        readyCount,
        completedCount
      },
      ordersList: formattedOrdersList,
      presetCards: presetCards
    });

  } catch (error) {
    console.error('Error loading order list:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
});

module.exports = router;