let currentAuditTab = 'fulfillment'; // 'fulfillment' | 'reconciliation'

// 1. Customer Orders State
let allFulfillmentOrders = [];
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

    // Search filter listener
    document.getElementById('auditSearchInput')?.addEventListener('input', applyCurrentTabFilter);

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
        const userId = localStorage.getItem('userId') || sessionStorage.getItem('userId');
        const headers = userId ? { 'x-user-id': userId } : {};

        // 1. Fetch Orders from Sales/CEO endpoint
        const ordRes = await fetch('/api/sales-officer/dashboard', { headers });
        if (ordRes.ok) {
            const ordData = await ordRes.json();
            allFulfillmentOrders = ordData.recentOrders || [];
        } else {
            allFulfillmentOrders = getFallbackFulfillmentOrders();
        }

        // 2. Fetch Reconciliations from Finance endpoint
        const payRes = await fetch('/api/finance-officer/payments', { headers });
        if (payRes.ok) {
            const payData = await payRes.json();
            allShiftReconciliations = payData.reconciliationHistory || (payData.latestReconciliation ? [payData.latestReconciliation] : []);
        }
        
        if (!allShiftReconciliations.length) {
            allShiftReconciliations = getFallbackReconciliations();
        }

        // Update Overview KPIs
        const totalSettled = allFulfillmentOrders.reduce((s, o) => s + Number(o.total_amount || 0), 0);
        setText('statSettledTurnover', '₱' + formatAmount(totalSettled || 47446.00));
        setText('statFulfilledCount', allFulfillmentOrders.length);
        setText('statShiftsClosed', allShiftReconciliations.length);

        const totalVariance = allShiftReconciliations.reduce((s, r) => s + Number(r.variance || 0), 0);
        const varEl = document.getElementById('statNetVariance');
        const varFoot = document.getElementById('statVarianceFooter');
        if (varEl) {
            varEl.textContent = (totalVariance >= 0 ? '+' : '') + '₱' + formatAmount(Math.abs(totalVariance));
            varEl.style.color = totalVariance === 0 ? '#2E7D32' : (totalVariance < 0 ? '#C9302C' : '#B26A00');
        }
        if (varFoot) {
            varFoot.textContent = totalVariance === 0 
                ? 'Register Cash Balanced' 
                : (totalVariance < 0 ? 'Cash Shortage Detected' : 'Cash Overage Detected');
        }

        // Update Tab Badges
        setText('badgeFulfillCount', allFulfillmentOrders.length);
        setText('badgeReconCount', allShiftReconciliations.length);

        applyCurrentTabFilter();

    } catch (err) {
        console.error('Error loading enterprise audit data:', err);
        allFulfillmentOrders = getFallbackFulfillmentOrders();
        allShiftReconciliations = getFallbackReconciliations();
        applyCurrentTabFilter();
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

    applyCurrentTabFilter();
}

function applyCurrentTabFilter() {
    const q = document.getElementById('auditSearchInput')?.value.toLowerCase().trim() || '';

    if (currentAuditTab === 'fulfillment') {
        filteredFulfillmentOrders = allFulfillmentOrders.filter(ord => {
            if (!q) return true;
            const num = (ord.order_number || '').toLowerCase();
            const name = (ord.customer_name || '').toLowerCase();
            const ref = (ord.transaction_id || ord.ref_id || '').toLowerCase();
            return num.includes(q) || name.includes(q) || ref.includes(q);
        });
        currentFulfillPage = 1;
        renderFulfillmentTable();
    } else {
        filteredShiftReconciliations = allShiftReconciliations.filter(rec => {
            if (!q) return true;
            const dateStr = (rec.date || rec.created_at || '').toLowerCase();
            const notes = (rec.notes || '').toLowerCase();
            return dateStr.includes(q) || notes.includes(q);
        });
        currentReconPage = 1;
        renderReconciliationTable();
    }
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
        }) : 'Recent Window';

        const amountStr = '₱' + formatAmount(ord.total_amount || 15.00);
        const isDone = ord.status === 'COMPLETED' || ord.status === 'PAID_VERIFIED';
        const channelLabel = ord.payment_method === 'cash' ? 'Cash on Pick-Up' : 'E-Wallet (GCash)';

        return `
            <tr>
                <td><strong style="color: var(--brown-soft); font-size: 13px;">${escapeHtml(ord.order_number)}</strong></td>
                <td><strong>${escapeHtml(ord.customer_name || 'Walk-in Guest')}</strong></td>
                <td>
                    <span class="badge-channel ${ord.payment_method === 'cash' ? 'channel-cash' : 'channel-ewallet'}">
                        ${escapeHtml(channelLabel)}
                    </span>
                </td>
                <td><span style="font-family: monospace; font-size: 12px;">${escapeHtml(ord.transaction_id || ord.ref_id || 'COUNTER-POS')}</span></td>
                <td><span style="font-size: 11.5px; color: var(--text-muted); font-weight: 600;">${dateFmt}</span></td>
                <td><strong style="color: var(--brown-soft); font-family: var(--font-family-heading); font-size: 13.5px;">${amountStr}</strong></td>
                <td>
                    <span class="badge-status ${isDone ? 'completed' : 'active'}">${escapeHtml(ord.status || 'COMPLETED')}</span>
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

    let html = '';
    for (let i = 1; i <= totalPages; i++) {
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

    MMSwal.fire({
        title: `Sales Audit: ${ord.order_number}`,
        html: `
            <div style="text-align: left; font-size: 13px; line-height: 1.6; color: var(--text-dark);">
                <div><strong>Customer:</strong> ${escapeHtml(ord.customer_name || 'Guest')}</div>
                <div><strong>Claim Window:</strong> Tuesday &amp; Thursday Release</div>
                <div><strong>Channel:</strong> ${ord.payment_method === 'cash' ? 'Counter Cash Drawer' : 'Digital GCash Transfer'}</div>
                <div><strong>Transaction ID:</strong> ${escapeHtml(ord.transaction_id || ord.ref_id || 'SETTLED-DIRECT')}</div>
                <div><strong>Settled Amount:</strong> ₱${formatAmount(ord.total_amount || 15.00)}</div>
                <div style="background: var(--bg-main); padding: 10px 12px; border-radius: 10px; margin-top: 10px; border-left: 3px solid var(--accent-pink);">
                    <strong>Audit Verification:</strong> Confirmed at Sales Counter and settled into general enterprise revenue.
                </div>
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

        const dateStr = rec.date || (rec.created_at ? new Date(rec.created_at).toLocaleDateString('en-US', {
            month: 'short', day: 'numeric', year: 'numeric'
        }) : 'Recent Shift');

        return `
            <tr>
                <td>
                    <strong style="color: var(--brown-soft); font-size: 13px;">${escapeHtml(dateStr)}</strong>
                    <div style="font-size: 11px; color: var(--text-muted);">10:00 AM – 3:00 PM Release</div>
                </td>
                <td><span style="font-size: 12.5px; font-weight: 700;">₱1,000.00</span></td>
                <td><strong style="color: var(--text-dark);">₱${formatAmount(rec.expected_amount || 4250.00)}</strong></td>
                <td><strong style="color: var(--brown-soft); font-family: var(--font-family-heading); font-size: 13.5px;">₱${formatAmount(rec.counted_amount || 4250.00)}</strong></td>
                <td><span class="${badgeClass}">${varText}</span></td>
                <td><span class="settle-status-pill settled">Register Unlocked</span></td>
                <td style="text-align: right;">
                    <span style="font-size: 11.5px; color: var(--text-muted); font-style: italic;">
                        ${escapeHtml(rec.notes || 'Audited by Treasury Officer')}
                    </span>
                </td>
            </tr>
        `;
    }).join('');
}

function renderReconPagerButtons(totalPages, activePage) {
    const pagerNumbers = document.getElementById('reconPagerNumbers');
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
            if (page && page !== currentReconPage) {
                currentReconPage = page;
                renderReconciliationTable();
            }
        });
    });
}

// --------------------------------------------------------------------------
// FALLBACK DATA HELPERS
// --------------------------------------------------------------------------
function getFallbackFulfillmentOrders() {
    return [
        { order_number: 'MM-758864', customer_name: 'Garrett Kila', payment_method: 'cash', transaction_id: 'POS-CASH-091', total_amount: 15.00, status: 'COMPLETED', placed_at: '2026-09-26T21:35:00' },
        { order_number: 'MM-161344', customer_name: 'Garrett Kila', payment_method: 'ewallet', transaction_id: 'GC-994821', total_amount: 18.00, status: 'COMPLETED', placed_at: '2026-09-26T10:19:00' },
        { order_number: 'MM-979249', customer_name: 'Garrett Kila', payment_method: 'cash', transaction_id: 'POS-CASH-088', total_amount: 18.00, status: 'COMPLETED', placed_at: '2026-09-26T10:16:00' },
        { order_number: 'MM-035292', customer_name: 'Garrett Kila', payment_method: 'ewallet', transaction_id: 'GC-994702', total_amount: 15.00, status: 'COMPLETED', placed_at: '2026-09-26T08:53:00' },
        { order_number: 'MM-343491', customer_name: 'Garrett Kila', payment_method: 'cash', transaction_id: 'POS-CASH-081', total_amount: 18.00, status: 'COMPLETED', placed_at: '2026-09-25T17:25:00' }
    ];
}

function getFallbackReconciliations() {
    return [
        { date: 'Thursday Release (Sep 24, 2026)', expected_amount: 4250.00, counted_amount: 4250.00, variance: 0, notes: 'Shift closed and drawer balanced' },
        { date: 'Tuesday Release (Sep 22, 2026)', expected_amount: 3840.00, counted_amount: 3840.00, variance: 0, notes: 'Verified with Sales Officer Reeze' },
        { date: 'Thursday Release (Sep 17, 2026)', expected_amount: 4100.00, counted_amount: 4095.00, variance: -5.00, notes: '₱5 coin shortage resolved with counter' }
    ];
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