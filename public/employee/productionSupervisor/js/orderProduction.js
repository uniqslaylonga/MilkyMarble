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
        powderedMilkGrams: 2,
        cupItemName: '8oz Cup',
        toppingsGrams: {
            'pearls': 30,
            'tapioca': 30,
            'tapioca pearls': 30,
            'cheese': 5,
            'chocolate chip': 5,
            'marshmallow': 2,
            'nuts': 5,
            'sprinkles (chocolate)': 2,
            'sprinkles (assorted)': 2,
            'sprinkles': 2
        }
    },
    '12oz': {
        baseGulamanGrams: 200,
        condensedMilkOz: 1.5,
        extraCondensedMilkOz: 1.0,
        powderedMilkGrams: 3,
        cupItemName: '12oz Cup',
        toppingsGrams: {
            'pearls': 50,
            'tapioca': 50,
            'tapioca pearls': 50,
            'cheese': 7,
            'chocolate chip': 7,
            'marshmallow': 2,
            'nuts': 7,
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

// Compute standard BOM deduction based on order parameters
function computeInitialRecipeBOM(order, materials) {
    liveDeductionMap.clear();
    if (!order) return;

    const is8oz = String(order.cupSize || '').toLowerCase().includes('8oz') || String(order.itemLabel || '').toLowerCase().includes('8oz');
    const sizeKey = is8oz ? '8oz' : '12oz';
    const spec = CLIENT_CUP_RECIPE_SPECS[sizeKey];
    const qty = parseInt(order.quantity, 10) || 1;

    // Check if extra condensed milk is requested
    const toppingsStr = (order.toppings || []).join(' ').toLowerCase();
    const hasExtraCondensed = toppingsStr.includes('condensed');
    const totalMilk = (spec.condensedMilkOz + (hasExtraCondensed ? spec.extraCondensedMilkOz : 0)) * qty;

    // Baseline recipe deductions
    addDeductionLine('Cooked Gulaman Base', spec.baseGulamanGrams * qty, 'grams', 10);
    addDeductionLine('Condensed Milk', totalMilk, 'oz', 0.5);
    addDeductionLine('Powdered Milk', spec.powderedMilkGrams * qty, 'grams', 1);
    addDeductionLine(spec.cupItemName, 1 * qty, 'pcs', 1);
    addDeductionLine('Cup Lids', 1 * qty, 'pcs', 1);
    addDeductionLine('Boba Straws', 1 * qty, 'pcs', 1);

    const isPreset = order.orderType === 'Walk-in Preset';
    if (isPreset || toppingsStr.includes('pearl') || toppingsStr.includes('tapioca')) {
        addDeductionLine('Cooked Tapioca Pearls', spec.toppingsGrams['pearls'] * qty, 'grams', 5);
    }
    if (toppingsStr.includes('cheese')) {
        addDeductionLine('Cheese', spec.toppingsGrams['cheese'] * qty, 'grams', 2);
    }
    if (toppingsStr.includes('chocolate chip')) {
        addDeductionLine('Chocolate Chip', spec.toppingsGrams['chocolate chip'] * qty, 'grams', 2);
    }
    if (toppingsStr.includes('marshmallow')) {
        addDeductionLine('Marshmallow', spec.toppingsGrams['marshmallow'] * qty, 'grams', 1);
    }
    if (toppingsStr.includes('nuts')) {
        addDeductionLine('Nuts', spec.toppingsGrams['nuts'] * qty, 'grams', 2);
    }
    if (toppingsStr.includes('sprinkles (chocolate)')) {
        addDeductionLine('Sprinkles (Chocolate)', spec.toppingsGrams['sprinkles (chocolate)'] * qty, 'grams', 1);
    } else if (toppingsStr.includes('sprinkles (assorted)')) {
        addDeductionLine('Sprinkles (Assorted)', spec.toppingsGrams['sprinkles (assorted)'] * qty, 'grams', 1);
    } else if (toppingsStr.includes('sprinkles')) {
        addDeductionLine('Sprinkles', spec.toppingsGrams['sprinkles'] * qty, 'grams', 1);
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
        (order.toppings || []).forEach(top => {
            tagsHtml += `
                <span class="spec-tag">
                    <svg class="tag-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="5"></circle>
                    </svg>
                    <span>${escapeHtml(top)}</span>
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
        // Find corresponding on-hand inventory item
        const invItem = materialsInventoryList.find(m => 
            String(m.name || '').toLowerCase().includes(name.toLowerCase()) ||
            name.toLowerCase().includes(String(m.name || '').toLowerCase())
        );

        const onHandQty = invItem ? parseFloat(invItem.amount || 0) : null;
        let stockTagHtml = '<span class="stock-tag ok">Stock In Chiller</span>';

        if (onHandQty !== null) {
            if (onHandQty < item.deductQty) {
                stockTagHtml = `<span class="stock-tag low">Low: ${onHandQty} left</span>`;
            } else {
                stockTagHtml = `<span class="stock-tag ok">${onHandQty} ${item.unit}</span>`;
            }
        }

        const isLast = idx === entries.length - 1;

        return `
            <div class="materials-row ${isLast ? 'last-row' : ''}">
                <span class="col-name">${escapeHtml(name)}</span>
                <span class="col-bom">${item.standardQty} ${item.unit}</span>
                <div class="col-amount">
                    <button type="button" class="stepper-btn" onclick="stepDeduction('${escapeHtml(name)}', -1)">−</button>
                    <span class="stepper-val" id="val_${escapeHtml(name.replace(/[^a-zA-Z0-9]/g, ''))}">${Number(item.deductQty).toFixed(item.unit === 'oz' ? 1 : 0)}</span>
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
        valEl.textContent = Number(item.deductQty).toFixed(item.unit === 'oz' ? 1 : 0);
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

    // Check if workflow steps are checked
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