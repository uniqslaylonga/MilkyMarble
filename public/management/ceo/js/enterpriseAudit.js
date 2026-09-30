let currentAuditTab = 'fulfillment'; // 'fulfillment' | 'reconciliation'

// 1. Customer Orders State
let allFulfillmentOrders = [];
let auditTotals = { settledTurnover: 0, orderCount: 0 };
let filteredFulfillmentOrders = [];
let currentFulfillPage = 1;
const FULFILL_PAGE_SIZE = 5;

// 2. Shift Reconciliations State
let allShiftReconciliations = [];
let filteredShiftReconciliations = [];
let currentReconPage = 1;
const RECON_PAGE_SIZE = 5;

// Global SweetAlert2 Config matching Master SOP Section 2.E
const MMSwal = Swal.mixin({
    customClass: {
        popup: 'mm-swal-popup',
        title: 'mm-swal-title',
        confirmButton: 'mm-swal-confirm',
        cancelButton: 'mm-swal-cancel'
    },
    buttonsStyling: false
});

document.addEventListener('DOMContentLoaded', () => {
    fetchEnterpriseAuditData();

    // Search filter listeners (one per table now)
    document.getElementById('fulfillSearchInput')?.addEventListener('input', applyFulfillmentFilter);
    document.getElementById('reconSearchInput')?.addEventListener('input', applyReconciliationFilter);

    // Fulfillment Pagination button listeners
    document.getElementById('prevFulfillBtn')?.addEventListener('click', () => {
        if (currentFulfillPage > 1) {
            currentFulfillPage--;
            renderFulfillmentTable();
        }
    });

    document.getElementById('nextFulfillBtn')?.addEventListener('click', () => {
        const totalPages = Math.ceil(filteredFulfillmentOrders.length / FULFILL_PAGE_SIZE) || 1;
        if (currentFulfillPage < totalPages) {
            currentFulfillPage++;
            renderFulfillmentTable();
        }
    });

    // Reconciliation Pagination button listeners
    document.getElementById('prevReconBtn')?.addEventListener('click', () => {
        if (currentReconPage > 1) {
            currentReconPage--;
            renderReconciliationTable();
        }
    });

    document.getElementById('nextReconBtn')?.addEventListener('click', () => {
        const totalPages = Math.ceil(filteredShiftReconciliations.length / RECON_PAGE_SIZE) || 1;
        if (currentReconPage < totalPages) {
            currentReconPage++;
            renderReconciliationTable();
        }
    });
});

async function fetchEnterpriseAuditData() {
    try {
        const response = await fetch('/api/ceo/enterprise-audit');
        if (!response.ok) throw new Error('Failed to load enterprise audit data');
        const data = await response.json();

        setText('userFullNameDisplay', data.user?.fullName || '—');
        const avatarEl = document.getElementById('userAvatarImg');
        if (avatarEl && data.user?.avatarSrc) avatarEl.src = data.user.avatarSrc;

        allFulfillmentOrders = data.orders || [];
        allShiftReconciliations = data.reconciliations || [];
        auditTotals = data.totals || { settledTurnover: 0, orderCount: allFulfillmentOrders.length };

        // Overview KPIs (all real, computed server-side over every realized order)
        setText('statSettledTurnover', '₱' + formatAmount(auditTotals.settledTurnover));
        setText('statFulfilledCount', Number(auditTotals.orderCount || 0).toLocaleString());
        setText('statShiftsClosed', allShiftReconciliations.length);

        const totalVariance = allShiftReconciliations.reduce((s, r) => s + Number(r.variance || 0), 0);
        const varEl = document.getElementById('statNetVariance');
        const varFoot = document.getElementById('statVarianceFooter');
        if (varEl) {
            const sign = totalVariance > 0 ? '+' : (totalVariance < 0 ? '-' : '');
            varEl.textContent = sign + '₱' + formatAmount(Math.abs(totalVariance));
            varEl.style.color = totalVariance === 0 ? '#2E7D32' : (totalVariance < 0 ? '#C9302C' : '#B26A00');
        }
        if (varFoot) {
            varFoot.textContent = !allShiftReconciliations.length
                ? 'No shifts reconciled yet'
                : (totalVariance === 0 ? 'Register Cash Balanced' : (totalVariance < 0 ? 'Cash Shortage Detected' : 'Cash Overage Detected'));
        }

        // Tab badges
        setText('badgeFulfillCount', Number(auditTotals.orderCount || 0).toLocaleString());
        setText('badgeReconCount', allShiftReconciliations.length);

        setText('auditSyncText', 'Live from database • ' + new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }));
        applyFulfillmentFilter();
        applyReconciliationFilter();

    } catch (err) {
        // No made-up fallback rows: say plainly that the data could not be loaded.
        console.error('Error loading enterprise audit data:', err);
        setText('auditSyncText', 'Data unavailable');
        setText('statVarianceFooter', '—');
        allFulfillmentOrders = [];
        allShiftReconciliations = [];
        applyFulfillmentFilter();
        applyReconciliationFilter();
        const msg = '<tr><td colspan="8" class="loading-state-text" style="color:#C9302C;">Could not load audit records from the database.</td></tr>';
        const f = document.getElementById('fulfillmentTableBody'); if (f) f.innerHTML = msg;
        const r = document.getElementById('reconciliationTableBody'); if (r) r.innerHTML = msg.replace('colspan="8"', 'colspan="7"');
        MMSwal.fire({ icon: 'warning', title: 'System Notice', text: err.message || 'Could not load enterprise audit data.' });
    }
}

// --------------------------------------------------------------------------
// TAB SWITCHER
// --------------------------------------------------------------------------
function switchAuditTab(tab) {
    currentAuditTab = tab;
    const btnFulfill = document.getElementById('tabBtnFulfillment');
    const btnRecon = document.getElementById('tabBtnReconciliation');
    const viewFulfill = document.getElementById('fulfillmentViewArea');
    const viewRecon = document.getElementById('reconciliationViewArea');

    if (tab === 'fulfillment') {
        btnFulfill?.classList.add('active');
        btnRecon?.classList.remove('active');
        if (viewFulfill) viewFulfill.style.display = 'block';
        if (viewRecon) viewRecon.style.display = 'none';
    } else {
        btnRecon?.classList.add('active');
        btnFulfill?.classList.remove('active');
        if (viewFulfill) viewFulfill.style.display = 'none';
        if (viewRecon) viewRecon.style.display = 'block';
    }
}

function applyFulfillmentFilter() {
    const q = document.getElementById('fulfillSearchInput')?.value.toLowerCase().trim() || '';

    filteredFulfillmentOrders = allFulfillmentOrders.filter(ord => {
        if (!q) return true;
        const num = (ord.order_number || '').toLowerCase();
        const name = (ord.customer_name || '').toLowerCase();
        const ref = (ord.transaction_id || ord.ref_id || '').toLowerCase();
        return num.includes(q) || name.includes(q) || ref.includes(q);
    });
    currentFulfillPage = 1;
    renderFulfillmentTable();
}

function applyReconciliationFilter() {
    const q = document.getElementById('reconSearchInput')?.value.toLowerCase().trim() || '';

    filteredShiftReconciliations = allShiftReconciliations.filter(rec => {
        if (!q) return true;
        const dateStr = formatShiftDate(rec).toLowerCase();
        const notes = (rec.notes || '').toLowerCase();
        const who = (rec.recorded_by_name || '').toLowerCase();
        return dateStr.includes(q) || notes.includes(q) || who.includes(q);
    });
    currentReconPage = 1;
    renderReconciliationTable();
}

// --------------------------------------------------------------------------
// 1. RENDER CUSTOMER FULFILLMENT & SALES AUDIT
// --------------------------------------------------------------------------
function renderFulfillmentTable() {
    const tbody = document.getElementById('fulfillmentTableBody');
    const pageInfo = document.getElementById('fulfillPageInfo');
    const prevBtn = document.getElementById('prevFulfillBtn');
    const nextBtn = document.getElementById('nextFulfillBtn');

    if (!tbody) return;

    if (filteredFulfillmentOrders.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="loading-state-text">No realized customer orders match your search criteria.</td></tr>';
        if (pageInfo) pageInfo.textContent = 'Showing 0 of 0 orders';
        if (prevBtn) prevBtn.disabled = true;
        if (nextBtn) nextBtn.disabled = true;
        renderFulfillPagerButtons(1, 1);
        return;
    }

    const totalPages = Math.ceil(filteredFulfillmentOrders.length / FULFILL_PAGE_SIZE) || 1;
    const startIndex = (currentFulfillPage - 1) * FULFILL_PAGE_SIZE;
    const pageItems = filteredFulfillmentOrders.slice(startIndex, startIndex + FULFILL_PAGE_SIZE);

    if (pageInfo) {
        const startNum = startIndex + 1;
        const endNum = Math.min(startIndex + FULFILL_PAGE_SIZE, filteredFulfillmentOrders.length);
        pageInfo.textContent = `Showing ${startNum}-${endNum} of ${filteredFulfillmentOrders.length} orders`;
    }
    if (prevBtn) prevBtn.disabled = currentFulfillPage <= 1;
    if (nextBtn) nextBtn.disabled = currentFulfillPage >= totalPages;

    renderFulfillPagerButtons(totalPages, currentFulfillPage);

    tbody.innerHTML = pageItems.map(ord => {
        const dateFmt = ord.placed_at ? new Date(ord.placed_at).toLocaleDateString('en-US', {
            month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit'
        }) : '—';

        const amountStr = '₱' + formatAmount(ord.total_amount);
        const isDone = ord.status === 'COMPLETED' || ord.status === 'PAID_VERIFIED';
        const isCash = String(ord.payment_method || '').toLowerCase().includes('cash');
        const channelLabel = ord.payment_method || '—';

        return `
            <tr>
                <td><strong style="color: var(--brown-soft); font-size: 13px;">${escapeHtml(ord.order_number)}</strong></td>
                <td><strong>${escapeHtml(ord.customer_name || '—')}</strong></td>
                <td>
                    <span class="badge-channel ${isCash ? 'channel-cash' : 'channel-ewallet'}">
                        ${escapeHtml(channelLabel)}
                    </span>
                </td>
                <td><span style="font-family: monospace; font-size: 12px;">${escapeHtml(ord.transaction_id || '—')}</span></td>
                <td><span style="font-size: 11.5px; color: var(--text-muted); font-weight: 600;">${dateFmt}</span></td>
                <td><strong style="color: var(--brown-soft); font-family: var(--font-family-heading); font-size: 13.5px;">${amountStr}</strong></td>
                <td>
                    <span class="badge-status ${isDone ? 'completed' : 'active'}">${escapeHtml(ord.status || '—')}</span>
                </td>
                <td style="text-align: right;">
                    <button type="button" class="btn-inspect-audit" onclick="inspectOrderAudit('${escapeHtml(ord.order_number)}')">
                        Audit Receipt
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

function renderFulfillPagerButtons(totalPages, activePage) {
    const pagerNumbers = document.getElementById('fulfillPagerNumbers');
    if (!pagerNumbers) return;

    const GROUP_SIZE = 5;
    const groupStart = Math.floor((activePage - 1) / GROUP_SIZE) * GROUP_SIZE + 1;
    const groupEnd = Math.min(groupStart + GROUP_SIZE - 1, totalPages);

    let html = '';
    for (let i = groupStart; i <= groupEnd; i++) {
        const isActive = i === activePage ? 'active' : '';
        html += `<button type="button" class="pager-num-btn ${isActive}" data-page="${i}">${i}</button>`;
    }
    pagerNumbers.innerHTML = html;

    pagerNumbers.querySelectorAll('.pager-num-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const page = parseInt(e.currentTarget.getAttribute('data-page'), 10);
            if (page && page !== currentFulfillPage) {
                currentFulfillPage = page;
                renderFulfillmentTable();
            }
        });
    });
}

function inspectOrderAudit(orderNum) {
    const ord = allFulfillmentOrders.find(o => o.order_number === orderNum);
    if (!ord) return;

    const placed = ord.placed_at ? new Date(ord.placed_at).toLocaleString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit'
    }) : '—';

    MMSwal.fire({
        title: `Sales Audit: ${ord.order_number}`,
        html: `
            <div style="text-align: left; font-size: 13px; line-height: 1.6; color: var(--text-dark);">
                <div><strong>Customer:</strong> ${escapeHtml(ord.customer_name || '—')}</div>
                <div><strong>Payment Method:</strong> ${escapeHtml(ord.payment_method || '—')}</div>
                <div><strong>Transaction ID:</strong> ${escapeHtml(ord.transaction_id || '—')}</div>
                <div><strong>Placed:</strong> ${escapeHtml(placed)}</div>
                <div><strong>Status:</strong> ${escapeHtml(ord.status || '—')}</div>
                <div><strong>Settled Amount:</strong> ₱${formatAmount(ord.total_amount)}</div>
            </div>
        `,
        confirmButtonText: 'Close Audit'
    });
}

// --------------------------------------------------------------------------
// 2. RENDER CASHIER DRAWER BALANCING & SHIFT AUDITS
// --------------------------------------------------------------------------
function renderReconciliationTable() {
    const tbody = document.getElementById('reconciliationTableBody');
    const pageInfo = document.getElementById('reconPageInfo');
    const prevBtn = document.getElementById('prevReconBtn');
    const nextBtn = document.getElementById('nextReconBtn');

    if (!tbody) return;

    if (filteredShiftReconciliations.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="loading-state-text">No closed shift reconciliation records found.</td></tr>';
        if (pageInfo) pageInfo.textContent = 'Showing 0 of 0 shift audits';
        if (prevBtn) prevBtn.disabled = true;
        if (nextBtn) nextBtn.disabled = true;
        renderReconPagerButtons(1, 1);
        return;
    }

    const totalPages = Math.ceil(filteredShiftReconciliations.length / RECON_PAGE_SIZE) || 1;
    const startIndex = (currentReconPage - 1) * RECON_PAGE_SIZE;
    const pageItems = filteredShiftReconciliations.slice(startIndex, startIndex + RECON_PAGE_SIZE);

    if (pageInfo) {
        const startNum = startIndex + 1;
        const endNum = Math.min(startIndex + RECON_PAGE_SIZE, filteredShiftReconciliations.length);
        pageInfo.textContent = `Showing ${startNum}-${endNum} of ${filteredShiftReconciliations.length} shift audits`;
    }
    if (prevBtn) prevBtn.disabled = currentReconPage <= 1;
    if (nextBtn) nextBtn.disabled = currentReconPage >= totalPages;

    renderReconPagerButtons(totalPages, currentReconPage);

    const money = (v) => (v === null || v === undefined) ? '—' : '₱' + formatAmount(v);

    tbody.innerHTML = pageItems.map(rec => {
        const variance = Number(rec.variance || 0);
        let badgeClass = 'badge-variance zero';
        let varText = '₱0.00 (Balanced)';
        if (variance < 0) {
            badgeClass = 'badge-variance shortage';
            varText = `-₱${formatAmount(Math.abs(variance))} (Shortage)`;
        } else if (variance > 0) {
            badgeClass = 'badge-variance overage';
            varText = `+₱${formatAmount(variance)} (Overage)`;
        }

        return `
            <tr>
                <td>
                    <strong style="color: var(--brown-soft); font-size: 13px;">${escapeHtml(formatShiftDate(rec))}</strong>
                    <div style="font-size: 11px; color: var(--text-muted);">${escapeHtml(formatShiftWindow(rec))}</div>
                </td>
                <td><span style="font-size: 12.5px; font-weight: 700;">${money(rec.opening_float)}</span></td>
                <td><strong style="color: var(--text-dark);">${money(rec.expected_amount)}</strong></td>
                <td><strong style="color: var(--brown-soft); font-family: var(--font-family-heading); font-size: 13.5px;">${money(rec.counted_amount)}</strong></td>
                <td><span class="${badgeClass}">${varText}</span></td>
                <td><span style="font-size: 12px; font-weight: 700;">${escapeHtml(rec.recorded_by_name || '—')}</span></td>
                <td style="text-align: right;">
                    <span style="font-size: 11.5px; color: var(--text-muted); font-style: italic;">
                        ${escapeHtml(rec.notes || '—')}
                    </span>
                </td>
            </tr>
        `;
    }).join('');
}

function formatShiftDate(rec) {
    const d = rec.period_end || rec.created_at;
    return d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
}

function formatShiftWindow(rec) {
    const t = (v) => new Date(v).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    if (rec.period_start && rec.period_end && !isNaN(new Date(rec.period_start)) && !isNaN(new Date(rec.period_end))) {
        return `${t(rec.period_start)} – ${t(rec.period_end)}`;
    }
    return '';
}

function renderReconPagerButtons(totalPages, activePage) {
    const pagerNumbers = document.getElementById('reconPagerNumbers');
    if (!pagerNumbers) return;

    const GROUP_SIZE = 5;
    const groupStart = Math.floor((activePage - 1) / GROUP_SIZE) * GROUP_SIZE + 1;
    const groupEnd = Math.min(groupStart + GROUP_SIZE - 1, totalPages);

    let html = '';
    for (let i = groupStart; i <= groupEnd; i++) {
        const isActive = i === activePage ? 'active' : '';
        html += `<button type="button" class="pager-num-btn ${isActive}" data-page="${i}">${i}</button>`;
    }
    pagerNumbers.innerHTML = html;

    pagerNumbers.querySelectorAll('.pager-num-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const page = parseInt(e.currentTarget.getAttribute('data-page'), 10);
            if (page && page !== currentReconPage) {
                currentReconPage = page;
                renderReconciliationTable();
            }
        });
    });
}

function formatAmount(val) {
    return Number(val || 0).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
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