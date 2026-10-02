let loadedOrderId = null;
let currentOrderData = null;
let materialsInventoryList = [];
let liveDeductionMap = new Map();
let activeQualityAlerts = [];

// Standard Recipe BOM Portion Specs per Cup Size matching Backend Rules
const CLIENT_CUP_RECIPE_SPECS = {
    '8oz': {
        baseGulamanGrams: 100,
        condensedMilkOz: 0.7,
        extraCondensedMilkOz: 0.5,
        cupItemName: '8oz Cup',
        toppingsGrams: {
            'pearls': 30,
            'tapioca': 30,
            'tapioca pearls': 30,
            'cheese': 5,
            'chocolate chip': 5,
            'marshmallow': 2,
            'nuts': 3,
            'sprinkles (chocolate)': 2,
            'sprinkles (assorted)': 2,
            'sprinkles': 2
        }
    },
    '12oz': {
        baseGulamanGrams: 200,
        condensedMilkOz: 1.0,
        extraCondensedMilkOz: 0.5,
        cupItemName: '12oz Cup',
        toppingsGrams: {
            'pearls': 50,
            'tapioca': 50,
            'tapioca pearls': 50,
            'cheese': 7,
            'chocolate chip': 7,
            'marshmallow': 2,
            'nuts': 3,
            'sprinkles (chocolate)': 2,
            'sprinkles (assorted)': 2,
            'sprinkles': 2
        }
    }
};

document.addEventListener('DOMContentLoaded', () => {
    // 1. Get order_id from URL parameter
    const urlParams = new URLSearchParams(window.location.search);
    const orderId = urlParams.get('order_id') || urlParams.get('id') || '';

    // 2. Initial data load
    fetchOrderProductionDetails(orderId);

    // 3. Form submission listener
    const completeForm = document.getElementById('completeOrderForm');
    if (completeForm) {
        completeForm.addEventListener('submit', (e) => {
            e.preventDefault();
            handleCompleteOrder(loadedOrderId || orderId);
        });
    }

    // 4. Checklist step listeners
    setupWorkflowChecklist();
});

// Fetch order details, inventory materials, and quality alerts
async function fetchOrderProductionDetails(orderId) {
    try {
        let response;
        if (typeof employeeFetch === 'function') {
            response = await employeeFetch(`/api/production-supervisor/order-production?order_id=${encodeURIComponent(orderId)}`);
        } else {
            const userId = localStorage.getItem('userId') || sessionStorage.getItem('userId');
            const headers = userId ? { 'x-user-id': userId } : {};
            response = await fetch(`/api/production-supervisor/order-production?order_id=${encodeURIComponent(orderId)}`, { headers });
        }

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.message || 'Server error ' + response.status);
        }

        const data = await response.json();

        // Populate user header
        if (data.user) {
            const userFullNameEl = document.getElementById('userFullName') || document.getElementById('userName');
            const userAvatarEl = document.getElementById('userAvatar');
            if (userFullNameEl) userFullNameEl.textContent = data.user.fullName || 'Production Supervisor';
            if (userAvatarEl && data.user.avatarSrc) userAvatarEl.src = data.user.avatarSrc;
        }

        currentOrderData = data.order || null;
        loadedOrderId = data.order ? data.order.id : null;
        materialsInventoryList = data.materials || [];
        activeQualityAlerts = data.qualityAlerts || [];

        // Build Initial Recipe BOM Deductions Map
        computeInitialRecipeBOM(currentOrderData, materialsInventoryList);

        // Render UI Sections
        renderOrderDetails(currentOrderData);
        renderMaterialInventoryCheck();
        renderQualityAlerts(activeQualityAlerts);

    } catch (error) {
        console.error('Could not load production order details:', error);
        showCustomSwal('Error Loading Order', error.message || 'Failed to retrieve order assembly specs.', 'warning');
    }
}

// Option B: Render Quality & Portion Calibration Alert Strip
function renderQualityAlerts(alerts) {
    const bannerEl = document.getElementById('qualityAlertBanner');
    if (!bannerEl) return;

    if (!alerts || alerts.length === 0) {
        bannerEl.style.display = 'none';
        return;
    }

    bannerEl.style.display = 'flex';
    bannerEl.innerHTML = `
        <div class="alert-strip-head">
            <svg viewBox="0 0 24 24" class="alert-strip-icon" fill="none" stroke="currentColor" stroke-width="2.5">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                <line x1="12" y1="9" x2="12" y2="13"></line>
                <line x1="12" y1="17" x2="12.01" y2="17"></line>
            </svg>
            <span>Kitchen Quality &amp; Portion Calibration Heads-Up</span>
        </div>
        <ul class="alert-strip-list">
            ${alerts.map(a => `<li>${escapeHtml(a)}</li>`).join('')}
        </ul>
    `;
}

// Helper: Sinusuri ang toppings list para sa multiplier (e.g., "2x nuts", "nuts x2", "2 nuts")
function parseToppingMultiplier(toppings, keywords) {
    if (!toppings) return 0;
    
    let rawList = [];
    if (Array.isArray(toppings)) {
        rawList = toppings;
    } else if (typeof toppings === 'string') {
        try {
            const parsed = JSON.parse(toppings);
            rawList = Array.isArray(parsed) ? parsed : toppings.split(',');
        } catch (e) {
            rawList = toppings.split(',');
        }
    } else {
        rawList = [toppings];
    }

    let totalMultiplier = 0;

    rawList.forEach(item => {
        let name = '';
        let count = 1;

        if (typeof item === 'string') {
            const trimmed = item.trim();
            // Match "2x Nuts", "2 x Nuts", "Nuts 2x", "Nuts (2x)", "Nuts x2"
            const matchX = trimmed.match(/^(\d+)\s*x\s*(.*)$/i) || 
                           trimmed.match(/^(.*?)\s*\(?(\d+)\s*x\)?$/i) || 
                           trimmed.match(/^(.*?)\s*x\s*(\d+)$/i);

            if (matchX) {
                if (/^\d+$/.test(matchX[1])) {
                    count = parseInt(matchX[1], 10) || 1;
                    name = matchX[2].trim().toLowerCase();
                } else {
                    name = matchX[1].trim().toLowerCase();
                    count = parseInt(matchX[2], 10) || 1;
                }
            } else {
                // Match "2 Nuts"
                const matchNum = trimmed.match(/^(\d+)\s+(.+)$/);
                if (matchNum) {
                    count = parseInt(matchNum[1], 10) || 1;
                    name = matchNum[2].trim().toLowerCase();
                } else {
                    name = trimmed.toLowerCase();
                    count = 1;
                }
            }
        } else if (typeof item === 'object' && item !== null) {
            name = String(item.name || item.topping || item.title || '').trim().toLowerCase();
            count = parseInt(item.quantity || item.qty || item.count || 1, 10) || 1;
        }

        const isMatched = keywords.some(kw => name.includes(kw.toLowerCase()));
        if (isMatched) {
            totalMultiplier += count;
        }
    });

    return totalMultiplier;
}

// Compute standard BOM deduction based on order parameters
function computeInitialRecipeBOM(order, materials) {
    liveDeductionMap.clear();
    if (!order) return;

    const sizeStr = (String(order.cupSize || '') + ' ' + String(order.itemLabel || '')).toLowerCase();
    const is8oz = sizeStr.includes('8oz') || sizeStr.includes('small') || sizeStr.includes('8 oz');
    const sizeKey = is8oz ? '8oz' : '12oz';
    const spec = CLIENT_CUP_RECIPE_SPECS[sizeKey];
    const qty = parseInt(order.quantity, 10) || 1;

    // Check if extra condensed milk is requested
    const toppingsRaw = order.toppings || [];
    const toppingsStr = (Array.isArray(toppingsRaw) ? toppingsRaw.join(' ') : String(toppingsRaw)).toLowerCase();
    const hasExtraCondensed = toppingsStr.includes('extra condensed') || toppingsStr.includes('more condensed');
    const totalMilk = (spec.condensedMilkOz + (hasExtraCondensed ? spec.extraCondensedMilkOz : 0)) * qty;

    // 1. Baseline recipe deductions (Walang powdered milk)
    addDeductionLine('Cooked Gulaman Base', spec.baseGulamanGrams * qty, 'grams', 10);
    addDeductionLine('Condensed Milk', parseFloat(totalMilk.toFixed(2)), 'oz', 0.1);
    addDeductionLine(spec.cupItemName, 1 * qty, 'pcs', 1);
    addDeductionLine('Cup Lids', 1 * qty, 'pcs', 1);
    addDeductionLine('Boba Straws', 1 * qty, 'pcs', 1);

    // 2. Conditional Toppings na may Multiplier Checking
    const isPreset = order.orderType === 'Walk-in Preset';

    // Tapioca Pearls
    let pearlCount = parseToppingMultiplier(toppingsRaw, ['pearl', 'tapioca']);
    if (isPreset && pearlCount === 0) pearlCount = 1;
    if (pearlCount > 0) {
        addDeductionLine('Tapioca Pearls', spec.toppingsGrams['tapioca pearls'] * pearlCount * qty, 'grams', 5);
    }

    // Cheese
    const cheeseCount = parseToppingMultiplier(toppingsRaw, ['cheese']);
    if (cheeseCount > 0) {
        addDeductionLine('Cheese', spec.toppingsGrams['cheese'] * cheeseCount * qty, 'grams', 1);
    }

    // Chocolate Chip
    const chocoChipCount = parseToppingMultiplier(toppingsRaw, ['chocolate chip', 'choco chip', 'chocolate chips']);
    if (chocoChipCount > 0) {
        addDeductionLine('Chocolate Chip', spec.toppingsGrams['chocolate chip'] * chocoChipCount * qty, 'grams', 1);
    }

    // Marshmallow
    const marshmallowCount = parseToppingMultiplier(toppingsRaw, ['marshmallow', 'marshmallows']);
    if (marshmallowCount > 0) {
        addDeductionLine('Marshmallow', spec.toppingsGrams['marshmallow'] * marshmallowCount * qty, 'grams', 1);
    }

    // Nuts
    const nutsCount = parseToppingMultiplier(toppingsRaw, ['nut', 'nuts']);
    if (nutsCount > 0) {
        addDeductionLine('Nuts', spec.toppingsGrams['nuts'] * nutsCount * qty, 'grams', 1);
    }

    // Sprinkles (Chocolate vs Assorted vs Generic)
    const chocoSprinklesCount = parseToppingMultiplier(toppingsRaw, ['sprinkles (chocolate)', 'chocolate sprinkle', 'choco sprinkle']);
    const assortedSprinklesCount = parseToppingMultiplier(toppingsRaw, ['sprinkles (assorted)', 'assorted sprinkle']);
    
    if (chocoSprinklesCount > 0) {
        addDeductionLine('Sprinkles (Chocolate)', spec.toppingsGrams['sprinkles (chocolate)'] * chocoSprinklesCount * qty, 'grams', 1);
    } else if (assortedSprinklesCount > 0) {
        addDeductionLine('Sprinkles (Assorted)', spec.toppingsGrams['sprinkles (assorted)'] * assortedSprinklesCount * qty, 'grams', 1);
    } else {
        const genericSprinklesCount = parseToppingMultiplier(toppingsRaw, ['sprinkles', 'sprinkle']);
        if (genericSprinklesCount > 0) {
            addDeductionLine('Sprinkles', spec.toppingsGrams['sprinkles'] * genericSprinklesCount * qty, 'grams', 1);
        }
    }
}

function addDeductionLine(name, standardQty, unit, step) {
    liveDeductionMap.set(name, {
        standardQty: standardQty,
        deductQty: standardQty,
        unit: unit,
        step: step
    });
}

// Render order specifications card
function renderOrderDetails(order) {
    if (!order) return;

    setText('orderCode', order.orderCode);
    setText('orderClient', order.orderClient ? `Customer: ${order.orderClient}` : 'Walk-in Counter Customer');
    setText('itemLabel', order.itemLabel);

    const typeBadge = document.getElementById('orderTypeBadge');
    if (typeBadge) {
        typeBadge.textContent = order.orderType || 'Pre-Order';
        typeBadge.className = 'type-pill ' + (order.orderType === 'Pre-Order' ? 'type-preorder' : 'type-preset');
    }

    // Dynamic specification tags using pure SVGs
    const tagRow = document.getElementById('tagRow');
    if (tagRow) {
        let tagsHtml = '';
        if (order.cupSize) {
            tagsHtml += `
                <span class="spec-tag">
                    <svg class="tag-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M18 8h1a4 4 0 0 1 0 8h-1M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"></path>
                    </svg>
                    <span>${escapeHtml(order.cupSize)}</span>
                </span>
            `;
        }
        const toppingsList = Array.isArray(order.toppings) ? order.toppings : (order.toppings ? String(order.toppings).split(',') : []);
        toppingsList.forEach(top => {
            const topStr = String(top).trim();
            if (!topStr) return;
            tagsHtml += `
                <span class="spec-tag">
                    <svg class="tag-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="5"></circle>
                    </svg>
                    <span>${escapeHtml(topStr)}</span>
                </span>
            `;
        });
        if (order.claimSlot) {
            tagsHtml += `
                <span class="spec-tag highlight">
                    <svg class="tag-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="10"></circle>
                        <polyline points="12 6 12 12 16 14"></polyline>
                    </svg>
                    <span>${escapeHtml(order.claimSlot)}</span>
                </span>
            `;
        }
        tagRow.innerHTML = tagsHtml || '<span class="spec-tag">Standard Recipe Portion</span>';
    }

    const notesEl = document.getElementById('recipeInstructions');
    if (notesEl) {
        notesEl.textContent = 'Prepare strictly according to calibrated BOM allocations. Verify gelatin firmness and sweetness levels before sealing lid and straw.';
    }

    const shelfEl = document.getElementById('shelfIndicatorTag');
    if (shelfEl) {
        shelfEl.textContent = order.claimSlot ? `Holding Slot: ${order.claimSlot}` : 'Counter Chiller Holding Shelf';
    }
}

// Smart Inventory Matching Helper
function findMatchingInventoryItem(name) {
    if (!materialsInventoryList || materialsInventoryList.length === 0) return null;

    const clean = str => String(str || '').toLowerCase().replace(/[^a-z0-9]/g, ' ');
    const targetWords = clean(name).split(/\s+/).filter(Boolean);

    let match = materialsInventoryList.find(m => {
        const invName = String(m.name || '').toLowerCase();
        const targetName = String(name || '').toLowerCase();
        return invName === targetName || invName.includes(targetName) || targetName.includes(invName);
    });
    if (match) return match;

    match = materialsInventoryList.find(m => {
        const invWords = clean(m.name || '').split(/\s+/).filter(Boolean);
        return targetWords.every(w => invWords.includes(w)) || invWords.every(w => targetWords.includes(w));
    });

    return match || null;
}

// Render material inventory check table with interactive portion steppers
function renderMaterialInventoryCheck() {
    const container = document.getElementById('materialsList');
    if (!container) return;

    if (liveDeductionMap.size === 0) {
        container.innerHTML = '<div class="loading-materials">No materials record attached to this item.</div>';
        return;
    }

    const entries = Array.from(liveDeductionMap.entries());
    container.innerHTML = entries.map(([name, item], idx) => {
        const invItem = findMatchingInventoryItem(name);

        const onHandQty = invItem ? parseFloat(invItem.amount || invItem.quantity || 0) : null;
        let stockTagHtml = '<span class="stock-tag ok">Stock In Chiller</span>';

        if (onHandQty !== null) {
            if (onHandQty < item.deductQty) {
                stockTagHtml = `<span class="stock-tag low">Low: ${onHandQty} left</span>`;
            } else {
                stockTagHtml = `<span class="stock-tag ok">${onHandQty} ${item.unit}</span>`;
            }
        }

        const isLast = idx === entries.length - 1;
        const displayVal = item.unit === 'oz' ? Number(item.deductQty).toFixed(1) : Math.round(item.deductQty);

        return `
            <div class="materials-row ${isLast ? 'last-row' : ''}">
                <span class="col-name">${escapeHtml(name)}</span>
                <span class="col-bom">${item.standardQty} ${item.unit}</span>
                <div class="col-amount">
                    <button type="button" class="stepper-btn" onclick="stepDeduction('${escapeHtml(name)}', -1)">−</button>
                    <span class="stepper-val" id="val_${escapeHtml(name.replace(/[^a-zA-Z0-9]/g, ''))}">${displayVal}</span>
                    <button type="button" class="stepper-btn" onclick="stepDeduction('${escapeHtml(name)}', 1)">+</button>
                </div>
                <div class="col-stock">${stockTagHtml}</div>
                <span class="col-unit">${escapeHtml(item.unit)}</span>
            </div>
        `;
    }).join('');
}

// Interactive Stepper Handler for Manual Kitchen Portion Tuning
window.stepDeduction = function(name, dir) {
    const item = liveDeductionMap.get(name);
    if (!item) return;

    const step = item.step || 1;
    const newQty = Math.max(0, item.deductQty + (dir * step));
    item.deductQty = Math.round(newQty * 10) / 10;
    liveDeductionMap.set(name, item);

    const targetElId = 'val_' + name.replace(/[^a-zA-Z0-9]/g, '');
    const valEl = document.getElementById(targetElId);
    if (valEl) {
        valEl.textContent = item.unit === 'oz' ? Number(item.deductQty).toFixed(1) : Math.round(item.deductQty);
    }
};

// Assembly workflow checklist validation and audio/visual tactile feedback
function setupWorkflowChecklist() {
    const checks = document.querySelectorAll('.checklist-grid input[type="checkbox"]');
    checks.forEach(chk => {
        chk.addEventListener('change', () => {
            const parentLabel = chk.closest('.check-item');
            if (parentLabel) {
                if (chk.checked) {
                    parentLabel.style.opacity = '0.5';
                    parentLabel.style.textDecoration = 'line-through';
                } else {
                    parentLabel.style.opacity = '1';
                    parentLabel.style.textDecoration = 'none';
                }
            }
        });
    });
}

// Complete order with themed SweetAlert2 confirmation & validation
async function handleCompleteOrder(orderId) {
    if (!orderId) {
        showCustomSwal('Order Not Found', 'No active order selected for completion.', 'warning');
        return;
    }

    const checks = document.querySelectorAll('.checklist-grid input[type="checkbox"]');
    const allChecked = Array.from(checks).every(c => c.checked);

    let confirmPrompt = `Confirm that Order #${orderId} assembly is finished. Ingredients and packaging will be deducted automatically from inventory.`;
    if (!allChecked) {
        confirmPrompt = `Notice: Some checklist workflow items are unchecked.\n\nConfirm that Order #${orderId} assembly is complete and ready for pickup shelf transfer?`;
    }

    const confirmed = await showCustomConfirm(
        'Seal & Mark Shelf-Ready?',
        confirmPrompt,
        'Complete & Mark Ready',
        'Cancel'
    );
    if (!confirmed) return;

    const submitBtn = document.getElementById('completeOrderBtn');
    if (submitBtn) submitBtn.disabled = true;

    try {
        let response;
        const payload = {
            order_id: orderId,
            stage: 'READY',
            manual_deductions: Object.fromEntries(
                Array.from(liveDeductionMap.entries()).map(([k, v]) => [k, v.deductQty])
            )
        };

        if (typeof employeeFetch === 'function') {
            response = await employeeFetch('/api/production-supervisor/complete-order', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        } else {
            const userId = localStorage.getItem('userId') || sessionStorage.getItem('userId');
            const headers = { 'Content-Type': 'application/json' };
            if (userId) headers['x-user-id'] = userId;
            response = await fetch('/api/production-supervisor/complete-order', {
                method: 'POST',
                headers,
                body: JSON.stringify(payload)
            });
        }

        const result = await response.json();
        if (!response.ok || result.status === 'error') {
            throw new Error(result.message || 'Server rejected order completion.');
        }

        await showCustomSwal('Order Ready', `Order #${orderId} has been marked Ready for Pickup and materials deducted.`, 'success');
        window.location.href = 'orderList.html';

    } catch (err) {
        console.error('Complete order failed:', err);
        showCustomSwal('Completion Failed', err.message || 'Could not mark order ready.', 'warning');
    } finally {
        if (submitBtn) submitBtn.disabled = false;
    }
}

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value || '';
}

// Custom SweetAlert2 alert
function showCustomSwal(title, text, icon = 'info') {
    if (typeof Swal !== 'undefined') {
        return Swal.fire({
            title: title,
            text: text,
            icon: icon,
            customClass: {
                popup: 'mm-swal-popup',
                title: 'mm-swal-title',
                confirmButton: 'mm-swal-confirm'
            },
            buttonsStyling: false
        });
    }
    alert(title + '\n' + text);
    return Promise.resolve();
}

// Custom SweetAlert2 confirm
async function showCustomConfirm(title, text, confirmBtnText = 'Confirm', cancelBtnText = 'Cancel') {
    if (typeof Swal !== 'undefined') {
        const res = await Swal.fire({
            title: title,
            text: text,
            icon: 'question',
            showCancelButton: true,
            confirmButtonText: confirmBtnText,
            cancelButtonText: cancelBtnText,
            customClass: {
                popup: 'mm-swal-popup',
                title: 'mm-swal-title',
                confirmButton: 'mm-swal-confirm',
                cancelButton: 'mm-swal-cancel'
            },
            buttonsStyling: false
        });
        return res.isConfirmed;
    }
    return confirm(title + '\n' + text);
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}