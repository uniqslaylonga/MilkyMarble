let allQueueOrders = [];
let filteredQueueOrders = [];
let allRestockPitches = [];
let currentQueuePage = 1;
const QUEUE_PAGE_SIZE = 4;

document.addEventListener('DOMContentLoaded', () => {
    // 1. Live DOA Threshold Calculation sa Modal
    const qtyInput = document.getElementById('inputQuantity');
    const unitPriceInput = document.getElementById('inputUnitPrice');
    if (qtyInput && unitPriceInput) {
        qtyInput.addEventListener('input', calculateRestockThreshold);
        unitPriceInput.addEventListener('input', calculateRestockThreshold);
    }

    // 2. Search Listener
    const searchInput = document.getElementById('kitchenSearchInput');
    if (searchInput) {
        searchInput.addEventListener('input', applyQueueSearch);
    }

    // 3. Queue Pagination Buttons
    const prevBtn = document.getElementById('prevQueueBtn');
    const nextBtn = document.getElementById('nextQueueBtn');

    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            if (currentQueuePage > 1) {
                currentQueuePage--;
                renderQueueTable();
            }
        });
    }

    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            const totalPages = Math.ceil(filteredQueueOrders.length / QUEUE_PAGE_SIZE) || 1;
            if (currentQueuePage < totalPages) {
                currentQueuePage++;
                renderQueueTable();
            }
        });
    }

    // 4. Modal Form Submit
    const restockForm = document.getElementById('restockPitchForm');
    if (restockForm) {
        restockForm.addEventListener('submit', handleRestockPitchSubmit);
    }

    fetchProductionDashboardData();
});

async function fetchProductionDashboardData() {
    try {
        let response;
        if (typeof employeeFetch === 'function') {
            response = await employeeFetch('/api/production-supervisor/dashboard');
        } else {
            const userId = localStorage.getItem('userId') || sessionStorage.getItem('userId');
            const headers = userId ? { 'x-user-id': userId } : {};
            response = await fetch('/api/production-supervisor/dashboard', { headers });
        }

        if (!response.ok) throw new Error(await EmployeeUI.errorMessage(response));

        const data = await response.json();

        // User profile setup
        const userFullNameEl = document.getElementById('userFullName');
        const userFirstNameEl = document.getElementById('userFirstName');
        const userAvatarEl = document.getElementById('userAvatar');

        if (userFullNameEl) userFullNameEl.textContent = data.user.fullName || 'Production Supervisor';
        if (userFirstNameEl) userFirstNameEl.textContent = data.user.firstName || 'Supervisor';
        if (userAvatarEl && data.user.avatarSrc) userAvatarEl.src = data.user.avatarSrc;

        // KPI Metrics - straight from the server; 0 stays 0, nothing is
        // backfilled with a fake placeholder number.
        const m = data.metrics || {};
        document.getElementById('completedToday').textContent = String(m.completedToday || 0).padStart(2, '0');
        document.getElementById('inProduction').textContent = String(m.inProduction || 0).padStart(2, '0');
        document.getElementById('pendingOrders').textContent = m.preordersClaimedStr || '0 / 0';
        document.getElementById('reservedStocks').textContent = String(m.pendingRestocks || 0).padStart(2, '0');

        allQueueOrders = data.recentOrders || [];
        allRestockPitches = data.restockPitches || [];
        filteredQueueOrders = [...allQueueOrders];

        renderQueueTable();
        renderRestockPitches();
        renderScheduleList(data.scheduleList);

    } catch (error) {
        console.error('Could not load live data from the server:', error);
        if (window.EmployeeUI) { EmployeeUI.showError(error); EmployeeUI.failTables(); }
    }
}

// Live DOA Threshold Preview Calculation
function calculateRestockThreshold() {
    const qty = parseFloat(document.getElementById('inputQuantity')?.value || 0);
    const unitPrice = parseFloat(document.getElementById('inputUnitPrice')?.value || 0);
    const total = qty * unitPrice;

    const totalEl = document.getElementById('previewTotalCost');
    const badgeEl = document.getElementById('routingBadge');

    if (totalEl) {
        totalEl.textContent = '₱' + total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    if (badgeEl) {
        if (total <= 300) {
            badgeEl.className = 'badge-route route-procure';
            badgeEl.textContent = '🟢 Direct Route: Procurement Officer (Direct Purchase Authorized)';
        } else if (total > 300 && total <= 500) {
            badgeEl.className = 'badge-route route-finance';
            badgeEl.textContent = '🟠 Escalation Route: Requires Financial Officer Approval';
        } else {
            badgeEl.className = 'badge-route route-ceo';
            badgeEl.textContent = '🔴 Executive Route: Requires CEO Approval (High Capital Expense)';
        }
    }
}

// Render Restock Pitches (Right Column)
function renderRestockPitches() {
    const container = document.getElementById('restockPitchList');
    if (!container) return;

    if (allRestockPitches.length === 0) {
        container.innerHTML = '<p class="loading-state-text">No active ingredient requisitions pitched.</p>';
        return;
    }

    container.innerHTML = allRestockPitches.map(p => {
        let routeClass = 'route-procure';
        if (p.total_cost > 500) routeClass = 'route-ceo';
        else if (p.total_cost > 300) routeClass = 'route-finance';

        return `
            <div class="pitch-row-item">
                <div class="pitch-row-top">
                    <span class="pitch-item-title">${escapeHtml(p.item_name)} (${p.quantity}x)</span>
                    <span class="pitch-cost-bold">₱${Number(p.total_cost).toFixed(2)}</span>
                </div>
                <div class="pitch-row-footer">
                    <span class="badge-route ${routeClass}">${escapeHtml(p.route_text || '')}</span>
                    <span>Status: <strong>${escapeHtml(p.status || 'PENDING')}</strong></span>
                </div>
            </div>
        `;
    }).join('');
}

// Filter Queue Search
function applyQueueSearch() {
    const searchVal = document.getElementById('kitchenSearchInput')?.value.trim().toLowerCase() || '';
    filteredQueueOrders = allQueueOrders.filter(ro => {
        if (!searchVal) return true;
        const title = (ro.cleanTitle || '').toLowerCase();
        const num = (ro.order_number || '').toLowerCase();
        return title.includes(searchVal) || num.includes(searchVal);
    });
    currentQueuePage = 1;
    renderQueueTable();
}

// Render Queue Table with Permanent Pager
function renderQueueTable() {
    const tbody = document.getElementById('recentOrdersList');
    const pageInfo = document.getElementById('queuePageInfo');
    const prevBtn = document.getElementById('prevQueueBtn');
    const nextBtn = document.getElementById('nextQueueBtn');

    if (!tbody) return;

    if (filteredQueueOrders.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="loading-state-text">No active production orders recorded.</td></tr>';
        if (pageInfo) pageInfo.textContent = 'Showing 0 of 0 orders';
        if (prevBtn) prevBtn.disabled = true;
        if (nextBtn) nextBtn.disabled = true;
        renderQueuePagerButtons(1, 1);
        return;
    }

    const totalPages = Math.ceil(filteredQueueOrders.length / QUEUE_PAGE_SIZE) || 1;
    const startIndex = (currentQueuePage - 1) * QUEUE_PAGE_SIZE;
    const pageItems = filteredQueueOrders.slice(startIndex, startIndex + QUEUE_PAGE_SIZE);

    if (pageInfo) {
        const startNum = startIndex + 1;
        const endNum = Math.min(startIndex + QUEUE_PAGE_SIZE, filteredQueueOrders.length);
        pageInfo.textContent = `Showing ${startNum}-${endNum} of ${filteredQueueOrders.length} orders`;
    }
    if (prevBtn) prevBtn.disabled = currentQueuePage <= 1;
    if (nextBtn) nextBtn.disabled = currentQueuePage >= totalPages;

    renderQueuePagerButtons(totalPages, currentQueuePage);

    tbody.innerHTML = pageItems.map(ro => {
        const totalAmount = Number(ro.total_amount || 0).toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
        const isPreorder = ro.type === 'preorder';
        const typeClass = isPreorder ? 'type-preorder' : 'type-preset';
        const typeText = isPreorder ? 'Pre-order' : 'Walk-in Preset';
        const statusBadgeClass = ro.statusClass === 'ready' ? 'ready' : 'inprep';

        return `
            <tr onclick="window.location.href='orderProduction.html?order_id=${ro.id}'" style="cursor: pointer;">
                <td>
                    <strong style="color: var(--brown-soft);">${escapeHtml(ro.order_number)}</strong>
                    <div><span class="type-pill ${typeClass}">${typeText}</span></div>
                </td>
                <td>
                    <div style="font-weight: 700; color: var(--text-dark);">${escapeHtml(ro.cleanTitle)}</div>
                    <div style="font-size: 11px; color: var(--text-muted);">${ro.quantity || 1} cup(s)</div>
                </td>
                <td><span style="font-size: 11.5px; font-weight: 700; color: var(--text-muted);">${escapeHtml(ro.scheduleText)}</span></td>
                <td><strong style="color: var(--brown-soft);">₱${totalAmount}</strong></td>
                <td><span class="status-badge-prep ${statusBadgeClass}">${escapeHtml(ro.statusLabel)}</span></td>
            </tr>
        `;
    }).join('');
}

// Numbered Page Buttons
function renderQueuePagerButtons(totalPages, activePage) {
    const pagerNumbers = document.getElementById('queuePagerNumbers');
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
            if (page && page !== currentQueuePage) {
                currentQueuePage = page;
                renderQueueTable();
            }
        });
    });
}

// Render Schedule Preview (Tue/Thu slots)
function renderScheduleList(schedules) {
    const container = document.getElementById('scheduleList');
    if (!container) return;

    if (!schedules || schedules.length === 0) {
        container.innerHTML = '<div class="schedule-item"><div class="schedule-day">No scheduled pickups yet.</div></div>';
        return;
    }

    container.innerHTML = schedules.map(sch => `
        <div class="schedule-item">
            <div class="schedule-day">${escapeHtml(sch.dayName)}</div>
            <div class="schedule-time">${escapeHtml(sch.timeStr)}</div>
            <div class="schedule-label">${escapeHtml(sch.order_number)}</div>
        </div>
    `).join('');
}

// Restock Pitch Modal Handlers
function openRestockModal() {
    const modal = document.getElementById('restockModalOverlay');
    if (modal) {
        modal.classList.add('open');
        document.body.style.overflow = 'hidden';
    }
}

function closeRestockModal() {
    const modal = document.getElementById('restockModalOverlay');
    if (modal) {
        modal.classList.remove('open');
        document.body.style.overflow = '';
    }
}

// Posts to the same real endpoint the Procurement Officer's "Add Request"
// modal uses - creates a genuine `expenses` row with real DOA routing,
// instead of the old behavior of faking a local-only object that vanished
// on refresh (it used to POST to /api/production/restock-pitch, which
// was never a real route).
async function handleRestockPitchSubmit(e) {
    e.preventDefault();

    const itemName = document.getElementById('inputItemName').value.trim();
    const qty = parseFloat(document.getElementById('inputQuantity').value || 1);
    const unitPrice = parseFloat(document.getElementById('inputUnitPrice').value || 0);
    const totalCost = qty * unitPrice;

    if (!itemName || !(totalCost > 0)) {
        alert('Please enter an ingredient name, a quantity and a unit price.');
        return;
    }

    const submitBtn = e.target.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;

    try {
        const res = await employeeFetch('/api/procurement-officer/add-request', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                item_name: qty > 1 ? `${itemName} (${qty}x)` : itemName,
                store_name: '',
                amount: totalCost
            })
        });
        const result = await res.json();
        if (!res.ok || result.status === 'error') throw new Error(result.message || 'Server error');

        closeRestockModal();
        e.target.reset();
        calculateRestockThreshold();
        await fetchProductionDashboardData();

        const route = result.request && result.request.route;
        const routeText = route === 'ceo' ? 'Escalated to the CEO' : (route === 'finance' ? 'Endorsed to Finance' : 'Direct buy authorized');
        alert(`Requisition for "${itemName}" (₱${totalCost.toFixed(2)}) pitched successfully.\nRouting: ${routeText}`);
    } catch (error) {
        alert('Could not save the requisition: ' + error.message);
    } finally {
        if (submitBtn) submitBtn.disabled = false;
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