// js/home.js - Milky Marble Customer Portal Logic

const PRESET_SIGNATURES = [
  {
    id: 1,
    title: "Chocolatey Coffee\nNoodly Jelly",
    flavor: "Coffee",
    variation: "Spaghetti",
    toppings: ["Nuts", "Chocolate Chips"],
    accent_color: "#664638",
    image: "images/Chocolatey Coffee Noodly Jelly.png",
    price_8oz: 15.00,
    price_12oz: 19.00,
    rating: "0.0"
  },
  {
    id: 2,
    title: "Cheesy Pandan Cubes",
    flavor: "Buko Pandan",
    variation: "Cubes",
    toppings: ["Cheese", "Tapioca Pearls"],
    accent_color: "#8bb35c",
    image: "images/Cheesy Pandan Cubes.png",
    price_8oz: 15.00,
    price_12oz: 19.00,
    rating: "0.0"
  },
  {
    id: 3,
    title: "Bubbly Coffee Jelly",
    flavor: "Coffee",
    variation: "Cubes",
    toppings: ["Marshmallows", "Tapioca Pearls"],
    accent_color: "#664638",
    image: "images/Bubbly Coffee Jelly.png",
    price_8oz: 15.00,
    price_12oz: 19.00,
    rating: "0.0"
  },
  {
    id: 4,
    title: "Strawberry String Party",
    flavor: "Strawberry",
    variation: "Spaghetti",
    toppings: ["Marshmallows", "Sprinkles (Assorted)"],
    accent_color: "#f48a8e",
    image: "images/Strawberry String Party.png",
    price_8oz: 15.00,
    price_12oz: 19.00,
    rating: "0.0"
  },
   {
    id: 5,
    title: "Test Item\n(₱1 Payment Check)",
    flavor: "Pandan",
    variation: "Cubes",
    toppings: ["Cheese"],
    accent_color: "#8bb35c",
    image: "images/Cheesy Pandan Cubes.png",
    price_8oz: 1.00,
    price_12oz: 1.00,
    rating: "0.0"
  }
];

const AVAILABLE_TOPPINGS = ['Cheese', 'Tapioca', 'Marshmallow', 'Nuts', 'Assorted Sprinkles', 'Choco Sprinkles', 'Choco Chips'];
const TOPPING_PRICES = {
  'Cheese': 2.00,
  'Tapioca': 2.00,
  'Marshmallow': 2.00,
  'Nuts': 2.00,
  'Assorted Sprinkles': 2.00,
  'Choco Sprinkles': 2.00,
  'Choco Chips': 5.00,
  'Condensed Milk': 5.00
};

const STAGE_CHOICES = {
  flavor: [
    { id: 'Strawberry', label: 'Strawberry' },
    { id: 'Pandan', label: 'Pandan' },
    { id: 'Coffee', label: 'Coffee' }
  ],
  jelly: [
    { id: 'Spaghetti', label: 'Spaghetti' },
    { id: 'Cube', label: 'Cube' },
    { id: 'Whole', label: 'Whole' }
  ]
};

const STAGES = ['cup', 'flavor', 'jelly', 'toppings', 'addons'];
let currentStageIndex = 0;

let customConfig = {
  size: '12oz',
  flavor: 'Pandan',
  jelly: 'Cube',
  toppings: [],
  activeToppingSlot: 0,
  addonsMap: {},
  utensils: 'No Spoon',
  basePrice: 19.00
};

let currentModalDrink = null;
let currentModalSize = null;
let currentModalQty = 1;
let activeModalAllReviews = [];

function showSweetAlert(options) {
  if (typeof Swal === 'undefined') return Promise.resolve({ isConfirmed: false });
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
    ...options
  });
}

function getActiveCartPayload() {
  const user = JSON.parse(localStorage.getItem('mm_user') || '{}');
  if (user && user.customer_id) {
    return { customer_id: user.customer_id };
  }

  let guestSessionId = sessionStorage.getItem('mm_guest_session_id');
  if (!guestSessionId) {
    guestSessionId = 'guest_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
    sessionStorage.setItem('mm_guest_session_id', guestSessionId);
  }
  return { session_id: guestSessionId };
}

const CartAlert = {
  showModal: function({
    title = 'Cup',
    size = '12oz',
    image = '',
    flavor_img = '',
    toppings_img = '',
    cup_img = '',
    accent_color = '#F48A8E',
    onCheckout = null
  } = {}) {
    const resolvedCup = cup_img || (size === '8oz' ? 'images/Layer 3/Small Cup.png' : 'images/Layer 3/Large Cup.png');
    let thumbHTML = '';

    if (image) {
      thumbHTML = `
        <div class="mm-swal-thumb-box" style="background: ${accent_color}22;">
          <img src="${image}" class="mm-swal-img" alt="Drink">
        </div>
      `;
    } else if (flavor_img || resolvedCup) {
      thumbHTML = `
        <div class="mm-swal-thumb-box" style="background: ${accent_color}22;">
          <div class="composite-cart-thumb notif-thumb-composite">
            ${flavor_img ? `<img src="${flavor_img}" class="cart-layer-flavor" alt="Flavor">` : ''}
            ${toppings_img ? `<img src="${toppings_img}" class="cart-layer-toppings" alt="Toppings">` : ''}
            <img src="${resolvedCup}" class="cart-layer-cup" alt="Cup">
          </div>
        </div>
      `;
    }

    return showSweetAlert({
      icon: 'success',
      title: 'Added to Sweet Bag!',
      html: `
        ${thumbHTML}
        <div class="mm-swal-item-name">${size} ${title}</div>
        <p class="mm-swal-item-sub">Ready to pop the straw or craving more treats?</p>
      `,
      showCancelButton: true,
      confirmButtonText: 'View Cart',
      cancelButtonText: 'Keep Browsing',
      reverseButtons: true
    }).then((result) => {
      if (result.isConfirmed) {
        if (typeof onCheckout === 'function') {
          onCheckout();
        } else {
          window.location.href = 'cart.html';
        }
      }
    });
  }
};

// ==========================================
// PRESET SIGNATURE DRINKS
// ==========================================
function renderSignatureDrinks() {
  const container = document.getElementById('productsGridContainer');
  if (!container) return;

  container.innerHTML = PRESET_SIGNATURES.map((drink) => {
    const searchKeywords = (drink.title + ' ' + drink.flavor + ' ' + drink.variation + ' ' + drink.toppings.join(' ')).toLowerCase();
    const encodedData = encodeURIComponent(JSON.stringify(drink));

    return `
      <div class="product-card" data-search-keywords="${searchKeywords}" onclick="openProductModal('${encodedData}')">
        <div class="product-img-wrapper" style="--thumb-accent: ${drink.accent_color};">
          <img src="${drink.image}" alt="${drink.title.replace('\n', ' ')}" class="product-img" loading="lazy">
        </div>
        <div class="product-details">
          <h2 class="product-title">${drink.title.replace('\n', '<br>')}</h2>
          <div class="product-specs">
            <div class="spec-line">Flavor: <span class="spec-val">${drink.flavor}</span></div>
            <div class="spec-line">Variation: <span class="spec-val">${drink.variation}</span></div>
            <div class="spec-line">Toppings:</div>
            <ul class="toppings-list">
              ${drink.toppings.map(t => `<li>${t}</li>`).join('')}
            </ul>
          </div>
          <div class="product-footer" onclick="event.stopPropagation()">
            <div class="rating-badge">
              <i class="fa-regular fa-star"></i>
              <span id="card-rating-${drink.id}">${drink.rating}</span>
            </div>
            <div class="product-actions">
              <button type="button" class="btn-buy" onclick="openProductModal('${encodedData}')">Buy Now</button>
              <button type="button" class="btn-cart-add" title="Add to Cart" onclick="openProductModal('${encodedData}')">
                <i class="fa-solid fa-cart-plus"></i>
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

async function loadLiveRatingsSummary() {
  try {
    const res = await fetch('/api/ratings/summary');
    const data = await res.json();

    if (res.ok && data.status === 'success') {
      const ratingsMap = data.ratings || {};

      PRESET_SIGNATURES.forEach(drink => {
        const cleanKey = drink.title.replace(/\r?\n|\r/g, ' ').trim().toLowerCase();
        let matchedScore = null;

        if (ratingsMap[cleanKey] !== undefined) {
          matchedScore = ratingsMap[cleanKey];
        } else {
          const foundKey = Object.keys(ratingsMap).find(k => cleanKey.includes(k) || k.includes(cleanKey));
          if (foundKey) {
            matchedScore = ratingsMap[foundKey];
          }
        }

        drink.rating = (matchedScore !== null && matchedScore > 0) ? matchedScore.toFixed(1) : "0.0";

        const cardRatingEl = document.getElementById(`card-rating-${drink.id}`);
        if (cardRatingEl) {
          cardRatingEl.innerText = drink.rating;
        }
      });
    }
  } catch (err) {
    console.warn('Could not load ratings summary:', err);
  }
}

window.openProductModal = function(encodedData) {
  const drink = JSON.parse(decodeURIComponent(encodedData));
  currentModalDrink = drink;
  currentModalSize = null;
  currentModalQty = 1;

  const sizeErr = document.getElementById('modalSizeRequiredMsg');
  if (sizeErr) sizeErr.style.display = 'none';

  document.getElementById('modalDrinkImg').src = drink.image;
  document.getElementById('modalDrinkBox').style.setProperty('--thumb-accent', drink.accent_color || '#F48A8E');
  document.getElementById('modalDrinkTitle').innerText = drink.title.replace('\n', ' ');
  document.getElementById('modalDrinkRating').innerText = drink.rating;
  document.getElementById('modalDrinkFlavor').innerText = drink.flavor;
  document.getElementById('modalDrinkVariation').innerText = drink.variation;

  const toppingsList = document.getElementById('modalDrinkToppings');
  toppingsList.innerHTML = drink.toppings.map(t => `<li>${t}</li>`).join('');

  document.querySelectorAll('.size-pill').forEach(btn => btn.classList.remove('active'));
  document.getElementById('modalQtyDisplay').innerText = currentModalQty;

  updateModalPrice();
  fetchLiveProductReviews(drink.title.replace('\n', ' '));

  const modal = document.getElementById('productModal');
  modal.classList.add('active');
  document.body.style.overflow = 'hidden';
};

window.closeProductModal = function() {
  const modal = document.getElementById('productModal');
  if (modal) modal.classList.remove('active');
  document.body.style.overflow = '';
};

window.selectModalSize = function(size, btn) {
  currentModalSize = size;
  document.querySelectorAll('.size-pill').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

  const sizeErr = document.getElementById('modalSizeRequiredMsg');
  if (sizeErr) sizeErr.style.display = 'none';

  updateModalPrice();
};

window.changeModalQty = function(delta) {
  currentModalQty = Math.max(1, currentModalQty + delta);
  document.getElementById('modalQtyDisplay').innerText = currentModalQty;
  updateModalPrice();
};

function updateModalPrice() {
  if (!currentModalDrink) return;
  if (!currentModalSize) {
    document.getElementById('modalDrinkPrice').innerText = `₱ ${currentModalDrink.price_8oz.toFixed(2)} - ₱ ${currentModalDrink.price_12oz.toFixed(2)}`;
    return;
  }
  const unit = currentModalSize === '12oz' ? currentModalDrink.price_12oz : currentModalDrink.price_8oz;
  document.getElementById('modalDrinkPrice').innerText = `₱ ${(unit * currentModalQty).toFixed(2)}`;
}

window.addModalItemToCart = async function() {
  if (!currentModalDrink) return;
  if (!currentModalSize) {
    const err = document.getElementById('modalSizeRequiredMsg');
    if (err) err.style.display = 'block';
    return;
  }

  const unitPrice = currentModalSize === '12oz' ? currentModalDrink.price_12oz : currentModalDrink.price_8oz;
  const titleClean = currentModalDrink.title.replace('\n', ' ');

  const payload = {
    title: titleClean,
    size: currentModalSize,
    flavor: currentModalDrink.flavor,
    variation: currentModalDrink.variation,
    toppings: currentModalDrink.toppings.join(', '),
    addons: '',
    unit_price: unitPrice,
    quantity: currentModalQty,
    accent_color: currentModalDrink.accent_color,
    image: currentModalDrink.image
  };

  const idPayload = getActiveCartPayload();

  try {
    const res = await fetch('/api/cart', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'x-session-id': idPayload.session_id || ''
      },
      body: JSON.stringify({ 
        action: 'add', 
        item: payload,
        ...idPayload
      })
    });
    if (!res.ok) throw new Error('Failed to add to cart');
  } catch (e) {
    console.error('Add to cart error:', e);
  }

  closeProductModal();
  CartAlert.showModal({
    title: payload.title,
    size: payload.size,
    image: payload.image,
    accent_color: payload.accent_color
  });
  updateCartCount();
};

window.proceedToOrderSummary = function() {
  if (!currentModalDrink) return;
  if (!currentModalSize) {
    const err = document.getElementById('modalSizeRequiredMsg');
    if (err) {
      err.style.display = 'block';
      err.scrollIntoView({ behavior: 'smooth' });
    }
    return;
  }

  closeProductModal();

  const unitPrice = currentModalSize === '12oz' 
    ? (currentModalDrink.price_12oz || 19.00) 
    : (currentModalDrink.price_8oz || 15.00);

  const resolvedCup = (currentModalSize === '8oz') 
    ? 'images/Layer 3/Small Cup.png' 
    : 'images/Layer 3/Large Cup.png';

  const items = [{
    title: currentModalDrink.title.replace('\n', ' '),
    size: currentModalSize,
    is_custom: false,
    image: currentModalDrink.image,
    flavor_img: currentModalDrink.image,
    toppings_img: '',
    cup_img: resolvedCup,
    accent_color: currentModalDrink.accent_color,
    toppings: '+ ' + currentModalDrink.toppings.join(' + '),
    addons: '',
    unit_price: unitPrice,
    quantity: currentModalQty
  }];

  if (typeof renderOrderSummaryModal === 'function') {
    renderOrderSummaryModal(items);
  }
};

// ==========================================
// LIVE RATINGS & REVIEWS ENGINE
// ==========================================
function fetchLiveProductReviews(title) {
  const listEl = document.getElementById('modalReviewsList');
  if (!listEl) return;
  
  listEl.innerHTML = '<div style="padding: 20px; color: #7C4F38; text-align: center;"><i class="fa-solid fa-spinner fa-spin"></i> Loading sweet reviews...</div>';

  fetch('/api/ratings?title=' + encodeURIComponent(title))
    .then(res => res.json())
    .then(data => {
      if (data.status === 'success') {
        activeModalAllReviews = data.reviews || [];
        const count = data.review_count || activeModalAllReviews.length;
        const score = parseFloat(data.average_score) || 0.0;

        const displayScore = (count > 0 && score > 0) ? score.toFixed(1) : "0.0";
        document.getElementById('modalReviewScore').innerText = displayScore;
        document.getElementById('modalDrinkRating').innerText = displayScore;

        renderReviewStarsHeader(parseFloat(displayScore));
        renderFilteredReviewCards(activeModalAllReviews);
      } else {
        listEl.innerHTML = '<div style="padding: 20px; color: #888; text-align: center;">No reviews available.</div>';
      }
    })
    .catch(() => {
      listEl.innerHTML = '<div style="padding: 20px; color: #888; text-align: center;">Could not load reviews.</div>';
    });
}

function renderReviewStarsHeader(score) {
  const container = document.getElementById('modalStarsRow');
  if (!container) return;
  container.innerHTML = '';
  
  if (score === 0) {
    for (let i = 1; i <= 5; i++) {
      container.innerHTML += '<i class="fa-regular fa-star" style="color: #f7a93b;"></i>';
    }
    return;
  }

  for (let i = 1; i <= 5; i++) {
    if (score >= i) {
      container.innerHTML += '<i class="fa-solid fa-star" style="color: #f7a93b;"></i>';
    } else if (score >= i - 0.5) {
      container.innerHTML += '<i class="fa-solid fa-star-half-stroke" style="color: #f7a93b;"></i>';
    } else {
      container.innerHTML += '<i class="fa-regular fa-star" style="color: #f7a93b;"></i>';
    }
  }
}

window.filterModalReviews = function(stars, btnElement) {
  document.querySelectorAll('.rating-filter-pill').forEach(p => p.classList.remove('active'));
  btnElement.classList.add('active');

  if (stars === 'all') {
    renderFilteredReviewCards(activeModalAllReviews);
  } else {
    const filtered = activeModalAllReviews.filter(r => parseInt(r.rating_score, 10) === parseInt(stars, 10));
    renderFilteredReviewCards(filtered);
  }
};

function renderFilteredReviewCards(reviewsList) {
  const listEl = document.getElementById('modalReviewsList');
  if (!listEl) return;
  listEl.innerHTML = '';

  if (!reviewsList || reviewsList.length === 0) {
    listEl.innerHTML = `
      <div style="text-align: center; padding: 24px 16px; color: #999;">
        <i class="fa-regular fa-star" style="font-size: 1.8rem; color: #d4c8c1; margin-bottom: 6px;"></i>
        <p style="font-size: 0.95rem; font-weight: 700; color: #664638; margin: 0;">No reviews yet for this filter.</p>
        <p style="font-size: 0.85rem; margin-top: 4px; color: #7C4F38;">Be the first to pop the straw and rate your sip!</p>
      </div>
    `;
    return;
  }

  reviewsList.forEach(rev => {
    let starIcons = '';
    const score = parseInt(rev.rating_score, 10) || 5;
    for (let s = 1; s <= 5; s++) {
      starIcons += `<i class="${s <= score ? 'fa-solid' : 'fa-regular'} fa-star" style="color: #f7a93b; font-size: 12px;"></i>`;
    }

    let tagBadges = '';
    if (rev.experience_tags) {
      const tagArr = typeof rev.experience_tags === 'string' ? rev.experience_tags.split(',') : rev.experience_tags;
      tagArr.forEach(tg => {
        if (String(tg).trim()) {
          tagBadges += `<span style="display: inline-block; padding: 2px 8px; background: #faf4ef; border: 1px solid #eddcd1; border-radius: 99px; font-size: 11px; font-weight: 700; color: #664638; margin-right: 4px; margin-top: 4px;">${String(tg).trim()}</span>`;
        }
      });
    }

    const dateStr = rev.created_at 
      ? new Date(rev.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) 
      : '';

    const avatarHTML = rev.reviewer_avatar
      ? `<img src="${rev.reviewer_avatar}" alt="${rev.reviewer_name || 'Customer'}" style="width: 36px; height: 36px; border-radius: 50%; object-fit: cover; flex-shrink: 0; margin-top: 2px;" onerror="this.outerHTML='<div class=&quot;review-avatar&quot; style=&quot;width: 36px; height: 36px; border-radius: 50%; background: #F48A8E; display: flex; align-items: center; justify-content: center; color: #fff; flex-shrink: 0; margin-top: 2px;&quot;><i class=&quot;fa-solid fa-user&quot; style=&quot;font-size: 15px;&quot;></i></div>'">`
      : `<div class="review-avatar" style="width: 36px; height: 36px; border-radius: 50%; background: #F48A8E; display: flex; align-items: center; justify-content: center; color: #fff; flex-shrink: 0; margin-top: 2px;">
          <i class="fa-solid fa-user" style="font-size: 15px;"></i>
        </div>`;

    listEl.innerHTML += `
      <div class="modal-review-card" style="margin-bottom: 12px; padding: 12px 14px; background: #fff; border: 1.5px solid #FCE1DD; border-radius: 18px; display: flex; align-items: flex-start; gap: 12px;">
        ${avatarHTML}
        <div class="review-body" style="flex: 1; min-width: 0;">
          <div class="review-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
            <span class="review-username" style="font-weight: 800; font-size: 13.5px; color: #4a3427;">${rev.reviewer_name || 'Customer'}</span>
            <div class="review-star-rate" style="display: flex; align-items: center; gap: 2px;">
              ${starIcons}
            </div>
          </div>
          ${tagBadges ? `<div style="margin-bottom: 6px;">${tagBadges}</div>` : ''}
          <p class="review-text" style="font-size: 13px; color: #594A42; margin: 0; line-height: 1.4; font-weight: 600;">${rev.review_text || 'Enjoyed this sweet cup!'}</p>
          ${dateStr ? `<span style="font-size: 11px; color: #a8948d; margin-top: 4px; display: block; font-weight: 500;">${dateStr}</span>` : ''}
        </div>
      </div>
    `;
  });
}

function getToppingUnitPrice(toppingName) {
  if (TOPPING_PRICES && TOPPING_PRICES[toppingName] !== undefined) {
    return parseFloat(TOPPING_PRICES[toppingName]);
  }
  return (toppingName === 'Choco Chips' || toppingName === 'Condensed Milk') ? 5.00 : 2.00;
}

function getLayer1ImagePath(flavor, jelly, isLarge) {
  const folder = isLarge ? 'Large Flavors' : 'Small Flavors';
  // File names on disk are e.g. "Pandan cube.png" - flavor stays Title Case,
  // jelly type is lowercase. Lowercasing the flavor breaks this on
  // case-sensitive filesystems (Vercel/Linux), even though it looks fine locally.
  const fName = flavor || 'Pandan';
  const jName = (jelly || 'Cube').toLowerCase();
  return `images/Layer 1/${folder}/${fName} ${jName}.png`;
}

function getLayer2ToppingPath(toppingName, isLarge) {
  if (!toppingName || toppingName === 'None' || toppingName === 'Condensed Milk') return null;
  const folder = isLarge ? 'Large Toppings' : 'Small Toppings';
  let fileName = toppingName === 'Marshmallow' ? 'Mashmallow' : toppingName;
  return `images/Layer 2/${folder}/${fileName}.png`;
}

function getLayer3CupPath(isLarge) {
  return isLarge ? 'images/Layer 3/Large Cup.png' : 'images/Layer 3/Small Cup.png';
}

function buildLayeredCupHTML(configOverride = {}, stackClass = 'tall-stack') {
  const cfg = Object.assign({}, customConfig, configOverride);
  const isLarge = cfg.size === '12oz';

  const l1Src = getLayer1ImagePath(cfg.flavor, cfg.jelly, isLarge);
  const l3Src = getLayer3CupPath(isLarge);

  let activeToppings = [...(cfg.toppings || [])];
  if (cfg.addonsMap) {
    Object.keys(cfg.addonsMap).forEach(ad => {
      if (cfg.addonsMap[ad] > 0 && ad !== 'Condensed Milk') activeToppings.push(ad);
    });
  }

  let l2ImagesHTML = '';
  activeToppings.forEach(t => {
    const tSrc = getLayer2ToppingPath(t, isLarge);
    if (tSrc) {
      l2ImagesHTML += `<img src="${tSrc}" class="layer-2-toppings" alt="${t}">`;
    }
  });

  return `
    <div class="cup-layer-stack ${stackClass}">
      <img src="${l1Src}" class="layer-1-flavor" alt="${cfg.flavor} ${cfg.jelly}">
      <div class="layer-2-containment-box">
        ${l2ImagesHTML}
      </div>
      <img src="${l3Src}" class="layer-3-cup" alt="Cup ${cfg.size}">
    </div>
  `;
}

function calculateCustomTotal() {
  customConfig.basePrice = customConfig.size === '12oz' ? 19.00 : 15.00;
  let addOnCost = 0;
  Object.keys(customConfig.addonsMap).forEach(ad => {
    const qty = customConfig.addonsMap[ad] || 0;
    addOnCost += (getToppingUnitPrice(ad) * qty);
  });
  const total = customConfig.basePrice + addOnCost;
  const totalEl = document.getElementById('customTotalPrice');
  if (totalEl) totalEl.innerText = '₱ ' + total.toFixed(2);
  return total;
}

function updateCanvasHeaders() {
  const title = document.getElementById('canvasTitle');
  const toppingsSubtitle = document.getElementById('canvasToppingsSubtitle');
  const addonsSubtitle = document.getElementById('canvasAddonsSubtitle');

  if (title) {
    title.innerText = `${customConfig.size} ${customConfig.flavor} Jelly ${customConfig.jelly === 'Cube' ? 'Cubes' : customConfig.jelly}`;
  }

  if (toppingsSubtitle) {
    if (customConfig.toppings.length > 0) {
      toppingsSubtitle.style.display = 'block';
      toppingsSubtitle.innerText = '+ ' + customConfig.toppings.join(' + ');
    } else {
      toppingsSubtitle.style.display = 'none';
    }
  }

  if (addonsSubtitle) {
    let addonTextArr = [];
    Object.keys(customConfig.addonsMap).forEach(ad => {
      const count = customConfig.addonsMap[ad];
      if (count > 0) addonTextArr.push(`Extra ${ad} (x${count})`);
    });
    if (customConfig.utensils && customConfig.utensils !== 'No Spoon') {
      addonTextArr.push(customConfig.utensils);
    }

    if (addonTextArr.length > 0) {
      addonsSubtitle.style.display = 'block';
      addonsSubtitle.innerText = '+ ' + addonTextArr.join(' + ');
    } else {
      addonsSubtitle.style.display = 'none';
    }
  }
}

function rotateActiveTopping(direction) {
  if (customConfig.toppings.length === 0) {
    addToppingSlot();
    return;
  }
  const currentSelected = customConfig.toppings[customConfig.activeToppingSlot] || AVAILABLE_TOPPINGS[0];
  let idx = AVAILABLE_TOPPINGS.indexOf(currentSelected);
  idx = (idx + direction + AVAILABLE_TOPPINGS.length) % AVAILABLE_TOPPINGS.length;
  customConfig.toppings[customConfig.activeToppingSlot] = AVAILABLE_TOPPINGS[idx];
}

window.nextCustomizerChoice = function() {
  const stage = STAGES[currentStageIndex];
  if (stage === 'cup') {
    customConfig.size = '8oz';
  } else if (stage === 'flavor') {
    const choices = STAGE_CHOICES.flavor;
    let idx = choices.findIndex(c => c.id === customConfig.flavor);
    customConfig.flavor = choices[(idx + 1) % choices.length].id;
  } else if (stage === 'jelly') {
    const choices = STAGE_CHOICES.jelly;
    let idx = choices.findIndex(c => c.id === customConfig.jelly);
    customConfig.jelly = choices[(idx + 1) % choices.length].id;
  } else if (stage === 'toppings') {
    rotateActiveTopping(1);
  }
  renderCustomizerUI();
};

window.prevCustomizerChoice = function() {
  const stage = STAGES[currentStageIndex];
  if (stage === 'cup') {
    customConfig.size = '12oz';
  } else if (stage === 'flavor') {
    const choices = STAGE_CHOICES.flavor;
    let idx = choices.findIndex(c => c.id === customConfig.flavor);
    customConfig.flavor = choices[(idx - 1 + choices.length) % choices.length].id;
  } else if (stage === 'jelly') {
    const choices = STAGE_CHOICES.jelly;
    let idx = choices.findIndex(c => c.id === customConfig.jelly);
    customConfig.jelly = choices[(idx - 1 + choices.length) % choices.length].id;
  } else if (stage === 'toppings') {
    rotateActiveTopping(-1);
  }
  renderCustomizerUI();
};

window.switchCustomStage = function(stageName) {
  currentStageIndex = STAGES.indexOf(stageName);
  if (currentStageIndex === -1) currentStageIndex = 0;
  renderCustomizerUI();
};

function renderCustomizerUI() {
  const currentStage = STAGES[currentStageIndex];
  const sidebar = document.getElementById('customizerSidebarContent');
  const stageContainer = document.getElementById('stageItemsContainer');

  // I-hide ang carousel navigation arrows kapag nasa "addons" stage
  const isAddons = currentStage === 'addons';
  document.querySelectorAll('.carousel-nav-btn').forEach(arrow => {
    arrow.style.display = isAddons ? 'none' : '';
  });
  const mobileArrowsRow = document.querySelector('.mobile-carousel-arrows-row');
  if (mobileArrowsRow) {
    mobileArrowsRow.style.display = isAddons ? 'none' : '';
  }

  document.querySelectorAll('.stage-pill').forEach((pill, idx) => {
    pill.classList.toggle('active', idx === currentStageIndex);
  });

  calculateCustomTotal();
  updateCanvasHeaders();

  const isLarge = customConfig.size === '12oz';
  const stackClass = isLarge ? 'tall-stack' : 'short-stack';

  if (sidebar) {
    if (currentStage === 'cup') {
      sidebar.innerHTML = `
        <h3 class="sidebar-title">Sizes</h3>
        <div class="size-options-list">
          <label class="custom-radio-label">
            <input type="radio" name="custom_cup" value="12oz" ${customConfig.size === '12oz' ? 'checked' : ''} onchange="selectCustomSize('12oz')">
            <span class="radio-mark"></span>
            <span class="radio-text">12oz</span>
          </label>
          <label class="custom-radio-label">
            <input type="radio" name="custom_cup" value="8oz" ${customConfig.size === '8oz' ? 'checked' : ''} onchange="selectCustomSize('8oz')">
            <span class="radio-mark"></span>
            <span class="radio-text">8oz</span>
          </label>
        </div>
      `;
    } else if (currentStage === 'flavor') {
      sidebar.innerHTML = `
        <h3 class="sidebar-title">Flavor</h3>
        <div class="size-options-list">
          ${STAGE_CHOICES.flavor.map(f => `
            <label class="custom-radio-label">
              <input type="radio" name="custom_flavor" value="${f.id}" ${customConfig.flavor === f.id ? 'checked' : ''} onchange="selectCustomFlavor('${f.id}')">
              <span class="radio-mark"></span>
              <span class="radio-text">${f.label}</span>
            </label>
          `).join('')}
        </div>
      `;
    } else if (currentStage === 'jelly') {
      sidebar.innerHTML = `
        <h3 class="sidebar-title">Jelly</h3>
        <div class="size-options-list">
          ${STAGE_CHOICES.jelly.map(j => `
            <label class="custom-radio-label">
              <input type="radio" name="custom_jelly" value="${j.id}" ${customConfig.jelly === j.id ? 'checked' : ''} onchange="selectCustomJelly('${j.id}')">
              <span class="radio-mark"></span>
              <span class="radio-text">${j.label}</span>
            </label>
          `).join('')}
        </div>
      `;
    } else if (currentStage === 'toppings') {
      let toppingSlotsHTML = '';
      customConfig.toppings.forEach((top, idx) => {
        toppingSlotsHTML += `
          <div class="topping-slot-card ${customConfig.activeToppingSlot === idx ? 'active-slot' : ''}" onclick="selectToppingSlot(${idx})">
            <div class="slot-info">
              <span class="slot-number">Topping #${idx + 1}</span>
              <span class="slot-value">${top}</span>
            </div>
            <button type="button" class="btn-remove-slot" onclick="removeToppingSlot(${idx}, event)">
              <i class="fa-solid fa-xmark"></i>
            </button>
          </div>
        `;
      });

      let addSlotButtonHTML = '';
      if (customConfig.toppings.length < 2) {
        addSlotButtonHTML = `
          <button type="button" class="btn-add-topping-slot" onclick="addToppingSlot()">
            <i class="fa-solid fa-plus"></i> Add Topping (${customConfig.toppings.length}/2)
          </button>
        `;
      }

      let toppingPickerHTML = '';
      if (customConfig.toppings.length > 0) {
        const currentActiveVal = customConfig.toppings[customConfig.activeToppingSlot];
        toppingPickerHTML = `
          <div class="toppings-selection-list">
            <span class="sidebar-instruction">Choose for Slot #${customConfig.activeToppingSlot + 1}:</span>
            ${AVAILABLE_TOPPINGS.map(t => {
              return `
                <label class="custom-radio-label">
                  <input type="radio" name="slot_topping" value="${t}" ${currentActiveVal === t ? 'checked' : ''} onchange="setToppingForActiveSlot('${t}')">
                  <span class="radio-mark"></span>
                  <span class="radio-text">${t}</span>
                </label>
              `;
            }).join('')}
          </div>
        `;
      }

      sidebar.innerHTML = `
        <h3 class="sidebar-title">Toppings</h3>
        <div class="toppings-slot-manager">
          ${toppingSlotsHTML}
          ${addSlotButtonHTML}
        </div>
        ${toppingPickerHTML}
      `;
    } else if (currentStage === 'addons') {
      const regularAddons = AVAILABLE_TOPPINGS.filter(a => a !== 'Choco Chips');
      sidebar.innerHTML = `
        <h3 class="sidebar-title">Add ons</h3>
        <span class="sidebar-price-tag">Extra Toppings</span>
        <div class="addons-qty-list">
          ${regularAddons.map(ad => {
            const count = customConfig.addonsMap[ad] || 0;
            return `
              <div class="addon-qty-row">
                <span class="addon-name">${ad} (+₱${getToppingUnitPrice(ad).toFixed(2)})</span>
                <div class="addon-qty-control">
                  <button type="button" class="btn-addon-qty" onclick="changeAddonQty('${ad}', -1)">-</button>
                  <span class="addon-qty-num">${count}</span>
                  <button type="button" class="btn-addon-qty" onclick="changeAddonQty('${ad}', 1)">+</button>
                </div>
              </div>
            `;
          }).join('')}
        </div>
        
        <span class="sidebar-price-tag" style="margin-top: 8px;">Premium Add-ons</span>
        <div class="addons-qty-list">
          <div class="addon-qty-row">
            <span class="addon-name">Choco Chips (+₱${getToppingUnitPrice('Choco Chips').toFixed(2)})</span>
            <div class="addon-qty-control">
              <button type="button" class="btn-addon-qty" onclick="changeAddonQty('Choco Chips', -1)">-</button>
              <span class="addon-qty-num">${customConfig.addonsMap['Choco Chips'] || 0}</span>
              <button type="button" class="btn-addon-qty" onclick="changeAddonQty('Choco Chips', 1)">+</button>
            </div>
          </div>
          <div class="addon-qty-row">
            <span class="addon-name">Condensed Milk (+₱${getToppingUnitPrice('Condensed Milk').toFixed(2)})</span>
            <div class="addon-qty-control">
              <button type="button" class="btn-addon-qty" onclick="changeAddonQty('Condensed Milk', -1)">-</button>
              <span class="addon-qty-num">${customConfig.addonsMap['Condensed Milk'] || 0}</span>
              <button type="button" class="btn-addon-qty" onclick="changeAddonQty('Condensed Milk', 1)">+</button>
            </div>
          </div>
        </div>

        <span class="sidebar-price-tag" style="margin-top: 8px;">Utensils:</span>
        <div class="size-options-list">
          <label class="custom-radio-label">
            <input type="radio" name="custom_utensil" value="No Spoon" ${customConfig.utensils === 'No Spoon' ? 'checked' : ''} onchange="selectUtensil('No Spoon')">
            <span class="radio-mark"></span>
            <span class="radio-text">No Spoon</span>
          </label>
          <label class="custom-radio-label">
            <input type="radio" name="custom_utensil" value="Spoon" ${customConfig.utensils === 'Spoon' ? 'checked' : ''} onchange="selectUtensil('Spoon')">
            <span class="radio-mark"></span>
            <span class="radio-text">Spoon</span>
          </label>
        </div>
      `;
    }
  }

  if (stageContainer) {
    if (currentStage === 'cup') {
      if (customConfig.size === '12oz') {
        stageContainer.innerHTML = `
          <div class="layered-cup-display-item empty-slot"></div>
          <div class="layered-cup-display-item active-cup-choice">
            <span class="cup-label-top">12oz</span>
            ${buildLayeredCupHTML({ size: '12oz' }, 'tall-stack')}
          </div>
          <div class="layered-cup-display-item" onclick="selectCustomSize('8oz')">
            <span class="cup-label-top">8oz</span>
            ${buildLayeredCupHTML({ size: '8oz' }, 'short-stack')}
          </div>
        `;
      } else {
        stageContainer.innerHTML = `
          <div class="layered-cup-display-item" onclick="selectCustomSize('12oz')">
            <span class="cup-label-top">12oz</span>
            ${buildLayeredCupHTML({ size: '12oz' }, 'tall-stack')}
          </div>
          <div class="layered-cup-display-item active-cup-choice">
            <span class="cup-label-top">8oz</span>
            ${buildLayeredCupHTML({ size: '8oz' }, 'short-stack')}
          </div>
          <div class="layered-cup-display-item empty-slot"></div>
        `;
      }
    } else if (currentStage === 'flavor') {
      const choices = STAGE_CHOICES.flavor;
      const idx = choices.findIndex(c => c.id === customConfig.flavor);
      const prev = choices[(idx - 1 + choices.length) % choices.length];
      const next = choices[(idx + 1) % choices.length];

      stageContainer.innerHTML = `
        <div class="layered-cup-display-item" onclick="selectCustomFlavor('${prev.id}')">
          <span class="cup-label-top">${prev.label}</span>
          ${buildLayeredCupHTML({ flavor: prev.id }, stackClass)}
        </div>
        <div class="layered-cup-display-item active-cup-choice">
          <span class="cup-label-top">${choices[idx].label}</span>
          ${buildLayeredCupHTML({ flavor: choices[idx].id }, stackClass)}
        </div>
        <div class="layered-cup-display-item" onclick="selectCustomFlavor('${next.id}')">
          <span class="cup-label-top">${next.label}</span>
          ${buildLayeredCupHTML({ flavor: next.id }, stackClass)}
        </div>
      `;
    } else if (currentStage === 'jelly') {
      const choices = STAGE_CHOICES.jelly;
      const idx = choices.findIndex(c => c.id === customConfig.jelly);
      const prev = choices[(idx - 1 + choices.length) % choices.length];
      const next = choices[(idx + 1) % choices.length];

      stageContainer.innerHTML = `
        <div class="layered-cup-display-item" onclick="selectCustomJelly('${prev.id}')">
          <span class="cup-label-top">${prev.label}</span>
          ${buildLayeredCupHTML({ jelly: prev.id }, stackClass)}
        </div>
        <div class="layered-cup-display-item active-cup-choice">
          <span class="cup-label-top">${choices[idx].label}</span>
          ${buildLayeredCupHTML({ jelly: choices[idx].id }, stackClass)}
        </div>
        <div class="layered-cup-display-item" onclick="selectCustomJelly('${next.id}')">
          <span class="cup-label-top">${next.label}</span>
          ${buildLayeredCupHTML({ jelly: next.id }, stackClass)}
        </div>
      `;
    } else if (currentStage === 'toppings') {
      const currentTop = customConfig.toppings[customConfig.activeToppingSlot] || AVAILABLE_TOPPINGS[0];
      const tIdx = AVAILABLE_TOPPINGS.indexOf(currentTop);
      const prevTop = AVAILABLE_TOPPINGS[(tIdx - 1 + AVAILABLE_TOPPINGS.length) % AVAILABLE_TOPPINGS.length];
      const nextTop = AVAILABLE_TOPPINGS[(tIdx + 1) % AVAILABLE_TOPPINGS.length];

      const prevScatter = getLayer2ToppingPath(prevTop, isLarge);
      const nextScatter = getLayer2ToppingPath(nextTop, isLarge);

      stageContainer.innerHTML = `
        <div class="layered-cup-display-item" onclick="setToppingForActiveSlot('${prevTop}')">
          <span class="cup-label-top">${prevTop}</span>
          <div class="toppings-scatter-preview">
            ${prevScatter ? `<img src="${prevScatter}" class="scatter-img" alt="${prevTop}">` : ''}
          </div>
        </div>
        <div class="layered-cup-display-item active-cup-choice">
          <span class="cup-label-top">${customConfig.toppings.length > 0 ? customConfig.toppings.join(' + ') : 'No Toppings'}</span>
          ${buildLayeredCupHTML({}, stackClass)}
        </div>
        <div class="layered-cup-display-item" onclick="setToppingForActiveSlot('${nextTop}')">
          <span class="cup-label-top">${nextTop}</span>
          <div class="toppings-scatter-preview">
            ${nextScatter ? `<img src="${nextScatter}" class="scatter-img" alt="${nextTop}">` : ''}
          </div>
        </div>
      `;
    } else if (currentStage === 'addons') {
      const regularAddons = AVAILABLE_TOPPINGS.filter(a => a !== 'Choco Chips');
      const activeAddonKeys = Object.keys(customConfig.addonsMap).filter(k => customConfig.addonsMap[k] > 0);

      const prevAddon = regularAddons[0] || 'Cheese';
      const nextAddon = regularAddons[1] || 'Tapioca';
      const prevScatter = getLayer2ToppingPath(prevAddon, isLarge);
      const nextScatter = getLayer2ToppingPath(nextAddon, isLarge);

      stageContainer.innerHTML = `
        <div class="layered-cup-display-item" onclick="changeAddonQty('${prevAddon}', 1)">
          <span class="cup-label-top">${prevAddon}</span>
          <div class="toppings-scatter-preview">
            ${prevScatter ? `<img src="${prevScatter}" class="scatter-img" alt="${prevAddon}">` : ''}
          </div>
        </div>
        <div class="layered-cup-display-item active-cup-choice">
          <span class="cup-label-top">${activeAddonKeys.length > 0 ? activeAddonKeys.join(' + ') : 'No Add-ons'}</span>
          ${buildLayeredCupHTML({}, stackClass)}
        </div>
        <div class="layered-cup-display-item" onclick="changeAddonQty('${nextAddon}', 1)">
          <span class="cup-label-top">${nextAddon}</span>
          <div class="toppings-scatter-preview">
            ${nextScatter ? `<img src="${nextScatter}" class="scatter-img" alt="${nextAddon}">` : ''}
          </div>
        </div>
      `;
    }
  }
}

window.selectCustomSize = function(size) {
  customConfig.size = size;
  renderCustomizerUI();
};

window.selectCustomFlavor = function(flavor) {
  customConfig.flavor = flavor;
  renderCustomizerUI();
};

window.selectCustomJelly = function(jelly) {
  customConfig.jelly = jelly;
  renderCustomizerUI();
};

window.addToppingSlot = function() {
  if (customConfig.toppings.length < 2) {
    const nextDefault = AVAILABLE_TOPPINGS.find(t => !customConfig.toppings.includes(t)) || AVAILABLE_TOPPINGS[0];
    customConfig.toppings.push(nextDefault);
    customConfig.activeToppingSlot = customConfig.toppings.length - 1;
    renderCustomizerUI();
  }
};

window.removeToppingSlot = function(slotIndex, event) {
  if (event) event.stopPropagation();
  customConfig.toppings.splice(slotIndex, 1);
  customConfig.activeToppingSlot = Math.max(0, customConfig.toppings.length - 1);
  renderCustomizerUI();
};

window.selectToppingSlot = function(slotIndex) {
  customConfig.activeToppingSlot = slotIndex;
  renderCustomizerUI();
};

window.setToppingForActiveSlot = function(toppingName) {
  if (customConfig.toppings.length === 0) {
    customConfig.toppings.push(toppingName);
    customConfig.activeToppingSlot = 0;
  } else {
    customConfig.toppings[customConfig.activeToppingSlot] = toppingName;
  }
  renderCustomizerUI();
};

window.changeAddonQty = function(addonName, delta) {
  const current = customConfig.addonsMap[addonName] || 0;
  const updated = Math.max(0, current + delta);
  if (updated === 0) {
    delete customConfig.addonsMap[addonName];
  } else {
    customConfig.addonsMap[addonName] = updated;
  }
  renderCustomizerUI();
};

window.selectUtensil = function(utensil) {
  customConfig.utensils = utensil;
  renderCustomizerUI();
};

// ==========================================
// CHECKOUT & CART FOR CUSTOM CUPS
// ==========================================
window.addCustomCupToCart = async function() {
  const isLarge = customConfig.size === '12oz';
  let accentColor = '#664638';
  if (customConfig.flavor === 'Strawberry') accentColor = '#f48a8e';
  if (customConfig.flavor === 'Pandan') accentColor = '#8bb35c';

  let addonStr = [];
  Object.keys(customConfig.addonsMap).forEach(a => {
    if (customConfig.addonsMap[a] > 0) addonStr.push(`Extra ${a} (x${customConfig.addonsMap[a]})`);
  });
  if (customConfig.utensils && customConfig.utensils !== 'No Spoon') {
    addonStr.push(customConfig.utensils);
  }

  const itemTitle = `${customConfig.flavor} Jelly ${customConfig.jelly === 'Cube' ? 'Cubes' : customConfig.jelly}`;
  const l1Src = getLayer1ImagePath(customConfig.flavor, customConfig.jelly, isLarge);
  const l3Src = getLayer3CupPath(isLarge);
  const firstTop = customConfig.toppings[0] || null;
  const l2Src = firstTop ? getLayer2ToppingPath(firstTop, isLarge) : '';

  const payload = {
    title: itemTitle,
    size: customConfig.size,
    flavor: customConfig.flavor,
    variation: customConfig.jelly,
    toppings: customConfig.toppings,
    addons: addonStr.join(', '),
    unit_price: calculateCustomTotal(),
    quantity: 1,
    accent_color: accentColor,
    image: l1Src,
    flavor_img: l1Src,
    toppings_img: l2Src,
    cup_img: l3Src
  };

  const idPayload = getActiveCartPayload();

  try {
    const res = await fetch('/api/cart', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'x-session-id': idPayload.session_id || ''
      },
      body: JSON.stringify({ 
        action: 'add', 
        item: payload,
        ...idPayload 
      })
    });
    if (!res.ok) throw new Error('Network error');
  } catch (err) {
    console.error('Custom cup cart add error:', err);
  }

  CartAlert.showModal({
    title: itemTitle,
    size: customConfig.size,
    flavor_img: l1Src,
    toppings_img: l2Src,
    cup_img: l3Src,
    accent_color: accentColor,
    onCheckout: () => { window.location.href = 'cart.html'; }
  });
  updateCartCount();
};

window.proceedCustomOrderSummary = function() {
  const isLarge = customConfig.size === '12oz';
  let addonStr = [];
  Object.keys(customConfig.addonsMap).forEach(a => {
    if (customConfig.addonsMap[a] > 0) addonStr.push(`Extra ${a} (x${customConfig.addonsMap[a]})`);
  });
  if (customConfig.utensils && customConfig.utensils !== 'No Spoon') {
    addonStr.push(customConfig.utensils);
  }

  const l1Src = getLayer1ImagePath(customConfig.flavor, customConfig.jelly, isLarge);
  const l3Src = getLayer3CupPath(isLarge);
  const firstTop = customConfig.toppings[0] || null;
  const l2Src = firstTop ? getLayer2ToppingPath(firstTop, isLarge) : '';

  let accentColor = '#664638';
  if (customConfig.flavor === 'Strawberry') accentColor = '#f48a8e';
  if (customConfig.flavor === 'Pandan') accentColor = '#8bb35c';

  const items = [{
    title: `${customConfig.flavor} Jelly ${customConfig.jelly === 'Cube' ? 'Cubes' : customConfig.jelly}`,
    size: customConfig.size,
    is_custom: true,
    image: l1Src,
    flavor_img: l1Src,
    toppings_img: l2Src,
    cup_img: l3Src,
    accent_color: accentColor,
    toppings: customConfig.toppings.length > 0 ? '+ ' + customConfig.toppings.join(' + ') : '',
    addons: addonStr.length > 0 ? '+ ' + addonStr.join(' + ') : '',
    unit_price: calculateCustomTotal(),
    quantity: 1
  }];

  if (typeof renderOrderSummaryModal === 'function') {
    renderOrderSummaryModal(items);
  }
};

// Save the in-progress custom build (flavor/jelly/size/toppings/add-ons) as a
// bookmarked, checkout-ready item so the customer can order it again later
// straight from the "Saved Builds" icon in the navbar - see navbar.js.
// Stored in the same item shape renderOrderSummaryModal/reorderCup use
// (title, size, unit_price, quantity, image, accent_color, toppings, addons)
// so any saved build can be handed straight to the checkout modal.
window.saveCurrentCustomBuild = function() {
  const isLarge = customConfig.size === '12oz';
  let addonStr = [];
  Object.keys(customConfig.addonsMap).forEach(a => {
    if (customConfig.addonsMap[a] > 0) addonStr.push(`Extra ${a} (x${customConfig.addonsMap[a]})`);
  });
  if (customConfig.utensils && customConfig.utensils !== 'No Spoon') {
    addonStr.push(customConfig.utensils);
  }

  const l1Src = getLayer1ImagePath(customConfig.flavor, customConfig.jelly, isLarge);
  const l3Src = getLayer3CupPath(isLarge);
  const firstTop = customConfig.toppings[0] || null;
  const l2Src = firstTop ? getLayer2ToppingPath(firstTop, isLarge) : '';

  let accentColor = '#664638';
  if (customConfig.flavor === 'Strawberry') accentColor = '#f48a8e';
  if (customConfig.flavor === 'Pandan') accentColor = '#8bb35c';

  const title = `${customConfig.flavor} Jelly ${customConfig.jelly === 'Cube' ? 'Cubes' : customConfig.jelly}`;

  const items = [{
    title,
    size: customConfig.size,
    is_custom: true,
    image: l1Src,
    flavor_img: l1Src,
    toppings_img: l2Src,
    cup_img: l3Src,
    accent_color: accentColor,
    toppings: customConfig.toppings.length > 0 ? '+ ' + customConfig.toppings.join(' + ') : '',
    addons: addonStr.length > 0 ? '+ ' + addonStr.join(' + ') : '',
    unit_price: calculateCustomTotal(),
    quantity: 1
  }];

  // Snapshot of the drink's layered image for the Saved Builds panel. Unlike
  // the cart item above (which only carries the FIRST topping), this keeps
  // every topping + add-on layer, exactly the way buildLayeredCupHTML()
  // stacks them in the builder. See resolveBuildPreview() in navbar.js.
  const toppingLayers = [];
  customConfig.toppings
    .concat(Object.keys(customConfig.addonsMap).filter(a => customConfig.addonsMap[a] > 0))
    .forEach(name => {
      const src = getLayer2ToppingPath(name, isLarge);
      if (src && !toppingLayers.includes(src)) toppingLayers.push(src);
    });

  const build = {
    id: 'build_' + Date.now(),
    label: title,
    saved_at: new Date().toISOString(),
    preview: {
      size: customConfig.size,
      flavor_img: l1Src,
      topping_imgs: toppingLayers,
      cup_img: l3Src,
      accent_color: accentColor
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
      title: 'Build saved!',
      showConfirmButton: false,
      timer: 1600
    });
  }
};

// If we were redirected here from the Saved Builds panel on a page that
// doesn't carry the checkout modal (see useSavedBuild in navbar.js), open it
// automatically with the build that was stashed just before the redirect.
(function autoOpenPendingSavedBuild() {
  if (new URLSearchParams(window.location.search).get('openBuild') !== '1') return;
  try {
    const pending = JSON.parse(sessionStorage.getItem('mm_pending_build_checkout') || 'null');
    sessionStorage.removeItem('mm_pending_build_checkout');
    if (pending && typeof window.renderOrderSummaryModal === 'function') {
      window.renderOrderSummaryModal(pending);
    }
  } catch (e) { /* no-op */ }
  const url = new URL(window.location.href);
  url.searchParams.delete('openBuild');
  window.history.replaceState({}, '', url.toString());
})();

// ==========================================
// ORDER RECENT & CARD HELPERS
// ==========================================
function resolveOrderCardAssets(cleanTitle, toppingsStr) {
  const cleanLower = (cleanTitle || '').toLowerCase();

  const found = PRESET_SIGNATURES.find(p => {
    const pTitle = p.title.replace(/\r?\n|\r/g, ' ').toLowerCase();
    return cleanLower.includes(pTitle);
  });

  if (found) {
    return {
      is_custom: false,
      image: found.image,
      accent_color: found.accent_color || '#F48A8E',
      title: found.title.replace('\n', ' ')
    };
  }

  let flavor = 'Pandan';
  let accent = '#8bb35c';
  let fallbackImage = 'images/Cheesy Pandan Cubes.png';
  if (cleanLower.includes('strawberry')) {
    flavor = 'Strawberry';
    accent = '#f48a8e';
    fallbackImage = 'images/Strawberry String Party.png';
  } else if (cleanLower.includes('coffee') || cleanLower.includes('chocolatey')) {
    flavor = 'Coffee';
    accent = '#664638';
    fallbackImage = 'images/Chocolatey Coffee Noodly Jelly.png';
  }

  let jelly = 'Cube';
  if (cleanLower.includes('spaghetti') || cleanLower.includes('string')) {
    jelly = 'Spaghetti';
  } else if (cleanLower.includes('whole')) {
    jelly = 'Whole';
  }

  const l1Path = `images/Layer 1/Small Flavors/${flavor} ${jelly}.png`;
  const l3Path = 'images/Layer 3/Small Cup.png';

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
      l2Path = `images/Layer 2/Small Toppings/${fileBase}.png`;
      break;
    }
  }

  return {
    is_custom: true,
    image: fallbackImage,
    flavor_img: l1Path,
    toppings_img: l2Path,
    cup_img: l3Path,
    accent_color: accent,
    title: cleanTitle
  };
}

// Prefer the real layer images saved on the order item itself
// (flavor_img/toppings_img/cup_img, persisted at checkout for custom
// builds). Only fall back to guessing them from the title/toppings
// text for preset drinks or older orders placed before that data
// was saved.
function getOrderDrinkMetadata(itemTitle, item) {
  const cleanTitle = itemTitle || 'Special Blend Cup';
  const hasResolvedLayers = item && (item.flavor_img || item.toppings_img || item.cup_img);

  if (hasResolvedLayers) {
    const cl = cleanTitle.toLowerCase();
    let accent = '#8bb35c';
    if (cl.includes('strawberry')) accent = '#f48a8e';
    else if (cl.includes('coffee') || cl.includes('chocolatey')) accent = '#664638';

    return {
      is_custom: !!(item.is_custom || item.custom_build || item.toppings_img),
      image: item.image || item.flavor_img,
      flavor_img: item.flavor_img || item.image,
      toppings_img: item.toppings_img || '',
      cup_img: item.cup_img || 'images/Layer 3/Small Cup.png',
      accent: item.accent_color || accent,
      accent_color: item.accent_color || accent,
      title: cleanTitle
    };
  }

  const resolved = resolveOrderCardAssets(cleanTitle, item && item.toppings);
  return { ...resolved, accent: resolved.accent_color, title: resolved.title || cleanTitle };
}

function formatOrderStatus(status) {
  if (!status) return 'Pending';
  const s = status.toUpperCase().trim();
  if (s === 'PAID_VERIFIED' || s === 'PREPARING') return 'Preparing';
  if (s === 'PENDING_PAYMENT' || s === 'PENDING') return 'Pending';
  if (s === 'READY_FOR_PICKUP') return 'Ready for Pick-Up';
  if (s === 'COMPLETED') return 'Completed';
  if (s === 'CONFIRMED') return 'Confirmed';
  if (s === 'CANCELLED') return 'Cancelled';
  return status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
}

function getOrderStatusClass(status) {
  if (!status) return 'pending';
  const s = status.toUpperCase().trim();
  if (s === 'PAID_VERIFIED' || s === 'PREPARING') return 'preparing';
  if (s === 'PENDING_PAYMENT' || s === 'PENDING') return 'pending';
  if (s === 'READY_FOR_PICKUP') return 'ready-for-pickup';
  if (s === 'COMPLETED') return 'completed';
  if (s === 'CONFIRMED') return 'confirmed';
  if (s === 'CANCELLED') return 'cancelled';
  return s.toLowerCase().replace(/_/g, '-');
}

window.copyOrderNumber = function(orderNum) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(orderNum);
  }
  if (typeof Swal !== 'undefined') {
    Swal.fire({
      toast: true,
      position: 'top-end',
      icon: 'success',
      title: 'Order ID copied!',
      showConfirmButton: false,
      timer: 1500
    });
  }
};

window.buyAgainOrder = function(rawTitleEncoded) {
  const title = decodeURIComponent(rawTitleEncoded).toLowerCase();
  const match = PRESET_SIGNATURES.find(p => p.title.replace('\n', ' ').toLowerCase() === title);
  if (match) {
    openProductModal(encodeURIComponent(JSON.stringify(match)));
  } else {
    window.location.href = '#drinks';
  }
};

window.rateOrderSips = function(orderNumber, rawTitleEncoded) {
  const title = decodeURIComponent(rawTitleEncoded);
  const match = PRESET_SIGNATURES.find(p => p.title.replace('\n', ' ').toLowerCase() === title.toLowerCase());
  if (match) {
    openProductModal(encodeURIComponent(JSON.stringify(match)));
    setTimeout(() => {
      const el = document.querySelector('.modal-ratings-section');
      if (el) el.scrollIntoView({ behavior: 'smooth' });
    }, 300);
  } else {
    window.location.href = 'orders.html';
  }
};

// ==========================================
// RECENT ORDERS & SEARCH
// ==========================================
async function loadRecentOrders() {
  const container = document.getElementById('homeOrdersContainer');
  if (!container) return;
  const user = JSON.parse(localStorage.getItem('mm_user') || 'null');

  if (!user || !user.customer_id) {
    container.innerHTML = `
      <div style="text-align: center; padding: 42px 20px; background: #FFFFFF; border-radius: 20px; border: 1.5px solid #FCE1DD; color: #777;">
        <i class="fa-solid fa-receipt" style="font-size: 2.6rem; color: #b8a69d; margin-bottom: 12px;"></i>
        <p style="font-size: 1.15rem; font-weight: 700; color: #4a3427; margin-bottom: 6px;">No recent orders found</p>
        <p style="font-size: 0.92rem; margin-bottom: 18px; color: #7C4F38;">You are currently browsing as a guest. Log in or use your order reference to track your sweet cups!</p>
        <div style="display: flex; justify-content: center; align-items: center; gap: 12px; flex-wrap: wrap;">
          <a href="orders.html" style="display: inline-flex; align-items: center; gap: 8px; padding: 9px 22px; background: #F48A8E; color: #ffffff; text-decoration: none; border-radius: 99px; font-weight: 700; font-size: 0.92rem; box-shadow: 0 4px 10px rgba(244, 138, 142, 0.25);">
            <i class="fa-solid fa-receipt"></i> Track Your Order
          </a>
          <a href="login.html" style="display: inline-flex; align-items: center; gap: 8px; padding: 9px 22px; background: #FFF4F1; color: #7C4F38; border: 1.5px solid #FCE1DD; text-decoration: none; border-radius: 99px; font-weight: 700; font-size: 0.92rem;">
            Log In to View
          </a>
        </div>
      </div>
    `;
    return;
  }

  try {
    const res = await fetch(`/api/orders/recent?customer_id=${user.customer_id}`);
    const data = await res.json();

    if (!data.orders || data.orders.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: 42px 20px; background: #FFFFFF; border-radius: 20px; border: 1.5px solid #FCE1DD;">
          <p style="font-weight: 700; color: #4a3427;">You haven't placed any drink orders yet.</p>
          <a href="#drinks" style="display: inline-block; margin-top: 10px; padding: 8px 20px; background: #F48A8E; color: #fff; border-radius: 99px; text-decoration: none; font-weight:700;">Order a Drink</a>
        </div>
      `;
      return;
    }

    const cardsHTML = data.orders.map(order => {
      let totalCups = order.total_cups;
      if (totalCups === undefined || totalCups === null) {
        if (Array.isArray(order.items) && order.items.length > 0) {
          totalCups = order.items.reduce((sum, it) => sum + (parseInt(it.quantity, 10) || 1), 0);
        } else {
          totalCups = 1;
        }
      }
      const totalCupsDisplay = `${totalCups} ${totalCups === 1 ? 'Cup' : 'Cups'}`;

      const rawTitle = order.title || (order.items && order.items[0] && order.items[0].item_label) || 'Special Blend Cup';
      const firstItem = (order.items && order.items[0]) || null;
      const meta = getOrderDrinkMetadata(rawTitle, firstItem);

      const rawStatus = order.status || 'PENDING_PAYMENT';
      const displayStatus = formatOrderStatus(rawStatus);
      const statusClass = getOrderStatusClass(rawStatus);

      let schedule = order.pickup_date || 'N/A';
      if (schedule === 'N/A' && order.placed_at) {
        schedule = new Date(order.placed_at).toISOString().split('T')[0];
      }

      const isCompleted = displayStatus.toLowerCase() === 'completed';
      let actionsHTML = '';
      if (isCompleted) {
        actionsHTML = `
          <button type="button" class="home-btn-action-primary" onclick="event.stopPropagation(); buyAgainOrder('${encodeURIComponent(rawTitle)}')">Buy Again</button>
          <button type="button" class="home-btn-action-secondary" onclick="event.stopPropagation(); rateOrderSips('${order.order_number}', '${encodeURIComponent(rawTitle)}')">Rate your Sips</button>
        `;
      }

      return `
        <article class="home-order-card" data-status="${statusClass}" onclick="window.location.href='orders.html'">
          <div class="home-order-card-inner">
            <div class="home-order-thumb-wrapper" style="--card-thumb-bg: ${meta.accent};">
              ${meta.is_custom ? `
                <div class="orders-composite-thumb">
                  <img src="${meta.flavor_img}" alt="Flavor Layer" class="cart-layer-flavor" loading="lazy" onerror="this.style.display='none'">
                  ${meta.toppings_img ? `<img src="${meta.toppings_img}" alt="Toppings Layer" class="cart-layer-toppings" loading="lazy" onerror="this.style.display='none'">` : ''}
                  <img src="${meta.cup_img}" alt="Cup Outline" class="cart-layer-cup" loading="lazy">
                </div>
              ` : `
                <img src="${meta.image}" class="home-order-thumb-img" alt="${meta.title}" loading="lazy">
              `}
            </div>
            <div class="home-order-details-col">
              <div class="home-order-header-row">
                <h2 class="home-order-title">${meta.title}</h2>
                <span class="home-order-status-badge status-${statusClass}">${displayStatus}</span>
              </div>
              <div class="home-order-meta-grid">
                <div class="home-order-meta-col">
                  <span class="home-meta-label">ORDER ID</span>
                  <span class="home-meta-value">
                    ${order.order_number}
                    <button type="button" class="btn-copy-ref" onclick="event.stopPropagation(); copyOrderNumber('${order.order_number}')" title="Copy Order ID">
                      <i class="fa-regular fa-copy"></i>
                    </button>
                  </span>
                </div>
                <div class="home-order-meta-col">
                  <span class="home-meta-label">TOTAL CUPS</span>
                  <span class="home-meta-value">${totalCupsDisplay}</span>
                </div>
                <div class="home-order-meta-col">
                  <span class="home-meta-label">PICK-UP SCHEDULE</span>
                  <span class="home-meta-value">${schedule}</span>
                </div>
              </div>
              <div class="home-order-card-footer">
                <div class="home-order-actions-group">
                  ${actionsHTML}
                </div>
                <div class="home-order-total-block">
                  <span class="home-total-label">Total:</span>
                  <span class="home-total-value">₱ ${parseFloat(order.total_amount).toFixed(2)}</span>
                </div>
              </div>
            </div>
          </div>
        </article>
      `;
    }).join('');

    container.innerHTML = `
      ${cardsHTML}
      <div class="view-all-container" style="text-align: center; margin-top: 18px;">
        <a href="orders.html" class="btn-view-all">View All Orders</a>
      </div>
    `;
  } catch (err) {
    console.error('Recent orders error:', err);
  }
}

window.filterDrinks = function(q) {
  const query = (q || '').toLowerCase().trim();
  document.querySelectorAll('.products-grid .product-card').forEach(card => {
    const text = card.getAttribute('data-search-keywords') || '';
    card.style.display = (!query || text.includes(query)) ? '' : 'none';
  });
};

function updateCartCount() {
  const countBadge = document.getElementById('navCartCount');
  if (!countBadge) return;

  // navbar.js (loaded before this script) already kicks off the exact same
  // /api/cart/count request on this same page and stores the promise here --
  // reuse it instead of firing a second identical request.
  if (window.mmCartCountPromise) {
    window.mmCartCountPromise.then(data => {
      if (!data) return;
      const count = parseInt(data.count, 10) || 0;
      countBadge.innerText = count;
      countBadge.style.display = count > 0 ? 'inline-block' : 'none';
    });
    return;
  }

  const idPayload = getActiveCartPayload();
  const queryParam = idPayload.customer_id
    ? `customer_id=${encodeURIComponent(idPayload.customer_id)}`
    : `session_id=${encodeURIComponent(idPayload.session_id)}`;

  fetch(`/api/cart/count?${queryParam}`)
    .then(res => res.json())
    .then(data => {
      const count = parseInt(data.count, 10) || 0;
      countBadge.innerText = count;
      countBadge.style.display = count > 0 ? 'inline-block' : 'none';
    })
    .catch(() => { 
      countBadge.innerText = '0';
      countBadge.style.display = 'none';
    });
}

// =========================================================================
// LOYALTY POINTS ENGINE
// =========================================================================
let userLoyaltyPoints = 0.0;

async function fetchCustomerLoyaltyPoints() {
  const localUser = JSON.parse(localStorage.getItem('mm_user') || '{}');
  const resolveId = localUser.customer_id || localUser.user_id || localUser.id;

  // I-render muna ang naka-save sa localStorage para hindi mag-flicker o maging 0 sa refresh
  if (localUser.loyalty_points !== undefined && localUser.loyalty_points !== null) {
    userLoyaltyPoints = parseFloat(localUser.loyalty_points) || 0.0;
    renderLoyaltyPoints(userLoyaltyPoints);
  }

  const applyProfileResult = (result) => {
    if (result && result.status === 'success') {
      const data = result.data || result.customer || {};
      userLoyaltyPoints = parseFloat(data.loyalty_points ?? userLoyaltyPoints ?? 0.0);
      renderLoyaltyPoints(userLoyaltyPoints);

      // Panatilihing updated ang localStorage
      localUser.loyalty_points = userLoyaltyPoints;
      if (data.id) localUser.customer_id = data.id;
      localStorage.setItem('mm_user', JSON.stringify(localUser));
    }
  };

  // navbar.js (loaded before this script) already fetches this same
  // customer's /api/customer/profile on this page -- reuse that response
  // instead of firing a second identical request.
  if (resolveId && window.mmProfilePromise) {
    try {
      applyProfileResult(await window.mmProfilePromise);
    } catch (err) {
      console.warn('Could not load customer loyalty points:', err);
    }
    return;
  }

  try {
    const res = await fetch(`/api/customer/profile${resolveId ? `?customer_id=${resolveId}` : ''}`, {
      credentials: 'include',
      headers: { 'Accept': 'application/json' }
    });
    
    if (res.ok) {
      const result = await res.json();
      applyProfileResult(result);
    }
  } catch (err) {
    console.warn('Could not load customer loyalty points:', err);
  }
}

function renderLoyaltyPoints(points) {
  const pts = parseFloat(points) || 0.0;
  const formattedPts = pts.toFixed(1);
  const pesoVal = (pts * 1.0).toFixed(2);

  const ptsEl = document.getElementById('displayLoyaltyPoints');
  const pesoEl = document.getElementById('displayLoyaltyPeso');
  if (ptsEl) ptsEl.innerText = `${formattedPts} pts`;
  if (pesoEl) pesoEl.innerText = `(₱${pesoVal})`;

  const summaryAvail = document.getElementById('summaryLoyaltyAvailable');
  if (summaryAvail) {
    summaryAvail.innerText = `Available: ${formattedPts} pts (₱${pesoVal})`;
  }
}

function checkWelcomeBackModal() {
  const userRaw = localStorage.getItem('mm_user');
  if (!userRaw) return;

  try {
    const user = JSON.parse(userRaw);
    const displayName = user.full_name || user.username || 'Sample User';

    const alreadyWelcomed = sessionStorage.getItem('mm_welcomed');
    const urlParams = new URLSearchParams(window.location.search);
    const isFromLogin = urlParams.get('login') === 'success' || sessionStorage.getItem('just_logged_in') === 'true';

    if (!alreadyWelcomed || isFromLogin) {
      sessionStorage.setItem('mm_welcomed', 'true');
      sessionStorage.removeItem('just_logged_in');

      if (urlParams.has('login')) {
        window.history.replaceState({}, document.title, window.location.pathname);
      }

      showSweetAlert({
        icon: 'success',
        title: 'Welcome!',
        html: `Yay, you're logged in as <strong>${displayName}</strong>!<br>Ready to pop the straw and build your sweet sips?`,
        showCancelButton: false,
        confirmButtonText: "Let's Sip!",
        focusConfirm: false,
        customClass: {
          container: 'mm-swal-container-top',
          popup: 'mm-swal-popup mm-welcome-popup',
          title: 'mm-swal-title',
          htmlContainer: 'mm-swal-html',
          actions: 'mm-swal-actions',
          confirmButton: 'mm-swal-confirm-btn',
          cancelButton: 'mm-cancel-hidden'
        },
        didOpen: () => {
          const cancelBtn = Swal.getCancelButton();
          if (cancelBtn) cancelBtn.remove();
        }
      }).then(() => {
        const drinksSection = document.getElementById('drinks');
        if (drinksSection) {
          drinksSection.scrollIntoView({ behavior: 'smooth' });
        }
      });
    }
  } catch (err) {
    console.error('Error showing welcome popup:', err);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  renderSignatureDrinks();
  loadLiveRatingsSummary();
  renderCustomizerUI();
  loadRecentOrders();
  updateCartCount();
  fetchCustomerLoyaltyPoints();
  checkWelcomeBackModal();
});