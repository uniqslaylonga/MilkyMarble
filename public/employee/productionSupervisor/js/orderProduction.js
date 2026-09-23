let loadedOrderId = null;

document.addEventListener('DOMContentLoaded', () => {
    // 1. Get order_id from URL parameter
    const urlParams = new URLSearchParams(window.location.search);
    const orderId = urlParams.get('order_id') || urlParams.get('id') || '';

    // 2. Fetch order details and recipe materials
    fetchOrderProductionDetails(orderId);

    // 3. Form submission listener
    const completeForm = document.getElementById('completeOrderForm');
    if (completeForm) {
        completeForm.addEventListener('submit', (e) => {
            e.preventDefault();
            handleCompleteOrder(loadedOrderId || orderId);
        });
    }
});

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

        loadedOrderId = data.order ? data.order.id : null;
        renderOrderDetails(data.order);
        renderMaterialInventoryCheck(data.materials);

    } catch (error) {
        console.error('Could not load production order details:', error);
        showCustomSwal('Error Loading Order', error.message || 'Failed to retrieve order assembly specs.', 'warning');
    }
}

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
        notesEl.textContent = 'Prepare according to recipe BOM specifications, seal with cup lid, insert straw, and transfer to holding chiller for release.';
    }

    const shelfEl = document.getElementById('shelfIndicatorTag');
    if (shelfEl) {
        shelfEl.textContent = order.claimSlot ? `Holding Slot: ${order.claimSlot}` : 'Counter Chiller Holding Shelf';
    }
}

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value || '';
}

function renderMaterialInventoryCheck(materials) {
    const container = document.getElementById('materialsList');
    if (!container) return;

    if (!materials || materials.length === 0) {
        container.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-muted);">No materials record attached to this item.</div>';
        return;
    }

    container.innerHTML = materials.map((mat, idx) => `
        <div class="materials-row ${idx === materials.length - 1 ? 'last-row' : ''}">
            <span class="col-name">${escapeHtml(mat.name)}</span>
            <span class="col-amount">${escapeHtml(String(mat.amount))}</span>
            <span class="col-unit">${escapeHtml(mat.unit || 'pcs')}</span>
        </div>
    `).join('');
}

// Complete order with themed SweetAlert2 confirmation
async function handleCompleteOrder(orderId) {
    if (!orderId) {
        showCustomSwal('Order Not Found', 'No active order selected for completion.', 'warning');
        return;
    }

    const confirmed = await showCustomConfirm(
        'Seal & Mark Shelf-Ready?',
        `Confirm that Order #${orderId} assembly is finished. Ingredients and packaging will be deducted automatically from inventory.`,
        'Complete & Mark Ready',
        'Cancel'
    );
    if (!confirmed) return;

    try {
        let response;
        const payload = { order_id: orderId, stage: 'READY' };

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

        await showCustomSwal('Order Ready', `Order #${orderId} has been marked Ready for Pickup and inventory has been deducted.`, 'success');
        window.location.href = 'orderList.html';

    } catch (err) {
        console.error('Complete order failed:', err);
        showCustomSwal('Completion Failed', err.message || 'Could not mark order ready.', 'warning');
    }
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