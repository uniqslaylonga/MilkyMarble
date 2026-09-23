document.addEventListener('DOMContentLoaded', () => {
    // 1. Kunin ang order_id mula sa URL parameter (e.g. orderProduction.html?order_id=101)
    // No fake fallback ID here - if none is given, the server itself falls
    // back to the most recent active order.
    const urlParams = new URLSearchParams(window.location.search);
    const orderId = urlParams.get('order_id') || urlParams.get('id') || '';

    // 2. I-load ang mga detalye ng order at ingredient deduction check
    fetchOrderProductionDetails(orderId);

    // 3. Search Bar listener sa topbar kung mayroon
    const searchInput = document.querySelector('.search-box input');
    if (searchInput) {
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const target = searchInput.value.trim();
                if (target) {
                    window.location.href = `orderProduction.html?order_id=${encodeURIComponent(target)}`;
                }
            }
        });
    }

    // 4. Complete button listener - uses the actual loaded order's ID, not
    // just whatever (possibly empty) value was in the URL.
    const completeBtn = document.getElementById('completeOrderBtn') || document.querySelector('.complete-btn') || document.querySelector('button.btn-primary');
    if (completeBtn) {
        completeBtn.addEventListener('click', () => handleCompleteOrder(loadedOrderId || orderId));
    }
});

let loadedOrderId = null;

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

        if (!response.ok) throw new Error(await EmployeeUI.errorMessage(response));

        const data = await response.json();

        // I-populate ang User Header
        if (data.user) {
            const userFullNameEl = document.getElementById('userFullName') || document.getElementById('userName');
            const userAvatarEl = document.getElementById('userAvatar');
            if (userFullNameEl) userFullNameEl.textContent = data.user.fullName || 'Production Supervisor';
            if (userAvatarEl && data.user.avatarSrc) userAvatarEl.src = data.user.avatarSrc;
        }

        loadedOrderId = data.order ? data.order.id : null;
        renderOrderDetails(data.order);
        renderMaterialInventoryCheck(data.materials);

    } catch (error) {
        console.error('Could not load live data from the server:', error);
        if (window.EmployeeUI) { EmployeeUI.showError(error); EmployeeUI.failTables(); }
    }
}

function renderOrderDetails(order) {
    if (!order) return;

    setText('orderCode', order.orderCode);
    setText('orderClient', order.orderClient ? `Customer: ${order.orderClient}` : '');
    setText('itemLabel', order.itemLabel);

    const typeBadge = document.getElementById('orderTypeBadge');
    if (typeBadge) {
        typeBadge.textContent = order.orderType || '';
        typeBadge.className = 'type-pill ' + (order.orderType === 'Pre-Order' ? 'type-preorder' : 'type-preset');
    }

    // Specification tags. Only real order_items columns are shown - there is
    // no sugar-level, ice-level, or shelf-assignment column in the schema,
    // so those tags are simply omitted rather than showing invented values.
    const tagRow = document.getElementById('tagRow');
    if (tagRow) {
        let tagsHtml = '';
        if (order.cupSize) {
            tagsHtml += `<span class="spec-tag"><i class="fa-solid fa-wine-glass"></i> ${escapeHtml(order.cupSize)}</span>`;
        }
        (order.toppings || []).forEach(top => {
            tagsHtml += `<span class="spec-tag"><i class="fa-solid fa-circle-dot"></i> ${escapeHtml(top)}</span>`;
        });
        if (order.claimSlot) {
            tagsHtml += `<span class="spec-tag highlight"><i class="fa-regular fa-clock"></i> ${escapeHtml(order.claimSlot)}</span>`;
        }
        tagRow.innerHTML = tagsHtml || '<span class="spec-tag">No customization recorded</span>';
    }

    // There is no per-order recipe/instructions table, so this note stays
    // generic instead of showing a fixed, made-up recipe for every order.
    const notesEl = document.getElementById('recipeInstructions');
    if (notesEl) notesEl.textContent = 'Prepare according to standard recipe for this item, then seal and mark ready.';

    const shelfEl = document.getElementById('shelfIndicatorTag');
    if (shelfEl) shelfEl.textContent = '';
}

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value || '';
}

function renderMaterialInventoryCheck(materials) {
    const container = document.getElementById('materialsList');
    if (!container) return;

    if (!materials || materials.length === 0) {
        container.innerHTML = '<div style="text-align:center; padding:20px; color:#888;">No inventory materials recorded.</div>';
        return;
    }

    container.innerHTML = materials.map(mat => `
        <div class="materials-row">
            <span class="col-name">${escapeHtml(mat.name)}</span>
            <span class="col-amount">${escapeHtml(mat.amount)}</span>
            <span class="col-unit">${escapeHtml(mat.unit)}</span>
        </div>
    `).join('');
}

async function handleCompleteOrder(orderId) {
    const confirmAction = confirm(`Mark order "${orderId}" as SEALED & READY for pickup?`);
    if (!confirmAction) return;

    try {
        const response = await employeeFetch('/api/production-supervisor/complete-order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ order_id: orderId, stage: 'READY' })
        });
        if (!response.ok) throw new Error(await EmployeeUI.errorMessage(response));
    } catch (err) {
        console.error('Complete order failed:', err);
        alert('Could not mark this order as ready: ' + (err.message || 'unknown error') + '. Nothing was changed.');
        return;
    }

    alert(`Order ${orderId} is now marked Ready for Pickup.`);
    window.location.href = 'orderList.html';
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