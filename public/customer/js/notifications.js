// public/customer/js/notifications.js

let notificationsOrdersCache = [];

document.addEventListener('DOMContentLoaded', () => {
  ensureOrderModalDOM();
  loadCustomerNotifications();
});

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

function resolveItemAssets(cleanTitle, size, toppingsStr) {
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

function ensureOrderModalDOM() {
  if (document.getElementById('orderDetailsModal')) return;

  const modalMarkup = `
    <div id="orderDetailsModal" class="order-modal-backdrop" onclick="if(event.target === this) closeOrderDetailsModal()">
      <div class="order-status-modal-card" onclick="event.stopPropagation()">
        <button type="button" class="btn-close-modal" onclick="closeOrderDetailsModal()" aria-label="Close">
          <i class="fa-solid fa-xmark"></i>
        </button>

        <div class="order-status-top-bar">
          <span id="modalOrderRef" class="modal-order-number">#MM-000000</span>
          <span id="modalOrderStatusText" class="modal-status-badge-text">Confirmed</span>
        </div>

        <h3 class="order-status-main-heading">Order Status</h3>

        <div class="status-stepper-track-wrap">
          <div class="status-stepper-labels">
            <span>Confirmed</span>
            <span>Preparing</span>
            <span>Ready for Pick-up</span>
            <span>Completed</span>
          </div>
          <div class="status-stepper-bar-bg">
            <div id="modalStepperFill" class="status-stepper-bar-fill" style="width: 25%;"></div>
          </div>
        </div>

        <div class="status-info-box-block">
          <h4 class="status-section-title">Pick-up Information</h4>
          <div class="status-info-card-inner">
            <div class="status-info-row-item">
              <span class="status-label">Pick-up Date:</span>
              <span id="modalPickupDate" class="status-value">YYYY-MM-DD</span>
            </div>
            <div class="status-info-row-item">
              <span class="status-label">Recipient:</span>
              <span id="modalRecipient" class="status-value">Customer</span>
            </div>
            <div class="status-info-row-item">
              <span class="status-label">Payment Method:</span>
              <span id="modalPaymentMethod" class="status-value">Cash on Pick-Up</span>
            </div>
          </div>
        </div>

        <div class="status-info-box-block">
          <h4 class="status-section-title">Items Ordered</h4>
          <div id="modalOrderItemsList" class="status-items-list-scroll"></div>
        </div>

        <div class="status-total-bottom-bar">
          <span class="status-total-label">Total Amount Paid</span>
          <span id="modalTotalPaid" class="status-total-amount">₱ 0.00</span>
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', modalMarkup);
}

window.openOrderDetailsModal = function(orderOrId) {
  ensureOrderModalDOM();

  let order = null;
  if (typeof orderOrId === 'object' && orderOrId !== null) {
    order = orderOrId;
  } else {
    order = notificationsOrdersCache.find(o => String(o.id) === String(orderOrId) || String(o.order_number) === String(orderOrId));
  }

  if (!order) return;

  const orderRef = order.order_ref || order.order_number || `#MM-${order.id}`;
  const refEl = document.getElementById('modalOrderRef');
  if (refEl) refEl.innerText = orderRef;

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

  const statusTextEl = document.getElementById('modalOrderStatusText');
  if (statusTextEl) statusTextEl.innerText = uiStatus;

  const stepperEl = document.getElementById('modalStepperFill');
  if (stepperEl) stepperEl.style.width = `${progressPercent}%`;

  const dateEl = document.getElementById('modalPickupDate');
  if (dateEl) dateEl.innerText = order.pickup_date || order.pickup_schedule || 'N/A';

  const user = JSON.parse(localStorage.getItem('mm_user') || '{}');
  const recipientName = order.recipient_name || order.guest_name || user.full_name || user.username || 'Customer';
  const emailVal = order.recipient_email || order.guest_email || user.email;
  const recipientEmail = emailVal ? `(${emailVal})` : '';
  const recipEl = document.getElementById('modalRecipient');
  if (recipEl) recipEl.innerText = `${recipientName} ${recipientEmail}`.trim();

  let paymentMethod = order.payment_method || 'Cash on Pick-Up';
  if (order.pickup_instructions) {
    const pMatch = order.pickup_instructions.match(/Payment:\s*([^|]+)/i);
    if (pMatch) paymentMethod = pMatch[1].trim();
  }
  const payEl = document.getElementById('modalPaymentMethod');
  if (payEl) payEl.innerText = paymentMethod;

  const itemsContainer = document.getElementById('modalOrderItemsList');
  const rawItems = order.items || order.order_items || [];

  if (itemsContainer) {
    if (rawItems.length > 0) {
      itemsContainer.innerHTML = rawItems.map(it => {
        const rawItemLabel = it.item_label || it.title || '';
        const cleanTitle = cleanItemTitle(rawItemLabel);
        const size = (it.size || (rawItemLabel.includes('8oz') ? '8oz' : '12oz'));
        const qty = it.quantity || 1;
        const unitPrice = parseFloat(it.unit_price || 0);
        const linePrice = (unitPrice * qty).toFixed(2);

        let toppingsStr = '';
        const tMatch = rawItemLabel.match(/\(\+(.*?)\)/) || rawItemLabel.match(/\((.*?)\)/);
        if (tMatch && !tMatch[1].includes('oz')) {
          toppingsStr = tMatch[1].replace(/^\+\s*/, '').trim();
        } else if (it.toppings) {
          toppingsStr = it.toppings.replace(/^\+\s*/, '').trim();
        }

        const assets = resolveItemAssets(cleanTitle, size, toppingsStr);

        return `
          <div class="status-cup-item-row">
            <div class="status-cup-thumb" style="--thumb-accent: ${assets.accent_color};">
              ${assets.is_custom ? `
                <div class="orders-composite-thumb" style="width: 44px; height: 56px; position:relative;">
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
  }

  const totalEl = document.getElementById('modalTotalPaid');
  if (totalEl) {
    totalEl.innerText = `₱ ${parseFloat(order.total_amount || order.total_price || 0).toFixed(2)}`;
  }

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

window.openOrderModal = function(orderId) {
  window.openOrderDetailsModal(orderId);
};

window.openRateModal = function(orderId) {
  window.location.href = `orders.html?orderId=${orderId}&rate=true`;
};

async function loadCustomerNotifications() {
  const container = document.getElementById('notificationsListContainer') || document.querySelector('.notifications-wrapper') || document.querySelector('main');
  if (!container) return;

  const user = JSON.parse(localStorage.getItem('mm_user') || 'null');

  if (!user || (!user.customer_id && !user.id)) {
    container.innerHTML = `
      <div class="notifications-empty-box">
        <i class="fa-regular fa-bell empty-bell-icon"></i>
        <h2 class="empty-title">No updates yet</h2>
        <p class="empty-sub">Log in to track your freshly layered sips and live order status!</p>
        <a href="customerlogin.html" class="btn-empty-action">Log In</a>
      </div>
    `;
    return;
  }

  const customerId = user.customer_id || user.id;

  try {
    const res = await fetch(`/api/orders?customer_id=${customerId}`);
    const data = await res.json();
    const orders = data.orders || [];
    notificationsOrdersCache = orders;

    if (orders.length === 0) {
      container.innerHTML = `
        <div class="notifications-empty-box">
          <i class="fa-regular fa-bell empty-bell-icon"></i>
          <h2 class="empty-title">No updates yet</h2>
          <p class="empty-sub">Place an order to receive fresh updates here.</p>
          <a href="home.html#drinks" class="btn-empty-action">Order a Drink</a>
        </div>
      `;
      return;
    }

    const readNotifs = JSON.parse(localStorage.getItem('mm_read_notifs') || '[]');

    const notifsHTML = orders.map(order => {
      const rawItems = order.items || [];
      const firstRaw = rawItems[0] || {};
      const rawLabel = firstRaw.item_label || firstRaw.title || order.title || 'Custom Marble Cup';
      const size = rawLabel.includes('8oz') ? '8oz' : '12oz';

      let toppingsStr = '';
      const tMatch = rawLabel.match(/\(\+(.*?)\)/);
      if (tMatch) toppingsStr = tMatch[1];
      else if (firstRaw.toppings) toppingsStr = firstRaw.toppings;

      const cleanTitle = cleanItemTitle(rawLabel);
      const assets = resolveItemAssets(cleanTitle, size, toppingsStr);

      let rawStatus = (order.status || 'CONFIRMED').toUpperCase().replace(/_/g, ' ');
      let notifTitle = 'Order Confirmed!';
      let notifDesc = "We've received your order! Hang tight, your jelly cups will be prepared soon.";
      let actionBtnHTML = `<button type="button" class="btn-notif-action" onclick="event.stopPropagation(); openOrderDetailsModal('${order.id}')">View Details</button>`;

      if (rawStatus.includes('COMPLET')) {
        notifTitle = 'Order Complete! How was your sip?';
        notifDesc = 'Tell us what you think of your sips! Rate your drink and share the love.';
        actionBtnHTML = `<button type="button" class="btn-notif-action" onclick="event.stopPropagation(); openRateModal('${order.id}')">Rate your Sips</button>`;
      } else if (rawStatus.includes('READY')) {
        notifTitle = 'Ready for Pick-up!';
        notifDesc = 'Your sweet cups are chilled and waiting for you at the counter!';
        actionBtnHTML = `<button type="button" class="btn-notif-action" onclick="event.stopPropagation(); openOrderDetailsModal('${order.id}')">View Details</button>`;
      } else if (rawStatus.includes('PREP')) {
        notifTitle = 'Prepping Your Sips!';
        notifDesc = "The Marble Bar is layering your sweet treats now. We'll let you know once ready!";
        actionBtnHTML = `<button type="button" class="btn-notif-action" onclick="event.stopPropagation(); openOrderDetailsModal('${order.id}')">View Details</button>`;
      }

      const dateObj = new Date(order.placed_at || Date.now());
      const formattedDate = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + 
        ' · ' + dateObj.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

      const isRead = readNotifs.includes(String(order.id));

      return `
        <article class="notification-item-card ${isRead ? 'is-read' : ''}" onclick="markSingleNotifRead('${order.id}')">
          <div class="notif-thumb-wrapper" style="--thumb-accent: ${assets.accent_color};">
            ${assets.is_custom ? `
              <div class="orders-composite-thumb" style="width: 52px; height: 68px;">
                <img src="${assets.flavor_img}" class="cart-layer-flavor" alt="Flavor" onerror="this.style.display='none'">
                ${assets.toppings_img ? `<img src="${assets.toppings_img}" class="cart-layer-toppings" alt="Toppings" onerror="this.style.display='none'">` : ''}
                <img src="${assets.cup_img}" class="cart-layer-cup" alt="Cup">
              </div>
            ` : `
              <img src="${assets.image}" class="notif-thumb-img" alt="${cleanTitle}">
            `}
          </div>

          <div class="notif-details-col">
            <h2 class="notif-title">${notifTitle}</h2>
            <p class="notif-desc">${notifDesc}</p>
            <span class="notif-timestamp">${formattedDate}</span>
          </div>

          <div class="notif-action-col">
            ${actionBtnHTML}
          </div>
        </article>
      `;
    }).join('');

    container.innerHTML = notifsHTML;

  } catch (err) {
    container.innerHTML = `
      <div class="notifications-empty-box">
        <p style="color: #594A42; font-weight: 700;">Could not load notifications. Please refresh.</p>
      </div>
    `;
  }
}

window.markAllNotificationsAsRead = function() {
  const cards = document.querySelectorAll('.notification-item-card');
  cards.forEach(card => card.classList.add('is-read'));

  const user = JSON.parse(localStorage.getItem('mm_user') || '{}');
  const custId = user.customer_id || user.id;
  if (!custId) return;

  fetch(`/api/orders?customer_id=${custId}`)
    .then(res => res.json())
    .then(data => {
      const ids = (data.orders || []).map(o => String(o.id));
      localStorage.setItem('mm_read_notifs', JSON.stringify(ids));
      const badge = document.getElementById('navNotifBadge');
      if (badge) badge.style.display = 'none';
    });
};

window.markSingleNotifRead = function(id) {
  let readNotifs = JSON.parse(localStorage.getItem('mm_read_notifs') || '[]');
  if (!readNotifs.includes(String(id))) {
    readNotifs.push(String(id));
    localStorage.setItem('mm_read_notifs', JSON.stringify(readNotifs));
  }
};