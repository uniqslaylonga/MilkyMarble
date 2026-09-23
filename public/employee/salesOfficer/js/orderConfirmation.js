// Confirmation desk state
let allPendingOrders = [];
let filteredPendingOrders = [];
let currentOrderPage = 1;
const ORDERS_PAGE_SIZE = 5;
let isRegisterLocked = localStorage.getItem('isRegisterLocked') === 'true';

document.addEventListener('DOMContentLoaded', async () => {
    const filterSelect = document.getElementById('orderDateFilter');
    const customDateInput = document.getElementById('orderCustomDate');

    if (filterSelect) {
        filterSelect.addEventListener('change', (e) => {
            if (e.target.value === 'custom') {
                customDateInput.style.display = 'inline-block';
                if (!customDateInput.value) {
                    customDateInput.value = SalesCommon.localDate(new Date());
                }
            } else {
                customDateInput.style.display = 'none';
            }
            applyOrderFilters();
        });
    }

    if (customDateInput) customDateInput.addEventListener('change', applyOrderFilters);

    const prevBtn = document.getElementById('prevOrderBtn');
    const nextBtn = document.getElementById('nextOrderBtn');

    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            if (currentOrderPage > 1) {
                currentOrderPage--;
                renderPaginatedOrders();
            }
        });
    }

    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            const totalPages = Math.ceil(filteredPendingOrders.length / ORDERS_PAGE_SIZE) || 1;
            if (currentOrderPage < totalPages) {
                currentOrderPage++;
                renderPaginatedOrders();
            }
        });
    }

    await loadOrderConfirmationData();
});

// Load pending queue from API
async function loadOrderConfirmationData() {
    try {
        const userId = localStorage.getItem('userId') || sessionStorage.getItem('userId');
        const headers = userId ? { 'x-user-id': userId } : {};

        const response = await fetch('/api/sales-officer/order-confirmation', { headers });
        if (!response.ok) throw new Error(await SalesCommon.errorMessage(response));

        const data = await response.json();

        if (data.user) {
            const userNameEl = document.getElementById('userName');
            const userAvatarEl = document.getElementById('userAvatar');
            if (userNameEl) userNameEl.textContent = data.user.fullName || 'Sales Officer';
            if (userAvatarEl && data.user.avatarSrc) userAvatarEl.src = data.user.avatarSrc;
        }

        if (data.metrics) {
            const pendingEl = document.getElementById('pendingCount');
            const confirmedEl = document.getElementById('confirmedCount');
            const rejectedEl = document.getElementById('rejectedCount');

            if (pendingEl) pendingEl.textContent = Number(data.metrics.pendingCount || 0).toLocaleString();
            if (confirmedEl) confirmedEl.textContent = Number(data.metrics.confirmedToday || 0).toLocaleString();
            if (rejectedEl) rejectedEl.textContent = Number(data.metrics.rejectedCount || 0).toLocaleString();
        }

        allPendingOrders = data.pendingOrders || [];
        applyOrderFilters();

    } catch (error) {
        console.error('Could not load live data from server:', error);
        SalesCommon.showError(error);
        SalesCommon.failTables();
    }
}

// Date filters
function applyOrderFilters() {
    const filterType = document.getElementById('orderDateFilter')?.value || 'today';
    const customDateVal = document.getElementById('orderCustomDate')?.value;

    const now = new Date();
    const todayStr = SalesCommon.localDate(now);
    const weekAgo = new Date(now);
    weekAgo.setDate(now.getDate() - 7);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    filteredPendingOrders = allPendingOrders.filter(ord => {
        if (!ord.placed_at) return true;
        const ordDate = new Date(ord.placed_at);
        const ordDateStr = SalesCommon.localDate(ord.placed_at);

        if (filterType === 'today') return ordDateStr === todayStr;
        if (filterType === 'week') return ordDate >= weekAgo;
        if (filterType === 'month') return ordDate >= startOfMonth;
        if (filterType === 'custom') return ordDateStr === customDateVal;
        return true;
    });

    currentOrderPage = 1;
    renderPaginatedOrders();
}

// Render order list with member/walkin tags
function renderPaginatedOrders() {
    const tableBody = document.getElementById('confirmationTableBody');
    const pageInfo = document.getElementById('orderPageInfo');
    const prevBtn = document.getElementById('prevOrderBtn');
    const nextBtn = document.getElementById('nextOrderBtn');

    if (!tableBody) return;

    if (filteredPendingOrders.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="6" class="loading-state-text">No pending orders found for the selected period.</td>
            </tr>
        `;
        if (pageInfo) pageInfo.textContent = 'Showing 0 of 0 orders';
        if (prevBtn) prevBtn.disabled = true;
        if (nextBtn) nextBtn.disabled = true;
        renderPagerButtons(1, 1);
        return;
    }

    const totalPages = Math.ceil(filteredPendingOrders.length / ORDERS_PAGE_SIZE) || 1;
    const startIndex = (currentOrderPage - 1) * ORDERS_PAGE_SIZE;
    const pageItems = filteredPendingOrders.slice(startIndex, startIndex + ORDERS_PAGE_SIZE);

    if (pageInfo) {
        const startNum = startIndex + 1;
        const endNum = Math.min(startIndex + ORDERS_PAGE_SIZE, filteredPendingOrders.length);
        pageInfo.textContent = `Showing ${startNum}-${endNum} of ${filteredPendingOrders.length} orders`;
    }
    if (prevBtn) prevBtn.disabled = currentOrderPage <= 1;
    if (nextBtn) nextBtn.disabled = currentOrderPage >= totalPages;

    renderPagerButtons(totalPages, currentOrderPage);

    tableBody.innerHTML = pageItems.map(ord => {
        const dateFormatted = new Date(ord.placed_at).toLocaleDateString('en-US', {
            month: 'short',
            day: '2-digit',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });
        const amount = Number(ord.total_amount || 0).toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });

        const isWalkin = !ord.customer_id || String(ord.customer_name || '').toLowerCase().includes('walk');
        const badgeClass = isWalkin ? 'badge-walkin' : 'badge-member';
        const badgeText = isWalkin ? 'Walk-in' : 'Member';
        const displayName = escapeHtml(ord.customer_name || 'Walk-in Counter');

        return `
            <tr id="order-row-${ord.id}">
                <td>
                    <span class="order-code-bold">${escapeHtml(ord.order_number || 'MM-ORD')}</span>
                    <span class="order-time-sub">${dateFormatted}</span>
                </td>
                <td>
                    <div class="customer-cell-wrap">
                        <span class="cust-name">${displayName}</span>
                        <span class="client-badge ${badgeClass}">${badgeText}</span>
                    </div>
                </td>
                <td>
                    <div class="items-summary-text">${escapeHtml(ord.items_summary || 'Custom drink order')}</div>
                </td>
                <td>
                    <span class="payment-method-pill">${escapeHtml(ord.payment_method || 'Cash on Pick-Up')}</span>
                </td>
                <td>
                    <span class="order-total-val">₱${amount}</span>
                </td>
                <td style="text-align: center;">
                    <div class="action-btn-group">
                        <button type="button" class="btn-confirm" onclick="confirmOrder(${ord.id})" title="Approve &amp; Send to Kitchen">Confirm</button>
                        <button type="button" class="btn-reject" onclick="rejectOrder(${ord.id})" title="Cancel Order">Reject</button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

// Smart sliding pagination controls
function renderPagerButtons(totalPages, activePage) {
    const pagerNumbers = document.getElementById('orderPagerNumbers');
    if (!pagerNumbers) return;

    if (totalPages <= 1) {
        pagerNumbers.innerHTML = `<button type="button" class="pager-num-btn active" data-page="1">1</button>`;
        return;
    }

    const pages = [];
    if (totalPages <= 7) {
        for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
        if (activePage <= 4) {
            pages.push(1, 2, 3, 4, 5, '...', totalPages);
        } else if (activePage >= totalPages - 3) {
            pages.push(1, '...', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages);
        } else {
            pages.push(1, '...', activePage - 1, activePage, activePage + 1, '...', totalPages);
        }
    }

    let html = '';
    pages.forEach(p => {
        if (p === '...') {
            html += `<span class="pager-ellipsis">&hellip;</span>`;
        } else {
            const isActive = p === activePage ? 'active' : '';
            html += `<button type="button" class="pager-num-btn ${isActive}" data-page="${p}">${p}</button>`;
        }
    });
    pagerNumbers.innerHTML = html;

    pagerNumbers.querySelectorAll('.pager-num-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const page = parseInt(e.currentTarget.getAttribute('data-page'), 10);
            if (page && page !== currentOrderPage) {
                currentOrderPage = page;
                renderPaginatedOrders();
            }
        });
    });
}

// Push to kitchen with register-lock guard & themed confirm
async function confirmOrder(orderId) {
    if (isRegisterLocked) {
        SalesCommon.alert('Register Locked', 'The sales counter register is currently locked. Orders cannot be confirmed.', 'warning');
        return;
    }

    const isConfirmed = await SalesCommon.confirm(
        'Confirm Order Approval?',
        `Are you sure you want to approve Order #${orderId}? It will be queued to kitchen production.`,
        'Yes, Confirm',
        'Cancel'
    );
    if (!isConfirmed) return;

    try {
        const response = await fetch(`/api/orders/${orderId}/status`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'PREPARING' })
        });

        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.message || 'Failed to confirm order.');

        allPendingOrders = allPendingOrders.filter(o => o.id !== orderId);

        const pendingEl = document.getElementById('pendingCount');
        const confirmedEl = document.getElementById('confirmedCount');
        if (pendingEl) pendingEl.textContent = allPendingOrders.length;
        if (confirmedEl) confirmedEl.textContent = (parseInt(confirmedEl.textContent || '0', 10) + 1).toString();

        applyOrderFilters();
        SalesCommon.alert('Order Confirmed', `Order #${orderId} has been sent to production queue.`, 'success');
    } catch (err) {
        console.error('Error confirming order:', err);
        SalesCommon.alert('Confirmation Failed', err.message || 'Could not confirm order.', 'warning');
    }
}

// Reject order with themed prompt
async function rejectOrder(orderId) {
    const reason = await SalesCommon.prompt(
        'Reject Order',
        `Please specify the reason for cancelling Order #${orderId} (optional):`,
        'e.g. Out of stock, duplicate order, customer cancellation'
    );
    if (reason === null) return;

    try {
        const response = await fetch(`/api/orders/${orderId}/status`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'CANCELLED', reason: reason || 'Cancelled by Sales Officer' })
        });

        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.message || 'Failed to reject order.');

        allPendingOrders = allPendingOrders.filter(o => o.id !== orderId);

        const pendingEl = document.getElementById('pendingCount');
        const rejectedEl = document.getElementById('rejectedCount');
        if (pendingEl) pendingEl.textContent = allPendingOrders.length;
        if (rejectedEl) rejectedEl.textContent = (parseInt(rejectedEl.textContent || '0', 10) + 1).toString();

        applyOrderFilters();
        SalesCommon.alert('Order Rejected', `Order #${orderId} has been cancelled.`, 'info');
    } catch (err) {
        console.error('Error rejecting order:', err);
        SalesCommon.alert('Rejection Failed', err.message || 'Could not reject order.', 'warning');
    }
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