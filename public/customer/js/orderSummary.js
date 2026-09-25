// public/customer/js/orderSummary.js
let currentOrderSummaryItems = [];
let currentSubtotal = 0.0;
let appliedPromoDiscount = 0.0;
let appliedLoyaltyDiscount = 0.0;
let selectedPaymentMethod = '';
let availableLoyaltyPoints = 0.0;
let lastPlacedOrderData = null;

let currentRecipient = {
  name: '',
  email: ''
};

function getStoredUser() {
  try {
    return JSON.parse(localStorage.getItem('mm_user') || '{}');
  } catch (e) {
    console.warn('Error reading mm_user from localStorage:', e);
    return {};
  }
}

// Map whatever is stored (e.g. "Cash", "GCash", "E-wallet") onto the two
// checkout pill labels so a slightly different saved value still matches.
function normalizePaymentMethod(raw) {
  const v = String(raw || '').trim();
  if (!v) return '';
  if (/cash/i.test(v)) return 'Cash on Pick-Up';
  if (/wallet|gcash|maya|paymongo|qr\s*ph|online/i.test(v)) return 'E-Wallet';
  return v;
}

// Browser-side memory of the last method used, so auto-select still works
// even if the server can't work it out from order history.
function lastPaymentStorageKey(customerId) {
  return `mm_last_payment_${customerId || 'guest'}`;
}

async function getActiveCustomerProfile() {
  try {
    const stored = getStoredUser();
    const idParams = new URLSearchParams();
    if (stored.customer_id) idParams.set('customer_id', stored.customer_id);
    else if (stored.user_id || stored.id) idParams.set('user_id', stored.user_id || stored.id);

    const res = await fetch(`/api/customer/profile${idParams.toString() ? '?' + idParams.toString() : ''}`, {
      credentials: 'include',
      headers: { 'Accept': 'application/json' }
    });

    if (res.ok) {
      const result = await res.json();
      if (result.status === 'success' && (result.data || result.customer)) {
        const cust = result.data || result.customer;
        try {
          const userObj = {
            id: cust.user_id || cust.users?.id,
            user_id: cust.user_id || cust.users?.id,
            customer_id: cust.id,
            full_name: cust.full_name || cust.users?.full_name || '',
            username: cust.username || cust.users?.username || '',
            email: cust.email || cust.users?.email || '',
            loyalty_points: parseFloat(cust.loyalty_points || 0)
          };
          localStorage.setItem('mm_user', JSON.stringify(userObj));
        } catch (e) {}
        return cust;
      }
    }
  } catch (e) {
    console.warn('Could not fetch active profile via session cookie:', e);
  }

  const stored = getStoredUser();
  if (stored && (stored.customer_id || stored.user_id || stored.id)) {
    return {
      id: stored.customer_id || stored.id,
      user_id: stored.user_id || stored.id,
      full_name: stored.full_name || stored.username || '',
      email: stored.email || '',
      loyalty_points: parseFloat(stored.loyalty_points || 0)
    };
  }

  return null;
}

// Resolve Layer 1 (flavor/jelly), Layer 2 (toppings) and Layer 3 (cup) image paths
// for an item so the Order Summary preview can show all layers the customer added,
// not just the Layer 1 (Jelly and Milk) image.
function resolveOrderSummaryAssets(title, flavor, variation, size, toppingsList) {
  const titleLower = (title || '').toLowerCase();
  const flavorLower = (flavor || title || '').toLowerCase();
  const varLower = (variation || '').toLowerCase();
  const isLarge = size !== '8oz';
  const folderSize = isLarge ? 'Large' : 'Small';

  const presets = {
    'chocolatey coffee noodly jelly': { image: 'images/Chocolatey Coffee Noodly Jelly.png' },
    'cheesy pandan cubes': { image: 'images/Cheesy Pandan Cubes.png' },
    'bubbly coffee jelly': { image: 'images/Bubbly Coffee Jelly.png' },
    'strawberry string party': { image: 'images/Strawberry String Party.png' }
  };

  for (const [pName, pData] of Object.entries(presets)) {
    if (titleLower.includes(pName)) {
      return { is_custom: false, image: pData.image, flavor_img: pData.image, toppings_img: '', cup_img: '' };
    }
  }

  let resolvedFlavor = 'Pandan';
  if (flavorLower.includes('strawberry') || titleLower.includes('strawberry')) {
    resolvedFlavor = 'Strawberry';
  } else if (flavorLower.includes('coffee') || titleLower.includes('coffee')) {
    resolvedFlavor = 'Coffee';
  }

  let resolvedJelly = 'cube';
  if (varLower.includes('spaghetti') || titleLower.includes('spaghetti') || titleLower.includes('string')) {
    resolvedJelly = 'spaghetti';
  } else if (varLower.includes('whole') || titleLower.includes('whole')) {
    resolvedJelly = 'whole';
  }

  const l1Path = `images/Layer 1/${folderSize} Flavors/${resolvedFlavor} ${resolvedJelly}.png`;
  const l3Path = isLarge ? 'images/Layer 3/Large Cup.png' : 'images/Layer 3/Small Cup.png';

  let l2Path = '';
  const toppingsStr = (toppingsList || []).join(' ').toLowerCase();
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

  for (const [keyword, fileBase] of Object.entries(toppingMap)) {
    if (toppingsStr.includes(keyword)) {
      l2Path = `images/Layer 2/${folderSize} Toppings/${fileBase}.png`;
      break;
    }
  }

  return { is_custom: true, image: l1Path, flavor_img: l1Path, toppings_img: l2Path, cup_img: l3Path };
}

function showSweetAlert(options) {
  if (typeof Swal === 'undefined') return Promise.resolve({ isConfirmed: false });

  const userDidOpen = options && options.didOpen;

  return Swal.fire({
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
    // Modals can only be dismissed by pressing one of their buttons —
    // never by clicking the backdrop or pressing ESC.
    allowOutsideClick: false,
    allowEscapeKey: false,
    ...options,
    didOpen: (popup) => {
      // Force this alert above every modal in the app (Order Summary is
      // z-index 9000, Recipient Details is 10000) regardless of whatever
      // z-index .mm-swal-container-top ends up with in the stylesheet.
      // SweetAlert2's own default z-index (1060) is otherwise far lower
      // than both, so the alert renders — but stays hidden underneath them.
      const container = popup.closest('.swal2-container');
      if (container) container.style.zIndex = '20000';
      if (typeof userDidOpen === 'function') userDidOpen(popup);
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  loadRecipientInfoFromSession();
  loadAllowedPickupDays();
});

// ==========================================
// PICK-UP DAYS (admin-configurable via /api/admin/settings/pickup-days)
// ==========================================
// Falls back to Mon/Tue/Thu — the old hardcoded behavior — until the
// public settings endpoint responds, mirroring the server's own fallback.
const DEFAULT_PICKUP_DAYS = [1, 2, 4];
let allowedPickupDays = DEFAULT_PICKUP_DAYS.slice();
let pickupDaysPromise = null;

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAY_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function formatPickupDaysList(days, names) {
  const labels = [...days].sort((a, b) => a - b).map(d => names[d]).filter(Boolean);
  if (labels.length === 0) return '';
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return labels.join(' & ');
  return labels.slice(0, -1).join(', ') + ', & ' + labels[labels.length - 1];
}

// Keeps the "(Mon, Tue, & Thu only)" heading hint and the red validation
// message in sync with whatever the admin actually saved, on every page
// that renders this shared Order Summary modal (Cart, Drinks, Orders).
function updatePickupDaysHintText() {
  const hintSpan = document.getElementById('pickupDaysHintSpan');
  if (hintSpan) hintSpan.textContent = `(${formatPickupDaysList(allowedPickupDays, WEEKDAY_SHORT)} only)`;

  const errText = document.getElementById('dateErrorMsgText');
  if (errText) errText.textContent = `Pick-ups are only available on ${formatPickupDaysList(allowedPickupDays, WEEKDAY_FULL)}.`;
}

// Cached as a single in-flight/resolved promise so every page only fetches
// this once, no matter how many times the modal is opened.
function loadAllowedPickupDays() {
  if (pickupDaysPromise) return pickupDaysPromise;

  pickupDaysPromise = (async () => {
    try {
      const res = await fetch('/api/settings/pickup-days');
      const data = await res.json();
      if (data.status === 'success' && Array.isArray(data.days) && data.days.length > 0) {
        allowedPickupDays = data.days;
      }
    } catch (err) {
      console.warn('Could not load admin pickup-day settings, using default Mon/Tue/Thu:', err);
    }
    updatePickupDaysHintText();
    return allowedPickupDays;
  })();

  return pickupDaysPromise;
}

async function loadRecipientInfoFromSession() {
  const activeCustomer = await getActiveCustomerProfile();
  if (activeCustomer) {
    const fullName = activeCustomer.full_name || activeCustomer.users?.full_name || activeCustomer.username;
    const email = activeCustomer.email || activeCustomer.users?.email;
    if (fullName) currentRecipient.name = String(fullName).trim();
    if (email) currentRecipient.email = String(email).trim();
  } else {
    const localUser = getStoredUser();
    if (localUser.full_name || localUser.username || localUser.name) {
      currentRecipient.name = String(localUser.full_name || localUser.username || localUser.name).trim();
    }
    if (localUser.email) {
      currentRecipient.email = String(localUser.email).trim();
    }
  }
  renderRecipientDetails();
}

function renderRecipientDetails() {
  const wrapper = document.getElementById('recipientDetailsWrapper');
  if (!wrapper) return;

  const displayName = currentRecipient.name || '<span style="color: #a8948d; font-style: italic;">Valued Customer</span>';
  const displayEmail = currentRecipient.email || '<span style="color: #a8948d; font-style: italic;">customer@gmail.com</span>';

  wrapper.innerHTML = `
    <div class="recipient-input-card" style="display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; background: #FFFDFD; border: 1.5px solid #FCE1DD; border-radius: 16px;">
      <div class="recipient-display-col" style="display: flex; flex-direction: column; gap: 3px;">
        <div style="font-size: 13.5px; color: #594A42;"><strong>Name:</strong> ${displayName}</div>
        <div style="font-size: 13.5px; color: #594A42;"><strong>Email:</strong> ${displayEmail}</div>
      </div>
      <button type="button" class="btn-edit-recipient" onclick="openRecipientModal()" title="Edit Details" style="background: none; border: none; color: #F48A8E; font-size: 17px; cursor: pointer;">
        <i class="fa-regular fa-pen-to-square"></i>
      </button>
    </div>
  `;
}

// ==========================================
// RENDER ORDER SUMMARY MODAL
// ==========================================
window.renderOrderSummaryModal = async function(items = []) {
  currentOrderSummaryItems = Array.isArray(items) ? items : [];
  appliedPromoDiscount = 0.0;
  appliedLoyaltyDiscount = 0.0;
  selectedPaymentMethod = '';

  const activeCustomer = await getActiveCustomerProfile();
  const isGuest = !activeCustomer;

  if (activeCustomer) {
    const fullName = activeCustomer.full_name || activeCustomer.users?.full_name || activeCustomer.username;
    const email = activeCustomer.email || activeCustomer.users?.email;
    if (fullName) currentRecipient.name = String(fullName).trim();
    if (email) currentRecipient.email = String(email).trim();
  } else {
    loadRecipientInfoFromSession();
  }
  renderRecipientDetails();

  document.querySelectorAll('.payment-method-pill').forEach(btn => {
    btn.classList.remove('active');
  });
  const paymentReq = document.getElementById('paymentRequiredMsg');
  if (paymentReq) paymentReq.style.display = 'none';
  const ewalletHint = document.getElementById('ewalletHint');
  if (ewalletHint) ewalletHint.style.display = 'none';

  const agreeTermsCheckbox = document.getElementById('agreeTermsCheckbox');
  if (agreeTermsCheckbox) agreeTermsCheckbox.checked = false;
  const termsReq = document.getElementById('termsRequiredMsg');
  if (termsReq) termsReq.style.display = 'none';

  // Auto-select the customer's saved payment preference. If they never set
  // one in Account Settings, fall back to whichever method they used last
  // (from the server's order history, then from this browser's memory).
  if (activeCustomer) {
    const custKey = activeCustomer.customer_id || activeCustomer.id;
    let localLast = '';
    try { localLast = localStorage.getItem(lastPaymentStorageKey(custKey)) || ''; } catch (e) {}

    const preferredMethod = normalizePaymentMethod(
      activeCustomer.payment_preference || activeCustomer.last_payment_method || localLast
    );
    const matchingPill = preferredMethod
      ? Array.from(document.querySelectorAll('.payment-method-pill'))
          .find(btn => normalizePaymentMethod(btn.getAttribute('data-method') || btn.textContent) === preferredMethod)
      : null;

    console.debug('[checkout] payment auto-select', {
      payment_preference: activeCustomer.payment_preference || null,
      last_payment_method: activeCustomer.last_payment_method || null,
      local_last: localLast || null,
      picked: matchingPill ? preferredMethod : null
    });

    if (matchingPill) {
      window.selectPaymentMethod(matchingPill);
    }
  }

  const promoInput = document.getElementById('promoCodeInput');
  if (promoInput) promoInput.value = '';
  const promoMsg = document.getElementById('promoAppliedMsg');
  if (promoMsg) promoMsg.style.display = 'none';

  const loyaltySection = document.querySelector('.loyalty-toggle-section');
  if (loyaltySection) {
    loyaltySection.style.display = isGuest ? 'none' : 'block';
  }

  if (!isGuest) {
    await syncCustomerLoyaltyPoints();
  }

  const togglePoints = document.getElementById('toggleUseLoyaltyPoints');
  if (togglePoints) togglePoints.checked = false;
  const loyaltyRow = document.getElementById('summaryLoyaltyDiscountRow');
  if (loyaltyRow) loyaltyRow.style.display = 'none';

  // Make sure we have the admin's current pickup-day settings before
  // picking a default date or showing the hint text — this also covers
  // the case where the modal is opened before the page-load fetch resolves.
  await loadAllowedPickupDays();
  setNextDefaultPickupDate();

  const cupsList = document.getElementById('summaryCupsList');
  if (cupsList) {
    cupsList.innerHTML = currentOrderSummaryItems.map(item => {
      const rawPrice = item.unit_price ?? item.price ?? 15.00;
      const price = parseFloat(String(rawPrice).replace(/[^0-9.]/g, '')) || 15.00;
      const qty = parseInt(item.quantity ?? 1, 10);
      const lineTotal = price * qty;

      // Kunin ang Layer 1 (flavor/jelly), Layer 2 (toppings), at Layer 3 (cup) na
      // idinagdag ng customer sa customization, hindi lang ang Layer 1 image.
      const toppingsArr = item.toppings ? String(item.toppings).split(',').map(t => t.trim()).filter(Boolean) : [];
      const hasResolvedLayers = item.flavor_img || item.toppings_img || item.cup_img;
      const assets = hasResolvedLayers
        ? {
            is_custom: !!(item.is_custom || item.custom_build || item.toppings_img),
            image: item.image || item.flavor_img,
            flavor_img: item.flavor_img || item.image,
            toppings_img: item.toppings_img || '',
            cup_img: item.cup_img || (item.size === '8oz' ? 'images/Layer 3/Small Cup.png' : 'images/Layer 3/Large Cup.png')
          }
        : resolveOrderSummaryAssets(item.title, item.flavor, item.variation, item.size, toppingsArr);

      const thumbHTML = assets.is_custom
        ? `
            <div class="composite-cart-thumb summary-composite-thumb">
              <img src="${assets.flavor_img}" alt="Flavor Layer" class="cart-layer-flavor" onerror="this.style.display='none'">
              ${assets.toppings_img ? `<img src="${assets.toppings_img}" alt="Toppings Layer" class="cart-layer-toppings" onerror="this.style.display='none'">` : ''}
              <img src="${assets.cup_img}" alt="Cup Outline" class="cart-layer-cup" onerror="this.style.display='none'">
            </div>
          `
        : `<img src="${assets.image || 'images/1.jpg'}" alt="Cup" style="width: 50px; height: 50px; object-fit: contain;" onerror="this.src='images/1.jpg'">`;

      // Normalize the toppings/add-ons text so it looks the same no matter
      // where the item came from (Drinks builder, Orders reorder, or a raw
      // cart row straight from the database). Drinks/Orders already hand in
      // a "+ X + Y" string; a cart row only has a plain "X, Y" list — so
      // build the "+ " formatted version here instead of trusting the caller.
      const alreadyFormatted = typeof item.toppings === 'string' && item.toppings.trim().startsWith('+');
      const displayToppings = alreadyFormatted
        ? item.toppings.trim()
        : (toppingsArr.length > 0 ? '+ ' + toppingsArr.join(' + ') : '');

      const addonsRaw = item.addons ? String(item.addons).trim() : '';
      const displayAddons = addonsRaw
        ? (addonsRaw.startsWith('+') ? addonsRaw : '+ ' + addonsRaw)
        : '';

      const detailsLine = [displayToppings, displayAddons].filter(Boolean).join(' ');

      return `
        <div class="summary-cup-item" style="display: flex; align-items: center; justify-content: space-between; background: #FFF4F2; border-radius: 18px; padding: 12px 16px; margin-bottom: 8px;">
          <div style="display: flex; align-items: center; gap: 12px;">
            ${thumbHTML}
            <div style="display: flex; flex-direction: column;">
              <h4 style="font-size: 14.5px; font-weight: 800; color: #594A42; margin: 0;">${item.size || '12oz'} ${item.title || 'Milky Marble Cup'}</h4>
              <span style="font-size: 12px; font-weight: 600; color: #7C4F38;">${detailsLine}</span>
              <span style="display: inline-block; width: fit-content; background: #F48A8E; color: #fff; font-size: 11px; font-weight: 800; padding: 2px 8px; border-radius: 99px; margin-top: 4px;">${qty}x</span>
            </div>
          </div>
          <div style="font-size: 17px; font-weight: 800; color: #594A42;">₱ ${lineTotal.toFixed(2)}</div>
        </div>
      `;
    }).join('');
  }

  currentSubtotal = currentOrderSummaryItems.reduce((sum, it) => {
    const rawPrice = it.unit_price ?? it.price ?? 15.00;
    const price = parseFloat(String(rawPrice).replace(/[^0-9.]/g, '')) || 15.00;
    const qty = parseInt(it.quantity ?? 1, 10);
    return sum + (price * qty);
  }, 0);

  updateSummaryTotals();

  const modal = document.getElementById('orderSummaryModal');
  if (modal) {
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
  }
};

window.closeOrderSummaryModal = function(event) {
  // A click on the dark backdrop passes the click event in; ignore it.
  // Only the explicit close (X) button / code calls this with no event.
  if (event && event.target) return;
  const modal = document.getElementById('orderSummaryModal');
  if (modal) modal.classList.remove('active');
  document.body.style.overflow = '';
};

// ==========================================
// LOYALTY POINTS LOGIC & CALCULATIONS
// ==========================================
async function syncCustomerLoyaltyPoints() {
  try {
    const res = await fetch('/api/customer/profile', {
      credentials: 'include',
      headers: { 'Accept': 'application/json' }
    });
    const result = await res.json();

    if (res.ok && result.status === 'success') {
      const data = result.data || result.customer || {};
      availableLoyaltyPoints = parseFloat(data.loyalty_points || 0);

      const formattedPts = availableLoyaltyPoints.toFixed(2);
      const pesoEquiv = (availableLoyaltyPoints * 1.0).toFixed(2);

      const availableSubtext = document.getElementById('summaryLoyaltyAvailable');
      if (availableSubtext) {
        availableSubtext.innerText = `Available: ${formattedPts} pts (₱${pesoEquiv})`;
      }

      const ptsHeader = document.getElementById('displayLoyaltyPoints');
      const pesoHeader = document.getElementById('displayLoyaltyPeso');
      if (ptsHeader) ptsHeader.innerText = `${formattedPts} pts`;
      if (pesoHeader) pesoHeader.innerText = `(₱${pesoEquiv})`;

      // I-save din sa localStorage
      const userObj = getStoredUser();
      userObj.loyalty_points = availableLoyaltyPoints;
      localStorage.setItem('mm_user', JSON.stringify(userObj));
    }
  } catch (err) {
    console.warn('Could not sync points in order summary:', err);
  }
}

window.handleToggleLoyaltyPoints = function(isChecked) {
  const checked = typeof isChecked === 'boolean'
    ? isChecked
    : (isChecked && typeof isChecked.checked === 'boolean'
      ? isChecked.checked
      : (document.getElementById('toggleUseLoyaltyPoints')?.checked || false));

  const loyaltyRow = document.getElementById('summaryLoyaltyDiscountRow');
  const loyaltyDisplay = document.getElementById('summaryLoyaltyDiscount');

  if (checked) {
    if (availableLoyaltyPoints <= 0) {
      showSweetAlert({
        icon: 'info',
        title: 'No Points Available',
        text: 'You do not have any loyalty points to redeem yet. Every ₱10 spent earns 0.10 points!',
        confirmButtonText: 'Got It',
        showCancelButton: false
      });
      const toggleEl = document.getElementById('toggleUseLoyaltyPoints');
      if (toggleEl) toggleEl.checked = false;
      appliedLoyaltyDiscount = 0.0;
      if (loyaltyRow) loyaltyRow.style.display = 'none';
      updateSummaryTotals();
      return;
    }

    const maxDiscountAllowed = availableLoyaltyPoints * 1.0;
    const remainingToDiscount = Math.max(0, currentSubtotal - appliedPromoDiscount);
    appliedLoyaltyDiscount = Math.min(remainingToDiscount, maxDiscountAllowed);

    if (loyaltyRow) loyaltyRow.style.display = 'flex';
    if (loyaltyDisplay) loyaltyDisplay.innerText = `- ₱ ${appliedLoyaltyDiscount.toFixed(2)}`;
  } else {
    appliedLoyaltyDiscount = 0.0;
    if (loyaltyRow) loyaltyRow.style.display = 'none';
  }

  updateSummaryTotals();
};

function updateSummaryTotals() {
  const subtotalEl = document.getElementById('summarySubtotal');
  const promoEl = document.getElementById('summaryDiscount');
  const finalEl = document.getElementById('summaryFinalTotal');

  if (subtotalEl) subtotalEl.innerText = `₱ ${currentSubtotal.toFixed(2)}`;
  if (promoEl) promoEl.innerText = `- ₱ ${appliedPromoDiscount.toFixed(2)}`;

  const finalTotal = Math.max(0, currentSubtotal - appliedPromoDiscount - appliedLoyaltyDiscount);
  if (finalEl) finalEl.innerText = `₱ ${finalTotal.toFixed(2)}`;
}

// ==========================================
// PAYMENT METHOD & PICKUP DATE VALIDATION
// ==========================================
window.selectPaymentMethod = function(btnElement) {
  document.querySelectorAll('.payment-method-pill').forEach(b => b.classList.remove('active'));
  btnElement.classList.add('active');
  selectedPaymentMethod = (btnElement.getAttribute('data-method') || btnElement.textContent).trim();

  const paymentReq = document.getElementById('paymentRequiredMsg');
  if (paymentReq) paymentReq.style.display = 'none';

  const isEwallet = /wallet|gcash|maya|online|paymongo/i.test(selectedPaymentMethod) && !selectedPaymentMethod.toLowerCase().includes('cash');
  const ewalletHint = document.getElementById('ewalletHint');
  if (ewalletHint) ewalletHint.style.display = isEwallet ? 'block' : 'none';
};

function setNextDefaultPickupDate() {
  const input = document.getElementById('pickupDateInput');
  if (!input) return;

  const days = allowedPickupDays.length > 0 ? allowedPickupDays : DEFAULT_PICKUP_DAYS;

  const date = new Date();
  date.setDate(date.getDate() + 1);

  // Safety cap so a misconfigured/empty admin setting can't spin forever.
  let guard = 0;
  while (!days.includes(date.getDay()) && guard < 14) {
    date.setDate(date.getDate() + 1);
    guard++;
  }

  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const formattedDate = `${yyyy}-${mm}-${dd}`;

  input.value = formattedDate;
  input.min = formattedDate;
}

window.validatePickupDate = function(input) {
  const dateReq = document.getElementById('dateRequiredMsg');
  const dateErr = document.getElementById('dateErrorMsg');
  if (dateReq) dateReq.style.display = 'none';
  if (dateErr) dateErr.style.display = 'none';

  const targetInput = (input && input.target) ? input.target : (input || document.getElementById('pickupDateInput'));
  if (!targetInput || !targetInput.value) return;

  const parts = targetInput.value.split('-');
  if (parts.length !== 3) return;

  const selectedYear = parseInt(parts[0], 10);
  const selectedMonth = parseInt(parts[1], 10) - 1;
  const selectedDay = parseInt(parts[2], 10);
  const selected = new Date(selectedYear, selectedMonth, selectedDay);

  const day = selected.getDay();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const days = allowedPickupDays.length > 0 ? allowedPickupDays : DEFAULT_PICKUP_DAYS;

  if (selected < today || !days.includes(day)) {
    if (dateErr) dateErr.style.display = 'block';
    targetInput.value = '';
  }
};

window.validateTermsAgreement = function(input) {
  const termsReq = document.getElementById('termsRequiredMsg');
  const checkbox = input || document.getElementById('agreeTermsCheckbox');
  if (termsReq && checkbox && checkbox.checked) termsReq.style.display = 'none';
};

window.openDatePicker = function() {
  const input = document.getElementById('pickupDateInput');
  if (input) {
    try {
      if (typeof input.showPicker === 'function') {
        input.showPicker();
      } else {
        input.focus();
      }
    } catch (e) {
      input.focus();
    }
  }
};

window.applyPromo = async function() {
  const input = document.getElementById('promoCodeInput');
  const msg = document.getElementById('promoAppliedMsg');
  const code = (input?.value || '').trim();

  if (!code) {
    showSweetAlert({
      icon: 'warning',
      title: 'Empty Promo',
      text: 'Please enter a promo code first.',
      confirmButtonText: 'Got It'
    });
    return;
  }

  const applyBtn = document.getElementById('btnApplyPromo');
  if (applyBtn) applyBtn.disabled = true;

  try {
    const res = await fetch(`/api/promotions/validate?code=${encodeURIComponent(code)}`);
    const data = await res.json();

    if (res.ok && data.status === 'success' && data.promo) {
      const promo = data.promo;
      const type = String(promo.discount_type || '').toLowerCase();
      const val = parseFloat(promo.discount_value || 0);

      if (type === 'percent' || type === 'percentage') {
        appliedPromoDiscount = currentSubtotal * (val / 100);
      } else {
        appliedPromoDiscount = Math.min(currentSubtotal, val);
      }

      if (msg) {
        msg.innerText = `${promo.title || 'Promo'} applied (-₱${appliedPromoDiscount.toFixed(2)})!`;
        msg.style.display = 'block';
        msg.style.color = '#2e7d32';
      }
    } else {
      appliedPromoDiscount = 0.0;
      if (msg) {
        msg.innerText = data.message || 'Invalid promo code.';
        msg.style.display = 'block';
        msg.style.color = '#d32f2f';
      }
    }
  } catch (err) {
    console.error('Promo error:', err);
    appliedPromoDiscount = 0.0;
    if (msg) {
      msg.innerText = 'Could not verify promo code.';
      msg.style.display = 'block';
      msg.style.color = '#d32f2f';
    }
  } finally {
    if (applyBtn) applyBtn.disabled = false;

    const isPointsToggled = document.getElementById('toggleUseLoyaltyPoints')?.checked || false;
    if (isPointsToggled && typeof window.handleToggleLoyaltyPoints === 'function') {
      window.handleToggleLoyaltyPoints(true);
    } else {
      updateSummaryTotals();
    }
  }
};

// ==========================================
// GUEST CHECKOUT — GOOGLE SIGN-IN
// ==========================================
// Guests no longer type in a Full Name / Email form. Instead, the Recipient
// Details modal asks them to sign in with Gmail, and we pull the name/email
// straight from their Google account.
let guestGoogleReady = false;
let guestGoogleInitialized = false;
let guestGoogleButtonRendered = false;

function initGuestGoogleSignIn(retriesLeft = 40) {
  const loadingMsg = document.getElementById('guestGoogleLoadingMsg');

  if (typeof google !== 'undefined' && google.accounts && google.accounts.id) {
    // Only call initialize() once — calling it repeatedly every time the
    // modal is opened is wasteful and can reset GSI's internal state.
    if (!guestGoogleInitialized) {
      google.accounts.id.initialize({
        client_id: "1077352091553-6d77b0rtu3km8r1har7ra3lsmbf5en35.apps.googleusercontent.com",
        callback: handleGuestGoogleCredentialResponse,
        auto_select: false
      });
      guestGoogleInitialized = true;
    }

    // The real, visible Google button now renders straight into
    // #guestGoogleButton — there is no hidden proxy button anymore.
    const container = document.getElementById('guestGoogleButton');
    let hasBtn = container && container.querySelector('div[role="button"]');

    if (container && !hasBtn && !guestGoogleButtonRendered) {
      google.accounts.id.renderButton(container, {
        type: 'standard',
        shape: 'rectangular',
        theme: 'outline',
        text: 'signin_with',
        size: 'large',
        width: container.offsetWidth || 280
      });
      guestGoogleButtonRendered = true;
      hasBtn = container.querySelector('div[role="button"]');
    }

    // renderButton() can occasionally take an extra tick to actually insert
    // the real button. Only flip guestGoogleReady, and hide the "Loading
    // Google Sign-In..." message, once the button truly exists.
    if (hasBtn) {
      guestGoogleReady = true;
      if (loadingMsg) loadingMsg.style.display = 'none';
    } else if (retriesLeft > 0) {
      guestGoogleButtonRendered = false;
      setTimeout(() => initGuestGoogleSignIn(retriesLeft - 1), 250);
    } else {
      console.error('Google Sign-In button failed to render after waiting.');
      if (loadingMsg) loadingMsg.innerText = 'Google Sign-In is unavailable right now. Please refresh and try again.';
    }
    return;
  }

  if (retriesLeft > 0) {
    setTimeout(() => initGuestGoogleSignIn(retriesLeft - 1), 250);
  } else {
    console.error('Google Identity Services failed to load after waiting.');
    if (loadingMsg) loadingMsg.innerText = 'Google Sign-In is unavailable right now. Please refresh and try again.';
  }
}

async function handleGuestGoogleCredentialResponse(response) {
  if (!response || !response.credential) return;

  const container = document.getElementById('guestGoogleButton');
  const loadingMsg = document.getElementById('guestGoogleLoadingMsg');
  if (container) container.style.pointerEvents = 'none';
  if (loadingMsg) {
    loadingMsg.style.display = 'block';
    loadingMsg.innerText = 'Signing in...';
  }

  try {
    const res = await fetch('/api/auth/google', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: response.credential })
    });

    const data = await res.json();
    if (!res.ok || data.status !== 'success') {
      throw new Error(data.message || 'Google sign-in failed.');
    }

    const userRecord = data.user || {};
    const fullName = userRecord.full_name || userRecord.username || '';
    const email = userRecord.email || '';

    try {
      localStorage.setItem('mm_user', JSON.stringify(userRecord));
    } catch (e) {
      console.warn('Unable to persist mm_user:', e);
    }

    if (fullName) currentRecipient.name = String(fullName).trim();
    if (email) currentRecipient.email = String(email).trim();

    renderRecipientDetails();
    closeRecipientModal();

    // Refresh the order summary now that the guest is signed in, so loyalty
    // points and account-based pricing kick in without losing the cart items.
    if (typeof window.renderOrderSummaryModal === 'function') {
      await window.renderOrderSummaryModal(currentOrderSummaryItems);
    }
  } catch (err) {
    showSweetAlert({
      icon: 'error',
      title: 'Google Sign-In Error',
      text: err.message,
      confirmButtonText: 'Try Again',
      showCancelButton: false
    });
  } finally {
    if (container) container.style.pointerEvents = '';
    if (loadingMsg) loadingMsg.style.display = 'none';
  }
}

window.openRecipientModal = function() {
  const modal = document.getElementById('recipientEditModal');
  const summaryModal = document.getElementById('orderSummaryModal');

  // Force the recipient modal above the order summary modal regardless of
  // whatever z-index the stylesheet gives .product-modal-backdrop. The
  // modal's own inline z-index (1000002) is already higher than this, so
  // only raise it — never lower it back down.
  if (summaryModal) summaryModal.style.zIndex = '9000';
  if (modal) {
    const currentZ = parseInt(modal.style.zIndex, 10) || 0;
    if (currentZ < 10000) modal.style.zIndex = '10000';
    modal.classList.add('active');
  }

  initGuestGoogleSignIn();
};

window.closeRecipientModal = function(event) {
  if (event && event.target) return;
  const modal = document.getElementById('recipientEditModal');
  if (modal) modal.classList.remove('active');
};

// ==========================================
// TERMS & CONDITIONS MODAL
// ==========================================
window.openTermsModal = function(event) {
  if (event) event.preventDefault();
  const modal = document.getElementById('termsConditionsModal');
  if (modal) {
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
  }
  // The sheet intentionally stops short of the screen bottom (see the
  // max-height calc in orderSummary.css) so its own action buttons are
  // never squeezed under the fixed mobile bottom nav. But that nav sits at
  // z-index 999999, still under the modal's z-index, so it was showing
  // through, fully lit, in that reserved gap on small/short phones (e.g.
  // 360x700) instead of the dimmed backdrop  looking like a layout bug.
  // Hide it for as long as the terms modal is open.
  const bottomNav = document.getElementById('mobileBottomNav');
  if (bottomNav) bottomNav.style.display = 'none';
};

window.closeTermsModal = function(event) {
  // A click on the dark backdrop passes the click event in; ignore it, same
  // as the other modals on this page. Only the explicit close controls
  // (X button / "Decline" / "Accept" buttons) call this with no event.
  if (event && event.target) return;
  const modal = document.getElementById('termsConditionsModal');
  if (modal) modal.classList.remove('active');
  document.body.style.overflow = '';
  const bottomNav = document.getElementById('mobileBottomNav');
  if (bottomNav) bottomNav.style.display = '';
};

window.acceptTermsAndClose = function() {
  const checkbox = document.getElementById('agreeTermsCheckbox');
  if (checkbox) {
    checkbox.checked = true;
    validateTermsAgreement(checkbox);
  }
  closeTermsModal();
};

(function setupTermsModalAccordion() {
  const buttons = document.querySelectorAll('#termsConditionsModal .terms-header');
  buttons.forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      const item = btn.closest('.terms-item');
      if (!item) return;

      const content = item.querySelector('.terms-content');
      const isOpen = item.classList.contains('open');

      item.parentElement
        .querySelectorAll('.terms-item.open')
        .forEach(function (openItem) {
          openItem.classList.remove('open');
          const openContent = openItem.querySelector('.terms-content');
          if (openContent) openContent.style.maxHeight = null;
        });

      if (!isOpen) {
        item.classList.add('open');
        if (content) content.style.maxHeight = content.scrollHeight + 'px';
      }
    });
  });
})();

function buildReceiptDOM(order) {
  let container = document.getElementById('printableReceiptContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'printableReceiptContainer';
    container.style.position = 'fixed';
    container.style.left = '-9999px';
    container.style.top = '0';
    document.body.appendChild(container);
  }

  const orderItems = order.items || currentOrderSummaryItems;
  const formattedItems = orderItems.map(item => {
    const rawPrice = item.unit_price ?? item.price ?? 15.00;
    const price = parseFloat(String(rawPrice).replace(/[^0-9.]/g, '')) || 15.00;
    const qty = parseInt(item.quantity ?? 1, 10);
    return `
      <tr style="border-bottom: 1px dashed #FCE1DD;">
        <td style="padding: 8px 4px; font-size: 12px; color: #594A42;">
          <strong>${item.size || '12oz'} ${item.title || 'Milky Marble Cup'}</strong><br>
          <span style="font-size: 10.5px; color: #7C4F38;">${item.toppings || ''} ${item.addons || ''}</span>
        </td>
        <td style="padding: 8px 4px; font-size: 12px; text-align: center; color: #594A42;">${qty}x</td>
        <td style="padding: 8px 4px; font-size: 12px; text-align: right; font-weight: 700; color: #594A42;">₱ ${(price * qty).toFixed(2)}</td>
      </tr>
    `;
  }).join('');

  const customerName = order.guest_name || order.recipient_name || currentRecipient.name || 'Valued Customer';
  const customerEmail = order.guest_email || order.recipient_email || currentRecipient.email || 'customer@gmail.com';
  const pointsUsedNum = parseFloat(order.points_used || 0);
  const totalAmountNum = parseFloat(order.total_amount || 0);
  const pointsEarnedNum = parseFloat(order.points_earned || 0);

  container.innerHTML = `
    <div id="receiptPDFContent" style="width: 380px; padding: 28px; background: #FFFDFD; font-family: 'Urbanist', Arial, sans-serif; color: #594A42; border: 2px solid #FCE1DD; border-radius: 20px;">
      <div style="text-align: center; margin-bottom: 16px;">
        <h2 style="font-family: 'Fredoka', cursive, sans-serif; font-size: 24px; color: #F48A8E; margin: 0;">Milky Marble</h2>
        <p style="font-size: 11.5px; color: #7C4F38; margin: 4px 0 0;">Handcrafted Bouncy Sips & Layered Treats</p>
      </div>
      
      <div style="font-size: 12px; border-top: 1px dashed #FCE1DD; border-bottom: 1px dashed #FCE1DD; padding: 10px 0; margin-bottom: 14px; line-height: 1.5;">
        <div><strong>Order No:</strong> ${order.order_number || '#MM-0000'}</div>
        <div><strong>Customer:</strong> ${customerName}</div>
        <div><strong>Email:</strong> ${customerEmail}</div>
        <div><strong>Pick-up Schedule:</strong> ${order.pickup_date || 'N/A'}</div>
        <div><strong>Payment:</strong> ${selectedPaymentMethod || 'Cash on Pick-Up'}</div>
      </div>

      <table style="width: 100%; border-collapse: collapse; margin-bottom: 14px;">
        <thead>
          <tr style="border-bottom: 1.5px solid #FCE1DD; font-size: 11px; text-transform: uppercase; color: #7C4F38;">
            <th style="text-align: left; padding-bottom: 6px;">Item</th>
            <th style="text-align: center; padding-bottom: 6px;">Qty</th>
            <th style="text-align: right; padding-bottom: 6px;">Total</th>
          </tr>
        </thead>
        <tbody>
          ${formattedItems}
        </tbody>
      </table>

      <div style="border-top: 1.5px solid #FCE1DD; padding-top: 8px; font-size: 12.5px; display: flex; flex-direction: column; gap: 4px;">
        <div style="display: flex; justify-content: space-between;">
          <span>Subtotal:</span>
          <span>₱ ${currentSubtotal.toFixed(2)}</span>
        </div>
        ${appliedPromoDiscount > 0 ? `
          <div style="display: flex; justify-content: space-between; color: #2e7d32;">
            <span>Promo Discount:</span>
            <span>- ₱ ${appliedPromoDiscount.toFixed(2)}</span>
          </div>
        ` : ''}
        ${pointsUsedNum > 0 ? `
          <div style="display: flex; justify-content: space-between; color: #E27D80; font-weight: 700;">
            <span>Points Discount (${pointsUsedNum.toFixed(2)} pts):</span>
            <span>- ₱ ${pointsUsedNum.toFixed(2)}</span>
          </div>
        ` : ''}
        <div style="display: flex; justify-content: space-between; font-size: 16px; font-weight: 800; border-top: 1px dashed #FCE1DD; padding-top: 6px; margin-top: 4px;">
          <span>Total Paid:</span>
          <span style="color: #F48A8E;">₱ ${totalAmountNum.toFixed(2)}</span>
        </div>
        ${pointsEarnedNum > 0 ? `
          <div style="background: #FFF5F4; border-radius: 8px; padding: 6px; text-align: center; margin-top: 8px; font-size: 11.5px; font-weight: 700;">
            Points Earned: +${pointsEarnedNum.toFixed(2)} pts
          </div>
        ` : ''}
      </div>

      <div style="text-align: center; margin-top: 18px; font-size: 11px; color: #7C4F38;">
        Thank you for your sweet support! See you at the Marble Bar!
      </div>
    </div>
  `;
}

window.downloadReceiptPDF = function() {
  if (!lastPlacedOrderData) return;
  buildReceiptDOM(lastPlacedOrderData);

  const element = document.getElementById('receiptPDFContent');
  if (!element || typeof html2pdf === 'undefined') {
    return;
  }

  const opt = {
    margin: 10,
    filename: `Receipt_${lastPlacedOrderData.order_number || 'MilkyMarble'}.pdf`,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true },
    jsPDF: { unit: 'mm', format: 'a5', orientation: 'portrait' }
  };

  html2pdf().set(opt).from(element).save();
};

window.confirmPlaceOrder = async function() {
  const cleanName = (currentRecipient.name || '').trim();
  const cleanEmail = (currentRecipient.email || '').trim();

  if (!cleanName || !cleanEmail || cleanName === 'Valued Customer' || cleanEmail === 'customer@gmail.com') {
    showSweetAlert({
      icon: 'warning',
      title: 'Sign In Required',
      text: 'Please sign in with Gmail so we know who is picking up these sweet sips!',
      confirmButtonText: 'Sign In',
      showCancelButton: false,
      focusConfirm: false
    }).then(() => {
      openRecipientModal();
    });
    return;
  }

  if (!cleanEmail.includes('@') || !cleanEmail.includes('.')) {
    showSweetAlert({
      icon: 'warning',
      title: 'Invalid Email',
      text: 'We could not read a valid email from your Google account. Please try signing in again.',
      confirmButtonText: 'Sign In Again',
      showCancelButton: false,
      focusConfirm: false
    }).then(() => {
      openRecipientModal();
    });
    return;
  }

  const pickupInput = document.getElementById('pickupDateInput');
  const dateReq = document.getElementById('dateRequiredMsg');
  const dateErr = document.getElementById('dateErrorMsg');

  if (!pickupInput || !pickupInput.value) {
    if (dateReq) dateReq.style.display = 'block';
    return;
  }

  const parts = pickupInput.value.split('-');
  if (parts.length === 3) {
    const selected = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    const day = selected.getDay();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (selected < today || (day !== 1 && day !== 2 && day !== 4)) {
      if (dateErr) dateErr.style.display = 'block';
      return;
    }
  }

  const paymentPills = document.querySelectorAll('.payment-method-pill');
  if (paymentPills.length > 0 && !selectedPaymentMethod) {
    const paymentReq = document.getElementById('paymentRequiredMsg');
    if (paymentReq) paymentReq.style.display = 'block';
    return;
  }

  const agreeTermsCheckbox = document.getElementById('agreeTermsCheckbox');
  if (!agreeTermsCheckbox || !agreeTermsCheckbox.checked) {
    const termsReq = document.getElementById('termsRequiredMsg');
    if (termsReq) termsReq.style.display = 'block';
    if (agreeTermsCheckbox) agreeTermsCheckbox.focus();
    return;
  }

  const activeCustomer = await getActiveCustomerProfile();
  const isGuest = !activeCustomer;
  const customerId = activeCustomer ? activeCustomer.id : null;
  const userId = activeCustomer ? (activeCustomer.user_id || activeCustomer.id) : null;

  const isPointsToggled = !isGuest && (document.getElementById('toggleUseLoyaltyPoints')?.checked || false);
  const pointsToUse = isPointsToggled ? appliedLoyaltyDiscount : 0.0;
  const finalPayableTotal = Math.max(0, currentSubtotal - appliedPromoDiscount - pointsToUse);

  // Loyalty Points Computation: Every ₱10 spent = 0.10 loyalty points (₱100 = 1.00 pt)
  const calculatedPointsEarned = !isGuest 
    ? Number((Math.floor(finalPayableTotal / 10) * 0.10).toFixed(2)) 
    : 0.0;

  const isCustomCup = currentOrderSummaryItems.some(it => it.is_custom || it.custom_build);
  const orderTypeVal = isCustomCup ? 'custom_build' : 'preset';

  const paymentMethodForOrder = selectedPaymentMethod || 'Cash on Pick-Up';
  selectedPaymentMethod = paymentMethodForOrder;

  const payload = {
    customer_id: customerId,
    user_id: userId,
    items: currentOrderSummaryItems,
    subtotal: currentSubtotal,
    discount_amount: appliedPromoDiscount,
    points_used: pointsToUse,
    points_earned: calculatedPointsEarned,
    order_type: orderTypeVal,
    total_amount: finalPayableTotal,
    payment_method: paymentMethodForOrder,
    pickup_date: pickupInput.value,
    pickup_instructions: `Pick-up: ${pickupInput.value}`,
    guest_name: cleanName,
    guest_email: cleanEmail,
    recipient_name: cleanName,
    recipient_email: cleanEmail
  };

  const submitBtn = document.getElementById('btnPlaceOrderSubmit');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerText = 'Placing Order...';
  }

  try {
    const res = await fetch('/api/orders', {
      method: 'POST',
      credentials: 'include',
      headers: { 
        'Content-Type': 'application/json',
        ...(customerId ? { 'x-customer-id': String(customerId) } : {})
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json();

    if (res.ok && data.status === 'success') {
      const orderObj = data.order || data.data || {};
      if (!isGuest && customerId) {
        try { localStorage.setItem(lastPaymentStorageKey(customerId), paymentMethodForOrder); } catch (e) {}
      }
      const isEwallet = /wallet|gcash|maya|online|paymongo/i.test(paymentMethodForOrder) && !paymentMethodForOrder.toLowerCase().includes('cash');
      const needsEwalletPayment = isEwallet && orderObj.status !== 'PAID_VERIFIED';

      const guestSessionId = sessionStorage.getItem('mm_guest_session_id');
      const clearCartPayload = isGuest
        ? { action: 'clear', session_id: guestSessionId }
        : { action: 'clear', customer_id: customerId };

      // Removes the ordered items from the cart right when the order is saved,
      // so it never depends on the customer pressing "Got It".
      const clearCartRequest = async () => {
        try {
          await fetch('/api/cart', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(clearCartPayload)
          });
        } catch (err) {
          console.warn('Could not auto-clear cart:', err);
        }

        const cartBadge = document.getElementById('navCartCount');
        if (cartBadge) {
          cartBadge.innerText = '0';
          cartBadge.style.display = 'none';
        }

        // On the cart page, re-render the list so the ordered items disappear now.
        if (typeof window.loadCartItems === 'function') {
          try { await window.loadCartItems(); } catch (e) {}
        }
      };

      if (needsEwalletPayment) {
        try {
          const payRes = await fetch('/api/payments/create-checkout', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              order_id: orderObj.id || orderObj.order_id,
              billing_name: cleanName,
              billing_email: cleanEmail,
              customer_id: customerId,
              user_id: userId
            })
          });
          const payData = await payRes.json();

          if (payRes.ok && payData.status === 'success' && payData.checkout_url) {
            await clearCartRequest();
            window.location.href = payData.checkout_url;
            return;
          }

          throw new Error(payData.message || 'Could not start PayMongo checkout.');
        } catch (payErr) {
          console.error('PayMongo checkout error:', payErr);
          showSweetAlert({
            icon: 'error',
            title: 'Payment Could Not Start',
            text: payErr.message || 'We placed your order, but could not open the PayMongo payment page. Please try paying again from your Orders page.',
            confirmButtonText: 'OK',
            showCancelButton: false
          });
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerText = 'Place Order';
          }
          return;
        }
      }

      closeOrderSummaryModal();
      await clearCartRequest();

      // I-update ang Loyalty Points sa Screen at sa Local Storage gamit ang 0.10 pts ratio
      const earned = calculatedPointsEarned;
      const used = parseFloat(data.points_used ?? pointsToUse ?? 0);

      if (!isGuest) {
        let updatedBalance;
        if (data.new_loyalty_points !== undefined && data.new_loyalty_points !== null) {
          updatedBalance = parseFloat(data.new_loyalty_points);
        } else {
          updatedBalance = Math.max(0, availableLoyaltyPoints - used + earned);
        }

        availableLoyaltyPoints = updatedBalance;

        const ptsHeader = document.getElementById('displayLoyaltyPoints');
        const pesoHeader = document.getElementById('displayLoyaltyPeso');
        if (ptsHeader) ptsHeader.innerText = `${updatedBalance.toFixed(2)} pts`;
        if (pesoHeader) pesoHeader.innerText = `(₱${(updatedBalance * 1.0).toFixed(2)})`;

        const localUser = getStoredUser();
        localUser.loyalty_points = updatedBalance;
        localStorage.setItem('mm_user', JSON.stringify(localUser));

        await syncCustomerLoyaltyPoints();
      }

      lastPlacedOrderData = {
        ...orderObj,
        items: currentOrderSummaryItems,
        points_used: used,
        points_earned: isGuest ? 0 : earned,
        total_amount: finalPayableTotal,
        pickup_date: pickupInput.value,
        guest_name: cleanName,
        guest_email: cleanEmail,
        recipient_name: cleanName,
        recipient_email: cleanEmail
      };

      if (typeof loadRecentOrders === 'function') {
        loadRecentOrders();
      }

      let loyaltyBadgeHTML = '';
      if (!isGuest && earned > 0) {
        loyaltyBadgeHTML = `
          <div style="background: #FFF5F4; border-radius: 12px; padding: 10px; margin: 10px 0; font-weight: 800; color: #594A42;">
            You earned +${earned.toFixed(2)} loyalty points!
          </div>
        `;
      }

      showSweetAlert({
        icon: 'success',
        title: 'Order Confirmed!',
        html: `
          <p style="color: #7C4F38; font-size: 14px; margin-bottom: 8px;">Order No: <strong>${orderObj.order_number || '#MM-SUCCESS'}</strong></p>
          ${(!isGuest && used > 0) ? `<p style="color: #E27D80; font-weight: 700; margin: 4px 0;">Points Used: -${used.toFixed(2)} pts</p>` : ''}
          ${loyaltyBadgeHTML}
          <button type="button" class="btn-download-receipt" onclick="downloadReceiptPDF()" style="margin-top: 10px; padding: 8px 18px; font-weight: 800; border-radius: 99px; border: 1.5px solid #FCE1DD; background: #FFF; color: #F48A8E; cursor: pointer;">
            <i class="fa-solid fa-file-arrow-down"></i> Download Receipt (PDF)
          </button>
        `,
        confirmButtonText: 'Got It!',
        showCancelButton: false,
        focusConfirm: false,
        allowOutsideClick: false,
        allowEscapeKey: false
      });
    } else {
      showSweetAlert({
        icon: 'error',
        title: 'Failed to Place Order',
        text: data.message || 'Could not save your order.',
        confirmButtonText: 'OK',
        showCancelButton: false
      });
    }
  } catch (err) {
    console.error('Order error:', err);
    showSweetAlert({
      icon: 'error',
      title: 'Connection Error',
      text: 'Could not connect to the server.',
      confirmButtonText: 'OK',
      showCancelButton: false
    });
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerText = 'Place Order';
    }
  }
};