let allMovementLogs = [];
let filteredMovementLogs = [];
let allLowStockAlerts = [];
let currentMovPage = 1;
const MOV_PAGE_SIZE = 5;

// POST JSON to the employee API (sends the x-user-id header via employeeFetch).
async function apiPost(url, body) {
    const opts = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    };
    const res = (typeof employeeFetch === 'function') ? await employeeFetch(url, opts) : await fetch(url, opts);
    let data = {};
    try { data = await res.json(); } catch (e) { /* not JSON */ }
    if (!res.ok || data.status === 'error') {
        throw new Error(data.message || ('Server responded with status ' + res.status));
    }
    return data;
}

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

document.addEventListener('DOMContentLoaded', () => {
    fetchStockControlData();

    // Search and Date Filter Listeners
    document.getElementById('stockSearchInput')?.addEventListener('input', applyMovementFilters);
    document.getElementById('dateFilter')?.addEventListener('change', applyMovementFilters);

    // Pagination buttons
    document.getElementById('prevMovBtn')?.addEventListener('click', () => {
        if (currentMovPage > 1) {
            currentMovPage--;
            renderMovementLogs();
        }
    });

    document.getElementById('nextMovBtn')?.addEventListener('click', () => {
        const totalPages = Math.ceil(filteredMovementLogs.length / MOV_PAGE_SIZE) || 1;
        if (currentMovPage < totalPages) {
            currentMovPage++;
            renderMovementLogs();
        }
    });
});

async function fetchStockControlData() {
    try {
        let response;
        if (typeof employeeFetch === 'function') {
            response = await employeeFetch('/api/procurement-officer/stock-control');
        } else {
            const userId = localStorage.getItem('userId') || sessionStorage.getItem('userId');
            const headers = userId ? { 'x-user-id': userId } : {};
            response = await fetch('/api/procurement-officer/stock-control', { headers });
        }

        if (!response.ok) throw new Error(await EmployeeUI.errorMessage(response));

        const data = await response.json();

        // User Profile
        setText('userFullName', (data.user && data.user.fullName) || '');

        // KPI cards - straight from the server; nothing is filled in if it is missing
        const m = data.metrics || {};
        const pad2 = n => String(Number(n) || 0).padStart(2, '0');
        setText('directBuyCount', pad2(m.directBuyCount));
        setText('escalatedCount', pad2(m.escalatedCount));
        setText('itemsMonitored', pad2(m.itemsMonitored));
        setText('reservedStocks', (m.reservedStocks === null || m.reservedStocks === undefined) ? '—' : Number(m.reservedStocks).toLocaleString());

        allMovementLogs = data.movementLogs || [];
        allLowStockAlerts = data.lowStockItems || [];

        applyMovementFilters();
        renderLowStockAlerts(allLowStockAlerts);

    } catch (error) {
        console.error('Could not load live data from the server:', error);
        if (window.EmployeeUI) { EmployeeUI.showError(error); EmployeeUI.failTables(); }
    }
}

// Unified Movement Filter
function applyMovementFilters() {
    const q = document.getElementById('stockSearchInput')?.value.toLowerCase().trim() || '';
    const dateFilter = document.getElementById('dateFilter')?.value || 'all';

    filteredMovementLogs = allMovementLogs.filter(log => {
        if (dateFilter !== 'all' && log.dateGroup !== dateFilter) return false;
        if (q) {
            const name = (log.item_name || '').toLowerCase();
            const staff = (log.employee_name || '').toLowerCase();
            const time = (log.displayTime || '').toLowerCase();
            if (!name.includes(q) && !staff.includes(q) && !time.includes(q)) return false;
        }
        return true;
    });

    document.getElementById('movementCount').textContent = filteredMovementLogs.length;
    currentMovPage = 1;
    renderMovementLogs();
}

// Render Movements with Permanent Numbered Pager
function renderMovementLogs() {
    const container = document.getElementById('movementList');
    const pageInfo = document.getElementById('movPageInfo');
    const prevBtn = document.getElementById('prevMovBtn');
    const nextBtn = document.getElementById('nextMovBtn');

    if (!container) return;

    if (filteredMovementLogs.length === 0) {
        container.innerHTML = '<div class="loading-state-text">No stock movement activity found for this filter.</div>';
        if (pageInfo) pageInfo.textContent = 'Showing 0 of 0 logs';
        if (prevBtn) prevBtn.disabled = true;
        if (nextBtn) nextBtn.disabled = true;
        renderMovPagerButtons(1, 1);
        return;
    }

    const totalPages = Math.ceil(filteredMovementLogs.length / MOV_PAGE_SIZE) || 1;
    const startIndex = (currentMovPage - 1) * MOV_PAGE_SIZE;
    const pageItems = filteredMovementLogs.slice(startIndex, startIndex + MOV_PAGE_SIZE);

    if (pageInfo) {
        const startNum = startIndex + 1;
        const endNum = Math.min(startIndex + MOV_PAGE_SIZE, filteredMovementLogs.length);
        pageInfo.textContent = `Showing ${startNum}-${endNum} of ${filteredMovementLogs.length} logs`;
    }
    if (prevBtn) prevBtn.disabled = currentMovPage <= 1;
    if (nextBtn) nextBtn.disabled = currentMovPage >= totalPages;

    renderMovPagerButtons(totalPages, currentMovPage);

    container.innerHTML = pageItems.map(log => {
        const type = log.change_type || 'ADJUST';
        const qty = parseFloat(log.quantity_changed || 0);
        const unit = log.unit ? ' ' + log.unit : '';

        let iconClass = 'fa-sliders';
        let boxClass = 'box-adjust';
        let changeSign = `±${qty}${unit}`;
        let changeClass = 'adj';

        if (type === 'ADD') {
            iconClass = 'fa-plus';
            boxClass = 'box-plus';
            changeSign = `+${qty}${unit}`;
            changeClass = 'pos';
        } else if (type === 'DEDUCT') {
            iconClass = 'fa-minus';
            boxClass = 'box-minus';
            changeSign = `-${qty}${unit}`;
            changeClass = 'neg';
        }

        return `
            <div class="movement-item">
                <div class="mov-leading">
                    <div class="mov-icon-box ${boxClass}">
                        <i class="fa-solid ${iconClass}"></i>
                    </div>
                    <div>
                        <div class="mov-name">${escapeHtml(log.item_name)}</div>
                        <div class="mov-code">${escapeHtml(log.employee_name) || '—'}</div>
                    </div>
                </div>

                <div class="mov-change ${changeClass}">
                    ${changeSign}
                </div>

                <div class="mov-user">
                    <div>
                        <div class="time-stamp">${escapeHtml(log.displayTime)}</div>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// Movements Numbered Pager
function renderMovPagerButtons(totalPages, activePage) {
    const pagerNumbers = document.getElementById('movPagerNumbers');
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
            if (page && page !== currentMovPage) {
                currentMovPage = page;
                renderMovementLogs();
            }
        });
    });
}

// Render Low Stock Alerts with DOA Routing
function renderLowStockAlerts(alerts) {
    const container = document.getElementById('alertsList');
    const alertsBadge = document.getElementById('alertsCountBadge');
    if (!container) return;

    if (!alerts || alerts.length === 0) {
        container.innerHTML = '<div class="loading-state-text">All items are sufficiently stocked above reorder points!</div>';
        if (alertsBadge) alertsBadge.textContent = '0 items';
        return;
    }

    if (alertsBadge) alertsBadge.textContent = `${alerts.length} Breaches`;

    container.innerHTML = alerts.map(alert => {
        const reorderLevel = parseFloat(alert.reorder_level) || 1;
        const onHand = parseFloat(alert.on_hand || 0);
        const percent = Math.min(100, Math.round((onHand / reorderLevel) * 100));
        const type = String(alert.item_type || '').toLowerCase();
        const categoryLabel = type === 'packaging' ? 'Packaging' : (type === 'equipment' ? 'Equipment' : 'Ingredients');
        const unit = alert.unit ? ' ' + alert.unit : '';

        return `
            <div class="alert-card">
                <div class="alert-top">
                    <div>
                        <div class="alert-item-name">${escapeHtml(alert.name)}</div>
                        <div class="alert-item-meta">
                            ${categoryLabel} — <span class="highlight-low">${onHand}${escapeHtml(unit)} on hand</span> (reorder at ${reorderLevel})
                        </div>
                    </div>

                    <div class="alert-actions">
                        <button type="button" class="btn-handle-restock" onclick="quickHandleAlert(${Number(alert.id)})">
                            Pitch Reorder
                        </button>
                    </div>
                </div>

                <div class="alert-progress-track">
                    <div class="alert-progress-fill" style="width: ${percent}%;"></div>
                </div>
            </div>
        `;
    }).join('');
}

// Pitch a reorder: creates a real purchase request. There is no stored unit
// price, so the officer enters the estimated total and DOA routing follows it.
async function quickHandleAlert(itemId) {
    const alertItem = allLowStockAlerts.find(a => a.id === itemId);
    if (!alertItem) return;

    const input = prompt(`Estimated total cost (₱) to reorder "${alertItem.name}":`);
    if (input === null) return;
    const amount = parseFloat(input);
    if (!(amount > 0)) {
        alert('Please enter a valid amount greater than 0.');
        return;
    }

    try {
        const result = await apiPost('/api/procurement-officer/add-request', {
            item_name: `Restock: ${alertItem.name}`,
            store_name: '',
            amount
        });
        const route = result.request && result.request.route;
        const routeText = route === 'ceo' ? 'Escalated to the CEO' : (route === 'finance' ? 'Endorsed to Finance' : 'Direct buy authorized');
        alert(`Requisition for "${alertItem.name}" (₱${amount.toFixed(2)}) saved.\nRouting: ${routeText}`);
        window.location.href = 'procurement.html';
    } catch (error) {
        alert('Could not save the requisition: ' + error.message);
    }
}

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}