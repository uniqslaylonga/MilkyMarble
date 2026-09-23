// Fetch order record from Express backend and display modal details
async function fetchAndOpenOrder(orderId) {
  try {
    const response = await fetch(`/api/orders/${orderId}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch order (Status: ${response.status})`);
    }

    const order = await response.json();
    openOrderDetailsModal(order);
  } catch (error) {
    console.error('Error retrieving order details:', error);
    if (typeof Swal !== 'undefined') {
      Swal.fire({
        title: 'Error',
        text: 'Could not load order details. Please try again.',
        icon: 'error'
      });
    } else {
      alert('Could not load order details. Please try again.');
    }
  }
}

// Populate and display order tracker modal
function openOrderDetailsModal(order) {
  if (!order) return;

  // Order reference header
  const orderRefEl = document.getElementById('detailOrderRef');
  if (orderRefEl) {
    orderRefEl.innerText = order.order_ref || `#MM-${order.id}`;
  }

  // Status badge styling
  const badgeEl = document.getElementById('detailStatusBadge');
  if (badgeEl) {
    badgeEl.innerText = order.status || 'Confirmed';
    const normalizedStatus = (order.status || 'confirmed').toLowerCase().replace(/\s+/g, '-');
    badgeEl.className = `order-status-badge status-${normalizedStatus}`;
  }

  // Stepper progress indicator width
  const progressMap = {
    'Completed': 100,
    'Ready for Pick-up': 75,
    'Ready for Pickup': 75,
    'Preparing': 50,
    'Confirmed': 25
  };
  const calculatedProgress = order.step_progress || progressMap[order.status] || 25;
  const progressBarEl = document.getElementById('detailProgressBar');
  if (progressBarEl) {
    progressBarEl.style.width = `${calculatedProgress}%`;
  }

  // Customer and pickup schedule info
  const pickupDateEl = document.getElementById('detailPickupDate');
  const recipientEl = document.getElementById('detailRecipient');
  const paymentMethodEl = document.getElementById('detailPaymentMethod');

  if (pickupDateEl) pickupDateEl.innerText = order.pickup_date || 'Standard Pick-up';
  if (recipientEl) {
    const emailPart = order.recipient_email ? ` (${order.recipient_email})` : '';
    recipientEl.innerText = (order.recipient_name || 'Customer') + emailPart;
  }
  if (paymentMethodEl) paymentMethodEl.innerText = order.payment_method || 'Cash on Pick-Up';

  // Render order line item cards
  const listContainer = document.getElementById('detailCupsList');
  if (listContainer) {
    listContainer.innerHTML = '';

    const items = (order.items && order.items.length > 0) ? order.items : [{
      title: order.title || 'Item',
      size: order.size || '',
      is_custom: order.is_custom || false,
      image: order.image || order.flavor_img || 'images/Bubbly Coffee Jelly.png',
      flavor_img: order.flavor_img || order.image || 'images/Bubbly Coffee Jelly.png',
      toppings_img: order.toppings_img || '',
      cup_img: order.cup_img || 'images/Layer 3/Large Cup.png',
      accent_color: order.accent_color || '#664638',
      toppings: Array.isArray(order.toppings) ? (order.toppings.length ? '+ ' + order.toppings.join(' + ') : '') : (order.toppings || ''),
      addons: order.addons ? `+ ${order.addons}` : '',
      unit_price: order.unit_price || order.total_price || 0,
      quantity: order.quantity || 1
    }];

    items.forEach(item => {
      const quantity = item.quantity || 1;
      const unitPrice = item.unit_price || 0;
      const lineTotal = unitPrice * quantity;

      const isSmall = (item.size === '8oz');
      const cupImgPath = item.cup_img || (isSmall ? 'images/Layer 3/Small Cup.png' : 'images/Layer 3/Large Cup.png');
      const flavorImgPath = item.flavor_img || item.image || 'images/Bubbly Coffee Jelly.png';

      let thumbHTML = '';
      if (item.is_custom) {
        thumbHTML = `
          <div class="composite-cart-thumb summary-composite-thumb order-details-composite-thumb">
            <img src="${flavorImgPath}" class="cart-layer-flavor" alt="Flavor" onerror="this.style.display='none'">
            ${item.toppings_img ? `<img src="${item.toppings_img}" alt="Toppings" class="cart-layer-toppings" onerror="this.style.display='none'">` : ''}
            <img src="${cupImgPath}" class="cart-layer-cup" alt="Cup">
          </div>
        `;
      } else {
        thumbHTML = `<img src="${item.image || flavorImgPath}" alt="${item.title}" class="order-details-single-img">`;
      }

      const itemHTML = `
        <div class="summary-cup-row">
          <div class="summary-cup-thumb" style="--thumb-accent: ${item.accent_color || order.accent_color || '#664638'};">
            ${thumbHTML}
          </div>
          <div class="summary-cup-info">
            <h4 class="summary-cup-heading">${item.size ? item.size + ' ' : ''}${item.title}</h4>
            ${item.toppings ? `<div class="summary-cup-toppings">${item.toppings}</div>` : ''}
            ${item.addons ? `<div class="summary-cup-addons">${item.addons}</div>` : ''}
          </div>
          <div class="summary-cup-qty-price">
            <div class="summary-qty-pill">
              <span class="summary-qty-val">${quantity}x</span>
            </div>
            <div class="summary-item-price">₱ ${lineTotal.toFixed(2)}</div>
          </div>
        </div>
      `;

      listContainer.insertAdjacentHTML('beforeend', itemHTML);
    });
  }

  // Display total payable
  const finalTotalEl = document.getElementById('detailFinalTotal');
  if (finalTotalEl) {
    const total = Number(order.total_price || order.total_amount || 0);
    finalTotalEl.innerText = `₱ ${total.toFixed(2)}`;
  }

  // Open modal container
  const modal = document.getElementById('orderDetailsModal');
  if (modal) {
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
  }
}

// Close active modal dialog
function closeOrderDetailsModal(event) {
  const modal = document.getElementById('orderDetailsModal');
  if (modal) {
    modal.classList.remove('active');
    document.body.style.overflow = '';
  }
}

// Close modal when pressing Escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeOrderDetailsModal();
  }
});