let allMovementLogs = [];
let filteredMovementLogs = [];
let allLowStockAlerts = [];
let currentMovPage = 1;
const MOV_PAGE_SIZE = 5;

// Global SweetAlert2 Configuration matching Master SOP Section 2.E
const MMSwal = Swal.mixin({
    customClass: {
        popup: 'mm-swal-popup',
        title: 'mm-swal-title',
        confirmButton: 'mm-swal-confirm',
        cancelButton: 'mm-swal-cancel'
    },
    buttonsStyling: false
});

// POST JSON to the employee API with user header forwarding
async function apiPost(url, body) {
    const userId = localStorage.getItem('userId') || sessionStorage.getItem('userId');
    const headers = { 'Content-Type': 'application/json' };
    if (userId) headers['x-user-id'] = userId;

    const opts = {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
    };
    const res = (typeof employeeFetch === 'function') ? await employeeFetch(url, opts) : await fetch(url, opts);
    let data = {};
    try { data = await res.json(); } catch (e) {}
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

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.message || 'Server error ' + response.status);
        }

        const data = await response.json();

        // User Profile
        setText('userFullName', (data.user && data.user.fullName) || 'Inventory Officer');
        const userAvatarEl = document.getElementById('userAvatar');
        if (userAvatarEl && data.user?.avatarSrc) userAvatarEl.src = data.user.avatarSrc;

        // KPI cards
        const m = data.metrics || {};
        const pad2 = n => String(Number(n) || 0).padStart(2, '0');
        setText('directBuyCount', pad2(m.directBuyCount));
        setText('escalatedCount', pad2(m.escalatedCount));
        setText('itemsMonitored', pad2(m.itemsMonitored));

        allMovementLogs = data.movementLogs || [];
        allLowStockAlerts = data.lowStockItems || [];

        // Punto 2: Update Card 4 with actual Critical Breaches count
        setText('criticalBreachesCount', pad2(allLowStockAlerts.length));

        applyMovementFilters();
        renderLowStockAlerts(allLowStockAlerts);

    } catch (error) {
        console.error('Could not load stock control data from server:', error);
        MMSwal.fire({
            icon: 'warning',
            title: 'System Notice',
            text: error.message || 'Failed to retrieve stock control logs.'
        });
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

// Render Movements with Pure Inline SVGs (No Font Awesome)
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

        let boxClass = 'box-adjust';
        let changeSign = `±${qty}${unit}`;
        let changeClass = 'adj';
        let svgIconHtml = `
            <svg class="mov-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <line x1="4" y1="21" x2="4" y2="14"></line>
                <line x1="4" y1="10" x2="4" y2="3"></line>
                <line x1="12" y1="21" x2="12" y2="12"></line>
                <line x1="12" y1="8" x2="12" y2="3"></line>
                <line x1="20" y1="21" x2="20" y2="16"></line>
                <line x1="20" y1="12" x2="20" y2="3"></line>
                <line x1="1" y1="14" x2="7" y2="14"></line>
                <line x1="9" y1="8" x2="15" y2="8"></line>
                <line x1="17" y1="16" x2="23" y2="16"></line>
            </svg>
        `;

        if (type === 'ADD') {
            boxClass = 'box-plus';
            changeSign = `+${qty}${unit}`;
            changeClass = 'pos';
            svgIconHtml = `
                <svg class="mov-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                    <line x1="12" y1="5" x2="12" y2="19"></line>
                    <line x1="5" y1="12" x2="19" y2="12"></line>
                </svg>
            `;
        } else if (type === 'DEDUCT') {
            boxClass = 'box-minus';
            changeSign = `-${qty}${unit}`;
            changeClass = 'neg';
            svgIconHtml = `
                <svg class="mov-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                    <line x1="5" y1="12" x2="19" y2="12"></line>
                </svg>
            `;
        }

        return `
            <div class="movement-item">
                <div class="mov-leading">
                    <div class="mov-icon-box ${boxClass}">
                        ${svgIconHtml}
                    </div>
                    <div>
                        <div class="mov-name">${escapeHtml(log.item_name)}</div>
                        <div class="mov-code">${escapeHtml(log.employee_name) || 'Staff'}</div>
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

// Render Low Stock Alerts
function renderLowStockAlerts(alerts) {
    const container = document.getElementById('alertsList');
    const alertsBadge = document.getElementById('alertsCountBadge');
    if (!container) return;

    if (!alerts || alerts.length === 0) {
        container.innerHTML = '<div class="loading-state-text">All materials and packaging are adequately stocked above safety points.</div>';
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

// Quick Reorder Trigger using themed SweetAlert2 Dialog
async function quickHandleAlert(itemId) {
    const alertItem = allLowStockAlerts.find(a => a.id === itemId);
    if (!alertItem) return;

    const { value: amountStr } = await MMSwal.fire({
        title: `Pitch Reorder: ${alertItem.name}`,
        input: 'number',
        inputLabel: 'Estimated Total Requisition Amount (₱)',
        inputPlaceholder: 'Enter total estimated cost...',
        showCancelButton: true,
        confirmButtonText: 'Submit Requisition',
        cancelButtonText: 'Cancel',
        inputValidator: (val) => {
            if (!val || parseFloat(val) <= 0) {
                return 'Please enter a valid amount greater than 0.';
            }
        }
    });

    if (!amountStr) return;
    const amount = parseFloat(amountStr);

    try {
        const result = await apiPost('/api/procurement-officer/add-request', {
            item_name: `Restock: ${alertItem.name}`,
            store_name: '',
            amount
        });

        const route = result.request && result.request.route;
        let routeText = 'Direct purchase authorized for Procurement';
        if (route === 'finance') routeText = 'Escalated to Finance Officer';
        if (route === 'ceo') routeText = 'Escalated to the CEO';

        await MMSwal.fire({
            icon: 'success',
            title: 'Requisition Created',
            text: `Requisition for "${alertItem.name}" (₱${amount.toFixed(2)}) submitted.\n\nRouting: ${routeText}`
        });

        window.location.href = 'procurement.html';

    } catch (error) {
        MMSwal.fire({
            icon: 'warning',
            title: 'Requisition Failed',
            text: error.message || 'Could not submit requisition.'
        });
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