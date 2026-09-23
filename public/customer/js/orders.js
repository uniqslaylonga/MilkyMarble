// public/customer/js/orders.js

let allOrdersList = [];
let activeStatusFilter = 'all';
let currentSearchQuery = '';

// Rating State Variables
let currentRatingOrder = null;
let currentScore = 5;
let activeRatingTags = ['Extra Chewy Jelly', 'Perfect Sweetness'];

const ratingDescriptions = {
  1: '1.0 - Needs Improvement',
  2: '2.0 - Fair Sip',
  3: '3.0 - Good Sips!',
  4: '4.0 - Really Sweet & Creamy!',
  5: '5.0 - Super Creamy & Bouncy!'
};

document.addEventListener('DOMContentLoaded', () => {
  loadOrders();

  // Search Listeners (Input typing, Enter key, Search Button)
  const searchInput = document.getElementById('globalNavSearchInput');
  const searchBtn = document.getElementById('globalNavSearchBtn');

  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      window.filterOrdersList(e.target.value);
    });
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        window.filterOrdersList(searchInput.value);
      }
    });
  }

  if (searchBtn && searchInput) {
    searchBtn.addEventListener('click', () => {
      window.filterOrdersList(searchInput.value);
    });
  }
});

function getOrdersContainer() {
  return document.getElementById('ordersList') || document.getElementById('ordersListContainer');
}

function cleanItemTitle(rawLabel) {
  if (!rawLabel) return 'Custom Marble Cup';
  let clean = rawLabel
    .replace(/\s*\(\+.*?\)/g, '')
    .replace(/\s*\[\+.*?\]/g, '')
    .replace(/\s*\((8oz|12oz)\)/gi, '')
    .replace(/^(8oz|12oz)\s*/gi, '')
    .replace(/\s*\(.*?\)/g, '')
    .replace(/\s*\[.*?\]/g, '');
  return clean.replace(/\($/, '').trim() || rawLabel;
}

function resolveOrderAssets(cleanTitle, size, toppingsStr) {
  const cleanLower = (cleanTitle || '').toLowerCase();
  const isLarge = (size !== '8oz');
  const folderSize = isLarge ? 'Large' : 'Small';

  const presets = {
    'chocolatey coffee noodly jelly': { image: 'images/Chocolatey Coffee Noodly Jelly.png', accent: '#664638' },
    'cheesy pandan cubes': { image: 'images/Cheesy Pandan Cubes.png', accent: '#8bb35c' },
    'bubbly coffee jelly': { image: 'images/Bubbly Coffee Jelly.png', accent: '#664638' },
    'strawberry string party': { image: 'images/Strawberry String Party.png', accent: '#f48a8e' }
  };

  for (const [pName, pData] of Object.entries(presets)) {
    if (cleanLower.includes(pName)) {
      return {
        is_custom: false,
        image: pData.image,
        flavor_img: pData.image,
        toppings_img: '',
        cup_img: '',
        accent_color: pData.accent
      };
    }
  }

  let flavor = 'Pandan';
  let accent = '#8bb35c';
  if (cleanLower.includes('strawberry')) {
    flavor = 'Strawberry';
    accent = '#f48a8e';
  } else if (cleanLower.includes('coffee')) {
    flavor = 'Coffee';
    accent = '#664638';
  }

  let jelly = 'cube';
  if (cleanLower.includes('spaghetti') || cleanLower.includes('string')) {
    jelly = 'spaghetti';
  } else if (cleanLower.includes('whole')) {
    jelly = 'whole';
  }

  const l1Path = `images/Layer 1/${folderSize} Flavors/${flavor} ${jelly}.png`;
  const l3Path = isLarge ? 'images/Layer 3/Large Cup.png' : 'images/Layer 3/Small Cup.png';

  let l2Path = '';
  const topLower = (toppingsStr || '').toLowerCase();
  const toppingMap = {
    'cheese': 'Cheese',
    'tapioca': 'Tapioca',
    'marshmallow': 'Mashmallow',
    'nuts': 'Nuts',
    'assorted sprinkles': 'Assorted Sprinkles',
    'choco sprinkles': 'Choco Sprinkles',
    'sprinkles': 'Assorted Sprinkles',
    'choco chips': 'Choco Chips',
    'chocolate chip': 'Choco Chips'
  };

  for (const [kw, fileBase] of Object.entries(toppingMap)) {
    if (topLower.includes(kw)) {
      l2Path = `images/Layer 2/${folderSize} Toppings/${fileBase}.png`;
      break;
    }
  }

  return {
    is_custom: true,
    image: l1Path,
    flavor_img: l1Path,
    toppings_img: l2Path,
    cup_img: l3Path,
    accent_color: accent
  };
}

// Prefer the real layer images/flags saved on the order item itself
// (once the backend persists them); only fall back to guessing them
// from the title/toppings text for older orders placed before that
// data was saved.
function resolveDisplayAssets(item, cleanTitle, size, toppingsStr) {
  const hasResolvedLayers = item && (item.flavor_img || item.toppings_img || item.cup_img);
  if (hasResolvedLayers) {
    let accent = '#8bb35c';
    const cl = (cleanTitle || '').toLowerCase();
    if (cl.includes('strawberry')) accent = '#f48a8e';
    else if (cl.includes('coffee')) accent = '#664638';

    return {
      is_custom: !!(item.is_custom || item.custom_build || item.toppings_img),
      image: item.image || item.flavor_img,
      flavor_img: item.flavor_img || item.image,
      toppings_img: item.toppings_img || '',
      cup_img: item.cup_img || (size === '8oz' ? 'images/Layer 3/Small Cup.png' : 'images/Layer 3/Large Cup.png'),
      accent_color: item.accent_color || accent
    };
  }
  return resolveOrderAssets(cleanTitle, size, toppingsStr);
}

async function loadOrders() {
  const container = getOrdersContainer();
  const guestBox = document.getElementById('guestTrackBox');
  const registeredSection = document.getElementById('registeredOrdersSection');
  let user = JSON.parse(localStorage.getItem('mm_user') || 'null');

  // Fallback: if this browser/tab has no session in localStorage (e.g. it's
  // an in-app browser opened for PayMongo that doesn't share storage with
  // where the customer logged in), honor customer_id/user_id carried in the
  // URL instead of treating them as a guest.
  if (!user || !user.customer_id) {
    const urlCustomerId = new URLSearchParams(window.location.search).get('customer_id');
    const urlUserId = new URLSearchParams(window.location.search).get('user_id');
    if (urlCustomerId || urlUserId) {
      try {
        const lookupId = urlCustomerId || urlUserId;
        const profileRes = await fetch(`/api/customer/profile?customer_id=${encodeURIComponent(lookupId)}`, {
          credentials: 'include',
          headers: { Accept: 'application/json', 'x-customer-id': String(lookupId) }
        });
        if (profileRes.ok) {
          const profileResult = await profileRes.json();
          const cust = profileResult && (profileResult.data || profileResult.customer);
          if (cust) {
            user = {
              customer_id: cust.id,
              id: cust.id,
              user_id: cust.user_id || urlUserId,
              full_name: cust.full_name || cust.username || '',
              username: cust.username || '',
              loyalty_points: cust.loyalty_points || 0
            };
            localStorage.setItem('mm_user', JSON.stringify(user));
          }
        }
      } catch (err) {
        console.warn('Could not restore session from URL params:', err.message);
      }
    }
  }

  if (!user || !user.customer_id) {
    if (guestBox) {
      guestBox.style.display = 'block';
    }
    if (registeredSection) {
      registeredSection.style.display = 'none';
    }
    if (container && !guestBox) {
      container.innerHTML = `
        <div style="text-align: center; padding: 60px 20px; color: #777; width: 100%;">
          <i class="fa-solid fa-receipt" style="font-size: 3rem; color: #b8a69d; margin-bottom: 16px;"></i>
          <p style="font-size: 1.25rem; font-weight: 700; color: #4a3427; margin-bottom: 8px;">No transaction history</p>
          <p style="font-size: 0.95rem; margin-bottom: 20px;">You are currently browsing as a guest. Log in to track your orders!</p>
          <a href="customerlogin.html" style="display: inline-block; padding: 10px 24px; background: #664638; color: #fff; text-decoration: none; border-radius: 99px; font-weight: 600; font-size: 0.95rem;">Log In to View</a>
        </div>
      `;
    }
    return;
  }

  if (guestBox) guestBox.style.display = 'none';
  if (registeredSection) registeredSection.style.display = 'block';

  try {
    const res = await fetch(`/api/orders?customer_id=${user.customer_id}`);
    const data = await res.json();
    allOrdersList = data.orders || [];
    renderOrders(allOrdersList);
  } catch (err) {
    if (container) {
      container.innerHTML = `
        <div style="text-align: center; padding: 50px 20px; color: #777;">
          <i class="fa-solid fa-circle-exclamation" style="font-size: 2rem; color: #F48A8E; margin-bottom: 10px;"></i>
          <p style="font-weight: 700; color: #594A42;">Could not load orders. Please refresh.</p>
        </div>
      `;
    }
  }
}

// Handler para sa Guest Order Tracking Lookup Form
window.handleGuestOrderSearch = async function(event) {
  if (event) event.preventDefault();
  const orderIdInput = document.getElementById('guestOrderId');
  const emailInput = document.getElementById('guestEmail');

  const orderId = (orderIdInput?.value || '').trim().replace(/^#/, '');
  const email = (emailInput?.value || '').trim().toLowerCase();

  if (!orderId || !email) {
    if (typeof Swal !== 'undefined') {
      Swal.fire({
        icon: 'warning',
        title: 'Missing Details',
        text: 'Please enter both your Order ID and Email address.',
        confirmButtonColor: '#F48A8E',
        customClass: {
          container: 'mm-swal-container-top',
          popup: 'mm-swal-popup',
          title: 'mm-swal-title',
          confirmButton: 'mm-swal-confirm-btn'
        },
        buttonsStyling: false
      });
    } else {
      alert('Please enter both your Order ID and Email address.');
    }
    return;
  }

  const submitBtn = event?.target?.querySelector('button[type="submit"]');
  const originalBtnHTML = submitBtn ? submitBtn.innerHTML : '';
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span>Tracking...</span> <i class="fa-solid fa-spinner fa-spin"></i>';
  }

  try {
    const res = await fetch(`/api/orders/track?order_number=${encodeURIComponent(orderId)}&email=${encodeURIComponent(email)}`);
    const data = await res.json();

    if (res.ok && data.status === 'success' && data.order) {
      window.openOrderDetailsModal(data.order);
    } else {
      if (typeof Swal !== 'undefined') {
        Swal.fire({
          icon: 'error',
          title: 'Order Not Found',
          text: data.message || 'No order matched that Order ID and Email address. Please verify your details.',
          confirmButtonColor: '#F48A8E',
          customClass: {
            container: 'mm-swal-container-top',
            popup: 'mm-swal-popup',
            title: 'mm-swal-title',
            confirmButton: 'mm-swal-confirm-btn'
          },
          buttonsStyling: false
        });
      } else {
        alert(data.message || 'No order found matching those details.');
      }
    }
  } catch (err) {
    console.error('Guest tracking error:', err);
    if (typeof Swal !== 'undefined') {
      Swal.fire({
        icon: 'error',
        title: 'Connection Error',
        text: 'Could not connect to the server to check your order status.',
        confirmButtonColor: '#F48A8E',
        customClass: {
          container: 'mm-swal-container-top',
          popup: 'mm-swal-popup',
          title: 'mm-swal-title',
          confirmButton: 'mm-swal-confirm-btn'
        },
        buttonsStyling: false
      });
    }
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalBtnHTML || '<span>Track Order</span> <i class="fa-solid fa-arrow-right"></i>';
    }
  }
};

window.filterOrdersList = function(query) {
  currentSearchQuery = (query || '').toLowerCase().trim();
  renderOrders(allOrdersList);
};

function renderOrders(orders) {
  const container = getOrdersContainer();
  if (!container) return;

  const filtered = orders.filter(order => {
    let rawStatus = (order.status || 'CONFIRMED').toUpperCase().replace(/_/g, ' ');
    let uiStatus = 'Confirmed';
    if (rawStatus.includes('PENDING PAYMENT')) uiStatus = 'Awaiting Payment';
    else if (rawStatus.includes('PREP')) uiStatus = 'Preparing';
    else if (rawStatus.includes('READY')) uiStatus = 'Ready for Pickup';
    else if (rawStatus.includes('COMPLET')) uiStatus = 'Completed';
    else if (rawStatus.includes('CANCEL')) uiStatus = 'Cancelled';

    const matchesStatus = (activeStatusFilter === 'all') ||
      (uiStatus.toLowerCase() === activeStatusFilter.toLowerCase()) ||
      (order.status && order.status.toLowerCase().replace(/_/g, ' ') === activeStatusFilter.toLowerCase());

    if (!matchesStatus) return false;

    if (!currentSearchQuery) return true;

    const orderRef = (order.order_ref || order.order_number || `#MM-${order.id}`).toLowerCase();
    const rawItems = order.items || [];
    const itemsMatch = rawItems.some(it => {
      const title = (it.item_label || it.title || '').toLowerCase();
      const top = (it.toppings || '').toLowerCase();
      return title.includes(currentSearchQuery) || top.includes(currentSearchQuery);
    });
    const orderTitle = (order.title || '').toLowerCase();
    const pickupDate = (order.pickup_date || order.pickup_schedule || '').toLowerCase();

    return orderRef.includes(currentSearchQuery) ||
           itemsMatch ||
           orderTitle.includes(currentSearchQuery) ||
           uiStatus.toLowerCase().includes(currentSearchQuery) ||
           pickupDate.includes(currentSearchQuery);
  });

  if (!filtered || filtered.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 50px 20px; color: #777; width: 100%;">
        <i class="fa-solid fa-mug-saucer" style="font-size: 2.5rem; color: #b8a69d; margin-bottom: 12px; display: block;"></i>
        <div style="font-size: 1.15rem; font-weight: 700; color: #4a3427; margin-bottom: 4px;">No matching orders found</div>
        <p style="font-size: 0.9rem; color: #7C4F38; margin: 0;">Try searching for another order ID, drink flavor, or topping!</p>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(order => {
    const rawItems = order.items || [];
    const firstRaw = rawItems[0] || {};
    const rawLabel = firstRaw.item_label || firstRaw.title || order.title || 'Sweet Cup';
    
    const size = (rawLabel.toLowerCase().includes('8oz') || (firstRaw.size && firstRaw.size.toLowerCase().includes('8oz'))) ? '8oz' : '12oz';

    let toppingsStr = '';
    const topMatch = rawLabel.match(/\(\+(.*?)\)/);
    if (topMatch) toppingsStr = topMatch[1];
    else if (firstRaw.toppings) toppingsStr = firstRaw.toppings;

    const cleanTitle = cleanItemTitle(rawLabel);
    const assets = resolveDisplayAssets(firstRaw, cleanTitle, size, toppingsStr);

    let displayTitle = cleanTitle;
    if (rawItems.length > 1) {
      const otherCount = rawItems.length - 1;
      displayTitle += ` (+${otherCount} other ${otherCount > 1 ? 'cups' : 'cup'})`;
    }

    let rawStatus = (order.status || 'CONFIRMED').toUpperCase().replace(/_/g, ' ');
    let uiStatus = 'Confirmed';
    if (rawStatus.includes('PENDING PAYMENT')) uiStatus = 'Awaiting Payment';
    else if (rawStatus.includes('PREP')) uiStatus = 'Preparing';
    else if (rawStatus.includes('READY')) uiStatus = 'Ready for Pickup';
    else if (rawStatus.includes('COMPLET')) uiStatus = 'Completed';
    else if (rawStatus.includes('CANCEL')) uiStatus = 'Cancelled';

    const statusKey = uiStatus.toLowerCase();
    const statusClass = `status-${statusKey.replace(/\s+/g, '-')}`;

    const orderRef = order.order_ref || order.order_number || `#MM-${order.id}`;
    const schedule = order.pickup_date || order.pickup_schedule || 'N/A';
    const totalCupsLabel = rawItems.length === 1 ? size : `${order.total_quantity || rawItems.length} Cups Total`;
    const orderDataEncoded = encodeURIComponent(JSON.stringify(order));

    return `
      <article class="order-item-card" data-status="${statusKey}" onclick="openOrderDetailsModal('${order.id}')" style="cursor: pointer;">
        <div class="order-card-inner">
          
          <div class="order-thumb-wrapper" style="--card-thumb-bg: ${assets.accent_color};">
            ${assets.is_custom ? `
              <div class="orders-composite-thumb">
                <img src="${assets.flavor_img}" alt="Flavor Layer" class="cart-layer-flavor" onerror="this.style.display='none'">
                ${assets.toppings_img ? `<img src="${assets.toppings_img}" alt="Toppings Layer" class="cart-layer-toppings" onerror="this.style.display='none'">` : ''}
                <img src="${assets.cup_img}" alt="Cup Outline" class="cart-layer-cup">
              </div>
            ` : `
              <img src="${assets.image}" alt="${displayTitle}" class="order-thumb-img">
            `}
          </div>

          <div class="order-details-col">
            <div class="order-header-row">
              <h2 class="order-item-title">${displayTitle}</h2>
              <span class="order-status-badge ${statusClass}">
                ${uiStatus}
              </span>
            </div>

            <div class="order-meta-grid">
              <div class="order-meta-col">
                <span class="meta-label">Order ID</span>
                <div style="display: flex; align-items: center;">
                  <span class="order-ref-pill">${orderRef}</span>
                  <button type="button" class="btn-download-receipt" title="Download Order Receipt (PDF)" onclick="downloadOrderReceipt(event, '${orderDataEncoded}')">
                    <i class="fa-solid fa-file-pdf" style="font-size: 13px;"></i>
                  </button>
                </div>
              </div>

              <div class="order-meta-col">
                <span class="meta-label">Total Cups</span>
                <span class="meta-value">${totalCupsLabel}</span>
              </div>

              <div class="order-meta-col">
                <span class="meta-label">Pick-up Schedule</span>
                <span class="meta-value">${schedule}</span>
              </div>
            </div>

            <div class="order-card-footer">
              <div class="order-actions-group" onclick="event.stopPropagation()">
                ${renderOrderButtons(order.id, statusKey, orderDataEncoded)}
              </div>

              <div class="order-total-block">
                <span class="total-label">Total Price:</span>
                <span class="total-value">₱ ${parseFloat(order.total_amount || order.total_price || 0).toFixed(2)}</span>
              </div>
            </div>
          </div>

        </div>
      </article>
    `;
  }).join('');
}

function renderOrderButtons(orderId, statusKey, orderDataEncoded) {
  if (statusKey === 'confirmed' || statusKey === 'awaiting payment') {
    return `<button type="button" class="btn-action-primary" onclick="cancelOrder('${orderId}')">Cancel Order</button>`;
  } else if (statusKey === 'ready for pickup') {
    return `
      <button type="button" class="btn-action-primary" onclick="confirmOrderReceived('${orderId}')">Order Received</button>
      <button type="button" class="btn-action-secondary" onclick="saveOrderAsBuild('${orderDataEncoded}')" title="Bookmark this order to reorder later">
        <i class="fa-solid fa-bookmark"></i> Save Build
      </button>
    `;
  } else if (statusKey === 'completed') {
    return `
      <button type="button" class="btn-action-primary" onclick="reorderCup('${orderDataEncoded}')">Buy Again</button>
      <button type="button" class="btn-action-secondary" onclick="openRateModal('${orderId}')">Rate your Sips</button>
    `;
  } else if (statusKey === 'cancelled') {
    return `<button type="button" class="btn-action-primary" onclick="reorderCup('${orderDataEncoded}')">Reorder</button>`;
  }
  return '';
}

// 1. ORDER STATUS DETAILS MODAL LOGIC
window.openOrderDetailsModal = function(orderOrId) {
  let order = null;
  if (typeof orderOrId === 'object' && orderOrId !== null) {
    order = orderOrId;
  } else {
    order = allOrdersList.find(o => String(o.id) === String(orderOrId) || String(o.order_number) === String(orderOrId));
  }

  if (!order) return;

  const orderRef = order.order_ref || order.order_number || `#MM-${order.id}`;
  document.getElementById('modalOrderRef').innerText = orderRef;

  let rawStatus = (order.status || 'CONFIRMED').toUpperCase().replace(/_/g, ' ');
  let uiStatus = 'Confirmed';
  let progressPercent = 25;

  if (rawStatus.includes('PENDING PAYMENT')) {
    uiStatus = 'Awaiting Payment';
    progressPercent = 10;
  } else if (rawStatus.includes('PREP')) {
    uiStatus = 'Preparing';
    progressPercent = 50;
  } else if (rawStatus.includes('READY')) {
    uiStatus = 'Ready for Pick-up';
    progressPercent = 75;
  } else if (rawStatus.includes('COMPLET')) {
    uiStatus = 'Completed';
    progressPercent = 100;
  } else if (rawStatus.includes('CANCEL')) {
    uiStatus = 'Cancelled';
    progressPercent = 0;
  }

  document.getElementById('modalOrderStatusText').innerText = uiStatus;
  document.getElementById('modalStepperFill').style.width = `${progressPercent}%`;

  document.getElementById('modalPickupDate').innerText = order.pickup_date || order.pickup_schedule || 'N/A';

  const user = JSON.parse(localStorage.getItem('mm_user') || '{}');
  const recipientName = order.recipient_name || order.guest_name || user.full_name || user.username || 'Customer';
  const emailVal = order.recipient_email || order.guest_email || user.email;
  const recipientEmail = emailVal ? `(${emailVal})` : '';
  document.getElementById('modalRecipient').innerText = `${recipientName} ${recipientEmail}`.trim();

  let paymentMethod = order.payment_method || 'Cash on Pick-Up';
  if (order.pickup_instructions) {
    const pMatch = order.pickup_instructions.match(/Payment:\s*([^|]+)/i);
    if (pMatch) paymentMethod = pMatch[1].trim();
  }
  document.getElementById('modalPaymentMethod').innerText = paymentMethod;

  const itemsContainer = document.getElementById('modalOrderItemsList');
  const rawItems = order.items || order.order_items || [];

  if (rawItems.length > 0) {
    itemsContainer.innerHTML = rawItems.map(it => {
      const rawItemLabel = it.item_label || it.title || '';
      const cleanTitle = cleanItemTitle(rawItemLabel);
      const size = (it.size || (rawItemLabel.includes('8oz') ? '8oz' : '12oz'));
      const qty = it.quantity || 1;
      const unitPrice = parseFloat(it.unit_price || 0);
      const linePrice = (unitPrice * qty).toFixed(2);

      let toppingsStr = '';
      if (it.toppings) {
        toppingsStr = String(it.toppings).replace(/^\+\s*/, '').trim();
      } else {
        const tMatch = rawItemLabel.match(/\(\+(.*?)\)/) || rawItemLabel.match(/\((.*?)\)/);
        if (tMatch && !tMatch[1].includes('oz')) {
          toppingsStr = tMatch[1].replace(/^\+\s*/, '').trim();
        }
      }
      const addonsStr = it.addons ? String(it.addons).replace(/^\+\s*/, '').trim() : '';

      const assets = resolveDisplayAssets(it, cleanTitle, size, toppingsStr);

      return `
        <div class="status-cup-item-row">
          <div class="status-cup-thumb" style="--thumb-accent: ${assets.accent_color};">
            ${assets.is_custom ? `
              <div class="orders-composite-thumb" style="width: 44px; height: 56px;">
                <img src="${assets.flavor_img}" class="cart-layer-flavor" alt="Flavor" onerror="this.style.display='none'">
                ${assets.toppings_img ? `<img src="${assets.toppings_img}" class="cart-layer-toppings" alt="Toppings" onerror="this.style.display='none'">` : ''}
                <img src="${assets.cup_img}" class="cart-layer-cup" alt="Cup">
              </div>
            ` : `
              <img src="${assets.image}" class="status-cup-img" alt="${cleanTitle}">
            `}
          </div>
          <div class="status-cup-details">
            <h4 class="status-cup-name">${size} ${cleanTitle}</h4>
            ${toppingsStr ? `<span class="status-cup-sub">+ ${toppingsStr}</span>` : ''}
            ${addonsStr ? `<span class="status-cup-sub">+ ${addonsStr}</span>` : ''}
          </div>
          <span class="status-cup-qty">${qty}x</span>
          <span class="status-cup-price">₱ ${linePrice}</span>
        </div>
      `;
    }).join('');
  } else {
    itemsContainer.innerHTML = `
      <div class="status-cup-item-row">
        <div class="status-cup-thumb" style="--thumb-accent: #8bb35c;">
          <img src="images/logo.png" class="status-cup-img" alt="Drink">
        </div>
        <div class="status-cup-details">
          <h4 class="status-cup-name">${cleanItemTitle(order.title)}</h4>
        </div>
        <span class="status-cup-qty">1x</span>
        <span class="status-cup-price">₱ ${parseFloat(order.total_amount || 19).toFixed(2)}</span>
      </div>
    `;
  }

  document.getElementById('modalTotalPaid').innerText = `₱ ${parseFloat(order.total_amount || order.total_price || 0).toFixed(2)}`;

  const modal = document.getElementById('orderDetailsModal');
  if (modal) {
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
  }
};

window.closeOrderDetailsModal = function() {
  const modal = document.getElementById('orderDetailsModal');
  if (modal) {
    modal.classList.remove('active');
    document.body.style.overflow = '';
  }
};

// 2. RATE YOUR SIPS MODAL LOGIC
window.openRateModal = function(orderId) {
  const order = allOrdersList.find(o => String(o.id) === String(orderId));
  if (!order) return;
  currentRatingOrder = order;

  const rawItems = order.items || [];
  const firstRaw = rawItems[0] || {};
  const rawLabel = firstRaw.item_label || firstRaw.title || order.title || 'Custom Marble Cup';
  const cleanTitle = cleanItemTitle(rawLabel);
  const size = rawLabel.includes('8oz') ? '8oz' : '12oz';

  document.getElementById('rateModalDrinkName').innerText = `${size} ${cleanTitle}`;

  const assets = resolveOrderAssets(cleanTitle, size, '');
  document.getElementById('rateModalDrinkImg').src = assets.image || 'images/Cheesy Pandan Cubes.png';
  document.getElementById('rateModalThumbBox').style.setProperty('--thumb-accent', assets.accent_color || '#8bb35c');

  window.setRatingScore(5);

  const textarea = document.getElementById('ratingFeedbackText');
  if (textarea) textarea.value = '';
  document.getElementById('rateCharCounter').innerText = '0/150';

  const modal = document.getElementById('ratingModal');
  if (modal) {
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
  }
};

window.closeRateModal = function() {
  const modal = document.getElementById('ratingModal');
  if (modal) {
    modal.classList.remove('active');
    document.body.style.overflow = '';
  }
};

window.setRatingScore = function(score) {
  currentScore = score;
  const stars = document.querySelectorAll('#rateStarsContainer .star-btn');
  stars.forEach((star, index) => {
    star.classList.toggle('active', index < score);
  });

  const descEl = document.getElementById('rateScoreDescription');
  if (descEl) {
    descEl.innerText = ratingDescriptions[score] || `${score}.0`;
  }
};

window.toggleRateTag = function(btn, tagName) {
  btn.classList.toggle('active');
  if (btn.classList.contains('active')) {
    if (!activeRatingTags.includes(tagName)) activeRatingTags.push(tagName);
  } else {
    activeRatingTags = activeRatingTags.filter(t => t !== tagName);
  }
};

window.updateCharCounter = function(textarea) {
  const len = textarea.value.length;
  document.getElementById('rateCharCounter').innerText = `${len}/150`;
};

window.submitOrderRating = async function(event) {
  event.preventDefault();

  const user = JSON.parse(localStorage.getItem('mm_user') || '{}');
  if (!user.customer_id) {
    Swal.fire({ icon: 'warning', title: 'Login Required', text: 'Please log in to submit a review.' });
    return;
  }

  const reviewText = document.getElementById('ratingFeedbackText').value.trim();

  const payload = {
    order_id: currentRatingOrder ? currentRatingOrder.id : null,
    customer_id: user.customer_id,
    product_title: document.getElementById('rateModalDrinkName').innerText,
    rating_score: currentScore,
    tags: activeRatingTags,
    review_text: reviewText
  };

  try {
    const res = await fetch('/api/ratings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (data.status === 'success') {
      window.closeRateModal();
      Swal.fire({
        icon: 'success',
        title: 'Review Submitted!',
        text: 'Thank you for sharing your sweet feedback!',
        confirmButtonColor: '#F48A8E'
      });
    } else {
      Swal.fire({ icon: 'error', title: 'Submission Failed', text: data.message || 'Could not save review.' });
    }
  } catch (err) {
    window.closeRateModal();
    Swal.fire({ icon: 'success', title: 'Review Submitted!', text: 'Thank you for your sweet feedback!' });
  }
};

// 3. UTILITY ACTIONS (FILTER, REORDER, CANCEL, CLAIM, RECEIPT)
window.filterOrders = function(status, btn) {
  activeStatusFilter = status;
  document.querySelectorAll('.order-filter-pill').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderOrders(allOrdersList);
};

window.filterByStatus = window.filterOrders;

window.reorderCup = function(encodedOrder) {
  const order = JSON.parse(decodeURIComponent(encodedOrder));
  const items = (order.items && order.items.length > 0) ? order.items : [{
    title: cleanItemTitle(order.title || 'Custom Marble Cup'),
    size: order.size || '12oz',
    unit_price: parseFloat(order.total_amount || 19.00),
    quantity: 1,
    image: order.image || 'images/logo.png',
    accent_color: '#F48A8E'
  }];

  if (typeof renderOrderSummaryModal === 'function') {
    renderOrderSummaryModal(items);
  }
};

// Bookmarks this order's items as a "Saved Build" so the customer can jump
// straight to checkout with the same drink(s) later from the navbar's Saved
// Builds icon (see navbar.js). Reuses the same item-extraction as reorderCup.
window.saveOrderAsBuild = function(encodedOrder) {
  const order = JSON.parse(decodeURIComponent(encodedOrder));
  const items = (order.items && order.items.length > 0) ? order.items : [{
    title: cleanItemTitle(order.title || 'Custom Marble Cup'),
    size: order.size || '12oz',
    unit_price: parseFloat(order.total_amount || 19.00),
    quantity: 1,
    image: order.image || 'images/logo.png',
    accent_color: '#F48A8E'
  }];

  const label = items.map(i => i.title).filter(Boolean).join(', ') || 'Saved Build';
  // Snapshot of the first drink's layered image so the Saved Builds panel can
  // redraw it (flavor + toppings + cup) instead of a bare flavor thumbnail.
  // Extra toppings/add-ons are read from the item's text by resolveBuildPreview()
  // in navbar.js.
  const first = items[0] || {};
  const firstToppings = Array.isArray(first.toppings) ? first.toppings.join(' + ') : (first.toppings || '');
  const previewAssets = resolveDisplayAssets(first, cleanItemTitle(first.title || ''), first.size, firstToppings);

  const build = {
    id: 'build_' + Date.now(),
    label,
    saved_at: new Date().toISOString(),
    preview: {
      size: first.size || '12oz',
      flavor_img: previewAssets.flavor_img,
      toppings_img: previewAssets.toppings_img,
      cup_img: previewAssets.cup_img,
      accent_color: previewAssets.accent_color
    },
    items
  };

  let savedBuilds = [];
  try {
    savedBuilds = JSON.parse(localStorage.getItem('mm_saved_builds') || '[]');
  } catch (e) {
    savedBuilds = [];
  }

  savedBuilds.unshift(build);
  savedBuilds = savedBuilds.slice(0, 10); // keep only the 10 most recent saved builds
  localStorage.setItem('mm_saved_builds', JSON.stringify(savedBuilds));
  if (typeof window.refreshSavedBuildsBadge === 'function') window.refreshSavedBuildsBadge();

  if (typeof Swal !== 'undefined') {
    Swal.fire({
      toast: true,
      position: 'top-end',
      icon: 'success',
      title: 'Build saved! Find it in the bookmark icon up top.',
      showConfirmButton: false,
      timer: 2000
    });
  }
};

window.cancelOrder = function(orderId) {
  Swal.fire({
    title: 'Cancel Order?',
    text: `Are you sure you want to cancel order #${orderId}?`,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: 'Yes, Cancel It',
    cancelButtonText: 'Keep Order',
    target: document.body,
    customClass: {
      container: 'mm-swal-container-top',
      popup: 'mm-swal-popup',
      title: 'mm-swal-title',
      htmlContainer: 'mm-swal-html',
      actions: 'mm-swal-actions',
      confirmButton: 'mm-swal-confirm-btn',
      cancelButton: 'mm-swal-cancel-btn'
    },
    buttonsStyling: false,
    reverseButtons: true
  }).then(async (result) => {
    if (!result.isConfirmed) return;

    try {
      const res = await fetch(`/api/orders/${orderId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'CANCELLED' })
      });
      const data = await res.json();
   if (data.status === 'success') {
  Swal.fire({
    icon: 'success',
    title: 'Order Cancelled',
    text: 'Status has been updated.',
    target: document.body,
    customClass: {
      container: 'mm-swal-container-top',
      popup: 'mm-swal-popup',
      title: 'mm-swal-title',
      htmlContainer: 'mm-swal-html',
      actions: 'mm-swal-actions',
      confirmButton: 'mm-swal-confirm-btn'
    },
    buttonsStyling: false
  });
  loadOrders();
} else {
  Swal.fire({
    icon: 'error',
    title: 'Failed',
    text: data.message || 'Error cancelling order.',
    target: document.body,
    customClass: {
      container: 'mm-swal-container-top',
      popup: 'mm-swal-popup',
      title: 'mm-swal-title',
      htmlContainer: 'mm-swal-html',
      actions: 'mm-swal-actions',
      confirmButton: 'mm-swal-confirm-btn'
    },
    buttonsStyling: false
  });
}
    } catch (e) {
      loadOrders();
    }
  });
};

window.confirmOrderReceived = function(orderId) {
  Swal.fire({
    title: 'Confirm Received?',
    text: 'Confirm that you have claimed your sweet drinks at the counter.',
    icon: 'question',
    showCancelButton: true,
    confirmButtonText: 'Yes, Claimed!',
    cancelButtonText: 'Not Yet',
    target: document.body,
    customClass: {
      container: 'mm-swal-container-top',
      popup: 'mm-swal-popup',
      title: 'mm-swal-title',
      htmlContainer: 'mm-swal-html',
      actions: 'mm-swal-actions',
      confirmButton: 'mm-swal-confirm-btn',
      cancelButton: 'mm-swal-cancel-btn'
    },
    buttonsStyling: false,
    reverseButtons: true
  }).then(async (result) => {
    if (!result.isConfirmed) return;

    try {
      const res = await fetch(`/api/orders/${orderId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'COMPLETED' })
      });
      const data = await res.json();
      if (res.ok && data.status === 'success') {
        Swal.fire({ icon: 'success', title: 'Order Complete!', text: 'Thank you! Enjoy your sips!' });
        loadOrders();
      } else {
        Swal.fire({ icon: 'error', title: 'Could Not Confirm', text: data.message || 'Something went wrong. Please try again.' });
      }
    } catch (e) {
      console.error('Confirm order received failed:', e);
      Swal.fire({ icon: 'error', title: 'Network Error', text: 'Could not reach the server. Please check your connection and try again.' });
    }
  });
};

window.downloadOrderReceipt = function(event, encodedOrder) {
  if (event) event.stopPropagation();
  let container = document.getElementById('printableReceiptContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'printableReceiptContainer';
    document.body.appendChild(container);
  }

  const order = JSON.parse(decodeURIComponent(encodedOrder));
  const rawItems = order.items || [];
  let itemsHTML = '';
  let calcSubtotal = 0;

  if (rawItems.length > 0) {
    rawItems.forEach(it => {
      const uPrice = parseFloat(it.unit_price) || 0;
      const qty = parseInt(it.quantity) || 1;
      const linePrice = uPrice * qty;
      calcSubtotal += linePrice;
      const titleClean = cleanItemTitle(it.item_label || it.title);

      itemsHTML += `
        <tr style="border-bottom: 1px solid #f0e6e1;">
          <td style="padding: 10px 8px 10px 0; vertical-align: top;">
            <div style="font-weight: 800; font-size: 14.5px; color: #594A42;">${it.size || '12oz'} ${titleClean}</div>
          </td>
          <td style="padding: 10px 8px; text-align: center; font-weight: 700; font-size: 13.5px; color: #594A42;">${qty}x</td>
          <td style="padding: 10px 0 10px 8px; text-align: right; font-weight: 800; font-size: 14.5px; color: #594A42;">₱ ${linePrice.toFixed(2)}</td>
        </tr>
      `;
    });
  } else {
    calcSubtotal = parseFloat(order.total_amount || order.total_price || 0);
    itemsHTML = `
      <tr style="border-bottom: 1px solid #f0e6e1;">
        <td style="padding: 10px 8px 10px 0; font-weight: 800; font-size: 14.5px; color: #594A42;">${cleanItemTitle(order.title)}</td>
        <td style="padding: 10px 8px; text-align: center; font-weight: 700; font-size: 13.5px;">1x</td>
        <td style="padding: 10px 0 10px 8px; text-align: right; font-weight: 800; font-size: 14.5px;">₱ ${calcSubtotal.toFixed(2)}</td>
      </tr>
    `;
  }

  const orderRef = order.order_ref || order.order_number || `#MM-${order.id}`;

  container.innerHTML = `
    <div id="receiptCaptureCard" style="width: 540px; margin: 0 auto; border: 2px solid #FCE1DD; border-radius: 20px; padding: 26px 30px; background: #ffffff; box-sizing: border-box; font-family: 'Urbanist', sans-serif;">
      <div style="text-align: center; margin-bottom: 16px; border-bottom: 2px dashed #f0e6e1; padding-bottom: 14px;">
        <h1 style="font-family: 'Fredoka', sans-serif; font-size: 28px; color: #594A42; margin: 0 0 4px 0;">Milky Marble</h1>
        <p style="font-size: 11px; color: #7C4F38; margin: 0; text-transform: uppercase; font-weight: 800; letter-spacing: 1px;">Official Receipt</p>
        <div style="font-size: 13.5px; font-weight: 800; color: #F48A8E; margin-top: 6px;">Order Ref: ${orderRef}</div>
      </div>

      <div style="display: flex; justify-content: space-between; font-size: 12.5px; color: #594A42; margin-bottom: 16px; background: #FFF9F8; border: 1.5px solid #FCE1DD; border-radius: 14px; padding: 12px 16px;">
        <div>
          <div style="margin-bottom: 4px;"><b>Customer:</b> ${order.recipient_name || order.guest_name || 'Customer'}</div>
          <div><b>Email:</b> ${order.recipient_email || order.guest_email || 'N/A'}</div>
        </div>
        <div style="text-align: right;">
          <div style="margin-bottom: 4px;"><b>Status:</b> ${order.status || 'Confirmed'}</div>
          <div><b>Pick-up:</b> ${order.pickup_date || order.pickup_schedule || 'N/A'}</div>
        </div>
      </div>

      <table style="width: 100%; border-collapse: collapse; margin-bottom: 16px;">
        <thead>
          <tr style="border-bottom: 1.5px solid #594A42; text-align: left; color: #7C4F38; font-size: 11px; text-transform: uppercase;">
            <th style="padding-bottom: 6px; width: 60%;">Item</th>
            <th style="padding-bottom: 6px; text-align: center; width: 15%;">Qty</th>
            <th style="padding-bottom: 6px; text-align: right; width: 25%;">Total</th>
          </tr>
        </thead>
        <tbody>${itemsHTML}</tbody>
      </table>

      <div style="border-top: 1.5px solid #d4c8c1; padding-top: 10px;">
        <div style="display: flex; justify-content: space-between; font-size: 13.5px; color: #7C4F38; margin-bottom: 4px;">
          <span>Subtotal</span>
          <span style="font-weight: 700;">₱ ${calcSubtotal.toFixed(2)}</span>
        </div>
        <div style="display: flex; justify-content: space-between; font-size: 19px; font-weight: 800; color: #594A42; margin-top: 8px; border-top: 2px solid #594A42; padding-top: 8px;">
          <span>Total Paid</span>
          <span style="color: #F48A8E;">₱ ${parseFloat(order.total_amount || order.total_price || calcSubtotal).toFixed(2)}</span>
        </div>
      </div>
    </div>
  `;

  const captureTarget = document.getElementById('receiptCaptureCard');
  const cleanRef = String(orderRef).replace(/[^a-zA-Z0-9_-]/g, '');

  const opt = {
    margin: [8, 8, 8, 8],
    filename: `MilkyMarble_Receipt_${cleanRef}.pdf`,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2.5, useCORS: true, backgroundColor: '#ffffff' },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
  };

  html2pdf().set(opt).from(captureTarget).save();
};