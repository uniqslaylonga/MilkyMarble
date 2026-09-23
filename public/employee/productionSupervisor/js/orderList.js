let allOrders = [];
let filteredOrders = [];
let allPresets = [];
let currentOrderPage = 1;
const ORDERS_PAGE_SIZE = 5;
let currentFilterTab = 'all';

document.addEventListener('DOMContentLoaded', () => {
    // 1. Search Bar Listener
    const searchInput = document.getElementById('orderSearchInput');
    if (searchInput) {
        searchInput.addEventListener('input', applyOrderFilters);
    }

    // 2. Filter Tabs (All / Pre-order / Preset)
    const tabButtons = document.querySelectorAll('.order-filter-tabs .tab-btn');
    tabButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            tabButtons.forEach(b => b.classList.remove('active'));
            e.currentTarget.classList.add('active');
            currentFilterTab = e.currentTarget.getAttribute('data-filter') || 'all';
            applyOrderFilters();
        });
    });

    // 3. Permanent Pagination Buttons
    const prevBtn = document.getElementById('prevOrderBtn');
    const nextBtn = document.getElementById('nextOrderBtn');

    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            if (currentOrderPage > 1) {
                currentOrderPage--;
                renderOrdersTable();
            }
        });
    }

    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            const totalPages = Math.ceil(filteredOrders.length / ORDERS_PAGE_SIZE) || 1;
            if (currentOrderPage < totalPages) {
                currentOrderPage++;
                renderOrdersTable();
            }
        });
    }

    fetchOrderListData();
});

async function fetchOrderListData() {
    try {
        let response;
        if (typeof employeeFetch === 'function') {
            response = await employeeFetch('/api/production-supervisor/order-list');
        } else {
            const userId = localStorage.getItem('userId') || sessionStorage.getItem('userId');
            const headers = userId ? { 'x-user-id': userId } : {};
            response = await fetch('/api/production-supervisor/order-list', { headers });
        }

        if (!response.ok) throw new Error(await EmployeeUI.errorMessage(response));

        const data = await response.json();

        // User profile setup
        const userFullNameEl = document.getElementById('userFullName');
        const userAvatarEl = document.getElementById('userAvatar');
        if (userFullNameEl) userFullNameEl.textContent = data.user.fullName || 'Production Supervisor';
        if (userAvatarEl && data.user.avatarSrc) userAvatarEl.src = data.user.avatarSrc;

        // KPI Counts - real order-status counts from the server, 0 if none.
        const k = data.kpis || {};
        document.getElementById('preordersTargetCount').textContent = String(k.pendingCount || 0);
        document.getElementById('presetsQuotaCount').textContent = String(k.inProgressCount || 0);
        document.getElementById('sealedReadyCount').textContent = String(k.readyCount || 0);
        document.getElementById('inQueueCount').textContent = String(k.completedCount || 0);

        allOrders = data.ordersList || [];
        allPresets = data.presetCards || [];
        applyOrderFilters();
        renderPresetBatchAllocator();

    } catch (error) {
        console.error('Could not load live data from the server:', error);
        if (window.EmployeeUI) { EmployeeUI.showError(error); EmployeeUI.failTables(); }
    }
}

// Filter Logic (Search Query + Tab Filters)
function applyOrderFilters() {
    const searchVal = document.getElementById('orderSearchInput')?.value.trim().toLowerCase() || '';

    filteredOrders = allOrders.filter(ord => {
        // Tab Filter
        if (currentFilterTab === 'preorder' && ord.type !== 'preorder') return false;
        if (currentFilterTab === 'preset' && ord.type !== 'preset') return false;

        // Search Filter
        if (searchVal) {
            const num = (ord.order_number || '').toLowerCase();
            const cust = (ord.customer_name || '').toLowerCase();
            const flavor = (ord.cleanTitle || '').toLowerCase();
            const specs = (ord.specs || '').toLowerCase();
            if (!num.includes(searchVal) && !cust.includes(searchVal) && !flavor.includes(searchVal) && !specs.includes(searchVal)) {
                return false;
            }
        }

        return true;
    });

    currentOrderPage = 1;
    renderOrdersTable();
}

// Render Orders Table with Pagination
function renderOrdersTable() {
    const tbody = document.getElementById('ordersTableBody');
    const pageInfo = document.getElementById('orderPageInfo');
    const prevBtn = document.getElementById('prevOrderBtn');
    const nextBtn = document.getElementById('nextOrderBtn');

    if (!tbody) return;

    if (filteredOrders.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="loading-state-text">No orders matched the current filter or search criteria.</td></tr>';
        if (pageInfo) pageInfo.textContent = 'Showing 0 of 0 orders';
        if (prevBtn) prevBtn.disabled = true;
        if (nextBtn) nextBtn.disabled = true;
        renderOrderPagerButtons(1, 1);
        return;
    }

    const totalPages = Math.ceil(filteredOrders.length / ORDERS_PAGE_SIZE) || 1;
    const startIndex = (currentOrderPage - 1) * ORDERS_PAGE_SIZE;
    const pageItems = filteredOrders.slice(startIndex, startIndex + ORDERS_PAGE_SIZE);

    if (pageInfo) {
        const startNum = startIndex + 1;
        const endNum = Math.min(startIndex + ORDERS_PAGE_SIZE, filteredOrders.length);
        pageInfo.textContent = `Showing ${startNum}-${endNum} of ${filteredOrders.length} orders`;
    }
    if (prevBtn) prevBtn.disabled = currentOrderPage <= 1;
    if (nextBtn) nextBtn.disabled = currentOrderPage >= totalPages;

    renderOrderPagerButtons(totalPages, currentOrderPage);

    tbody.innerHTML = pageItems.map(ord => {
        const isPreorder = ord.type === 'preorder';
        const typeClass = isPreorder ? 'type-preorder' : 'type-preset';
        const typeText = isPreorder ? 'Pre-order' : 'Walk-in Preset';
        const isReady = ord.statusClass === 'ready';

        return `
            <tr>
                <td>
                    <div class="order-identity-block">
                        <strong>${escapeHtml(ord.order_number)}</strong>
                        <small>${escapeHtml(ord.customer_name)}</small>
                        <span class="type-pill ${typeClass}">${typeText}</span>
                    </div>
                </td>
                <td>
                    <div class="specs-title">${escapeHtml(ord.cleanTitle)}</div>
                    <div class="specs-detail-pill">${escapeHtml(ord.specs)}</div>
                </td>
                <td><strong>${ord.quantity || 1}</strong></td>
                <td><span style="font-size: 11.5px; font-weight: 700; color: var(--text-muted);">${escapeHtml(ord.claim_slot)}</span></td>
                <td><span class="shelf-tag-badge">${escapeHtml(ord.shelf_tag)}</span></td>
                <td>
                    <span class="status-badge-prep ${isReady ? 'ready' : 'inprep'}">
                        ${escapeHtml(ord.statusLabel)}
                    </span>
                </td>
                <td>
                    <button type="button" class="btn-kitchen-action" onclick="window.location.href='orderProduction.html?order_id=${ord.id}'">
                        ${isReady ? 'Review Recipe' : 'Mix &amp; Assemble'}
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

// Numbered Page Buttons: 1, 2, 3...
function renderOrderPagerButtons(totalPages, activePage) {
    const pagerNumbers = document.getElementById('orderPagerNumbers');
    if (!pagerNumbers) return;

    let html = '';
    for (let i = 1; i <= totalPages; i++) {
        const isActive = i === activePage ? 'active' : '';
        html += `<button type="button" class="pager-num-btn ${isActive}" data-page="${i}">${i}</button>`;
    }
    pagerNumbers.innerHTML = html;

    pagerNumbers.querySelectorAll('.pager-num-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const page = parseInt(e.currentTarget.getAttribute('data-page'), 10);
            if (page && page !== currentOrderPage) {
                currentOrderPage = page;
                renderOrdersTable();
            }
        });
    });
}

// Render Walk-in Preset Batch Allocator
function renderPresetBatchAllocator() {
    const container = document.getElementById('presetGrid');
    if (!container) return;

    if (allPresets.length === 0) {
        container.innerHTML = '<div style="color: var(--text-muted); padding: 10px;">Preset batch tracking isn\'t set up yet.</div>';
        return;
    }

    container.innerHTML = allPresets.map(preset => {
        const pct = preset.target_batch ? Math.round((preset.sealed_count / preset.target_batch) * 100) : 0;

        return `
            <article class="preset-card">
                <div class="preset-top">
                    <span class="preset-name">${escapeHtml(preset.name)}</span>
                    <span class="section-badge-pink">${pct}% Ready</span>
                </div>
                <div class="preset-body">
                    <div class="preset-specs-row">
                        <span>Batch Stock: <strong>${preset.sealed_count} / ${preset.target_batch} Cups</strong></span>
                        <span style="font-size: 11px; color: var(--text-muted);">${escapeHtml(preset.specs)}</span>
                    </div>
                    <div class="progress-track-sm">
                        <div class="progress-fill-sm" style="width: ${Math.min(pct, 100)}%;"></div>
                    </div>
                </div>
                <div class="preset-card-footer">
                    <span class="chiller-location">📍 ${escapeHtml(preset.chiller_rack)}</span>
                    <button type="button" class="btn-batch-action" onclick="window.location.href='orderProduction.html?batch_name=${encodeURIComponent(preset.name)}'">
                        Brew / Seal More
                    </button>
                </div>
            </article>
        `;
    }).join('');
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