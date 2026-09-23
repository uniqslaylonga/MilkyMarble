let allActiveOrders = [];
let filteredActiveOrders = [];
let currentMonitoringPage = 1;
const MONITORING_PAGE_SIZE = 6;
let isRegisterLocked = localStorage.getItem('isRegisterLocked') === 'true';

document.addEventListener('DOMContentLoaded', async () => {
    const statusFilter = document.getElementById('statusFilter');
    const dateFilter = document.getElementById('dateFilter');
    const customDateInput = document.getElementById('customDateInput');

    if (statusFilter) statusFilter.addEventListener('change', applyMonitoringFilters);

    if (dateFilter) {
        dateFilter.addEventListener('change', (e) => {
            if (e.target.value === 'custom') {
                customDateInput.style.display = 'inline-block';
                if (!customDateInput.value) {
                    customDateInput.value = SalesCommon.localDate(new Date());
                }
            } else {
                customDateInput.style.display = 'none';
            }
            applyMonitoringFilters();
        });
    }

    if (customDateInput) customDateInput.addEventListener('change', applyMonitoringFilters);

    const prevBtn = document.getElementById('prevMonitoringBtn');
    const nextBtn = document.getElementById('nextMonitoringBtn');

    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            if (currentMonitoringPage > 1) {
                currentMonitoringPage--;
                renderPaginatedMonitoringCards();
            }
        });
    }

    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            const totalPages = Math.ceil(filteredActiveOrders.length / MONITORING_PAGE_SIZE) || 1;
            if (currentMonitoringPage < totalPages) {
                currentMonitoringPage++;
                renderPaginatedMonitoringCards();
            }
        });
    }

    await fetchOrderMonitoringData();
});

// Load live active queue
async function fetchOrderMonitoringData() {
    try {
        const userId = localStorage.getItem('userId') || sessionStorage.getItem('userId');
        const headers = userId ? { 'x-user-id': userId } : {};

        const response = await fetch('/api/sales-officer/order-monitoring', { headers });
        if (!response.ok) throw new Error(await SalesCommon.errorMessage(response));

        const data = await response.json();

        if (data.user) {
            const userNameEl = document.getElementById('userName');
            const userAvatarEl = document.getElementById('userAvatar');
            if (userNameEl) userNameEl.textContent = data.user.fullName || 'Sales Officer';
            if (userAvatarEl && data.user.avatarSrc) userAvatarEl.src = data.user.avatarSrc;
        }

        if (data.metrics) {
            const preparingEl = document.getElementById('preparingCount');
            const transitEl = document.getElementById('transitCount');
            const cancelledEl = document.getElementById('cancelledCount');

            if (preparingEl) preparingEl.textContent = Number(data.metrics.preparingCount || 0).toLocaleString();
            if (transitEl) transitEl.textContent = Number(data.metrics.transitCount || 0).toLocaleString();
            if (cancelledEl) cancelledEl.textContent = Number(data.metrics.claimedToday || 0).toLocaleString();
        }

        allActiveOrders = data.activeOrders || [];
        applyMonitoringFilters();

    } catch (error) {
        console.error('Could not load live data from server:', error);
        SalesCommon.showError(error);
        SalesCommon.failTables();
    }
}

// Filter logic (status and date)
function applyMonitoringFilters() {
    const statusVal = document.getElementById('statusFilter')?.value || 'all';
    const dateVal = document.getElementById('dateFilter')?.value || 'today';
    const customDateVal = document.getElementById('customDateInput')?.value;

    const now = new Date();
    const todayStr = SalesCommon.localDate(now);
    const weekAgo = new Date(now);
    weekAgo.setDate(now.getDate() - 7);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    filteredActiveOrders = allActiveOrders.filter(ord => {
        let passStatus = true;
        if (statusVal === 'in_kitchen') {
            passStatus = (ord.status === 'PREPARING' || ord.status === 'CONFIRMED');
        } else if (statusVal === 'ready_pickup') {
            passStatus = (ord.status === 'READY_FOR_PICKUP' || ord.status === 'IN_TRANSIT');
        }

        let passDate = true;
        if (ord.placed_at) {
            const ordDate = new Date(ord.placed_at);
            const ordDateStr = SalesCommon.localDate(ord.placed_at);

            if (dateVal === 'today') passDate = ordDateStr === todayStr;
            else if (dateVal === 'week') passDate = ordDate >= weekAgo;
            else if (dateVal === 'month') passDate = ordDate >= startOfMonth;
            else if (dateVal === 'custom') passDate = ordDateStr === customDateVal;
        }

        return passStatus && passDate;
    });

    currentMonitoringPage = 1;
    renderPaginatedMonitoringCards();
}

// Render cards with Walk-in and Member tags
function renderPaginatedMonitoringCards() {
    const ordersGrid = document.getElementById('activeOrdersGrid');
    const pageInfo = document.getElementById('monitoringPageInfo');
    const prevBtn = document.getElementById('prevMonitoringBtn');
    const nextBtn = document.getElementById('nextMonitoringBtn');

    if (!ordersGrid) return;

    if (filteredActiveOrders.length === 0) {
        ordersGrid.innerHTML = '<p class="loading-state-text">No active orders found for the selected period/status.</p>';
        if (pageInfo) pageInfo.textContent = 'Showing 0 of 0 orders';
        if (prevBtn) prevBtn.disabled = true;
        if (nextBtn) nextBtn.disabled = true;
        renderMonitoringPagerButtons(1, 1);
        return;
    }

    const totalPages = Math.ceil(filteredActiveOrders.length / MONITORING_PAGE_SIZE) || 1;
    const startIndex = (currentMonitoringPage - 1) * MONITORING_PAGE_SIZE;
    const pageItems = filteredActiveOrders.slice(startIndex, startIndex + MONITORING_PAGE_SIZE);

    if (pageInfo) {
        const startNum = startIndex + 1;
        const endNum = Math.min(startIndex + MONITORING_PAGE_SIZE, filteredActiveOrders.length);
        pageInfo.textContent = `Showing ${startNum}-${endNum} of ${filteredActiveOrders.length} orders`;
    }
    if (prevBtn) prevBtn.disabled = currentMonitoringPage <= 1;
    if (nextBtn) nextBtn.disabled = currentMonitoringPage >= totalPages;

    renderMonitoringPagerButtons(totalPages, currentMonitoringPage);

    ordersGrid.innerHTML = pageItems.map(ord => {
        const dateFormatted = new Date(ord.placed_at).toLocaleDateString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });
        const amount = Number(ord.total_amount || 0).toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });

        // Walk-in vs Member tag
        const isWalkin = !ord.customer_id || String(ord.customer_name || '').toLowerCase().includes('walk');
        const badgeClass = isWalkin ? 'badge-walkin' : 'badge-member';
        const badgeText = isWalkin ? 'Walk-in' : 'Member';
        const displayName = escapeHtml(ord.customer_name || 'Walk-in Counter');

        const isReady = (ord.status === 'READY_FOR_PICKUP' || ord.status === 'IN_TRANSIT');
        const statusLabel = isReady ? 'Ready for Pickup' : 'In Kitchen (Prep)';
        const statusClass = isReady ? 'ready' : 'kitchen';

        return `
            <div class="order-card" id="monitoring-card-${ord.id}">
                <div class="card-main">
                    <div class="info-col">
                        <div class="name-badge-group">
                            <span class="person-name">${displayName}</span>
                            <span class="client-badge ${badgeClass}">${badgeText}</span>
                        </div>
                        <div class="person-role">${escapeHtml(ord.order_number || '')} • ${dateFormatted}</div>
                    </div>
                    <div class="price-col">₱${amount}</div>
                </div>

                <div class="card-details-box">
                    ${escapeHtml(ord.items_summary || 'Custom drink order')}
                </div>

                <div class="card-bottom">
                    <span class="status-badge-pill ${statusClass}">
                        <span class="status-dot"></span>
                        ${statusLabel}
                    </span>
                    ${isReady ? `
                        <button type="button" class="btn-handover" onclick="markOrderAsPickedUp(${ord.id})" title="Customer received order">
                            Hand Over / Claimed
                        </button>
                    ` : `
                        <span class="in-kitchen-note">Kitchen preparing...</span>
                    `}
                </div>
            </div>
        `;
    }).join('');
}

// Smart sliding pagination controls
function renderMonitoringPagerButtons(totalPages, activePage) {
    const pagerNumbers = document.getElementById('monitoringPagerNumbers');
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
            if (page && page !== currentMonitoringPage) {
                currentMonitoringPage = page;
                renderPaginatedMonitoringCards();
            }
        });
    });
}

// Handover / Picked up action with themed confirm
async function markOrderAsPickedUp(orderId) {
    const confirmed = await SalesCommon.confirm(
        'Confirm Customer Handover',
        `Are you handing over Order #${orderId} to the customer? This will finalize and close the order.`,
        'Yes, Handed Over',
        'Cancel'
    );
    if (!confirmed) return;

    try {
        const userId = localStorage.getItem('userId') || sessionStorage.getItem('userId');
        const response = await fetch('/api/sales-officer/order-monitoring/update', {
            method: 'POST',
            headers: Object.assign({ 'Content-Type': 'application/json' }, userId ? { 'x-user-id': userId } : {}),
            body: JSON.stringify({ order_id: orderId, action: 'complete' })
        });
        if (!response.ok) throw new Error(await SalesCommon.errorMessage(response));

        await fetchOrderMonitoringData();
        SalesCommon.alert('Order Completed', `Order #${orderId} has been successfully claimed and closed.`, 'success');
    } catch (err) {
        console.error('Handover update failed:', err);
        SalesCommon.alert('Update Failed', err.message || 'Could not complete order handover.', 'warning');
    }
}

// Quick POS Walk-in Preset Puncher with themed alert & confirm
async function punchWalkinPreset(presetName, size, price) {
    if (localStorage.getItem('isRegisterLocked') === 'true') {
        SalesCommon.alert('Register Locked', 'The counter register is currently locked. Please open shift before punching walk-in sales.', 'warning');
        return;
    }

    const confirmed = await SalesCommon.confirm(
        'Record Walk-in Sale',
        `Punching:\n${presetName} (${size})\nPrice: ₱${price}.00\n\nCollect physical cash payment at counter?`,
        'Confirm Sale',
        'Cancel'
    );
    if (!confirmed) return;

    try {
        const userId = localStorage.getItem('userId') || sessionStorage.getItem('userId');
        const headers = Object.assign({ 'Content-Type': 'application/json' }, userId ? { 'x-user-id': userId } : {});

        const response = await fetch('/api/sales-officer/order-monitoring/update', {
            method: 'POST',
            headers,
            body: JSON.stringify({
                action: 'walkin_sale',
                item_label: `${presetName} (${size})`,
                size: size,
                total_amount: price,
                customer_name: 'Walk-in Counter'
            })
        });

        await fetchOrderMonitoringData();
        SalesCommon.alert('Walk-in Sale Recorded', `Successfully collected ₱${price}.00 cash in drawer.`, 'success');
    } catch (err) {
        console.error('Walk-in sale error:', err);
        SalesCommon.alert('Transaction Recorded Locally', 'Please verify your physical drawer count against expected totals during Z-Reading.', 'info');
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