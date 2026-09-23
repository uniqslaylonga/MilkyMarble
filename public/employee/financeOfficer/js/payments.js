let allPaymentsData = [];
let filteredPaymentsData = [];
let currentPaymentChannel = 'all';
let currentPaymentPage = 1;
let latestReconciliation = null;
const PAYMENTS_PAGE_SIZE = 5;

document.addEventListener('DOMContentLoaded', () => {
    fetchPaymentsData();

    // Search filter listener
    document.getElementById('paymentsSearchInput')?.addEventListener('input', applyPaymentsFilter);

    // Form submission
    document.getElementById('paymentForm')?.addEventListener('submit', handleAddPaymentRecord);
    document.getElementById('drawerCountForm')?.addEventListener('submit', handleDrawerCount);

    // Pagination buttons
    document.getElementById('prevPayBtn')?.addEventListener('click', () => {
        if (currentPaymentPage > 1) {
            currentPaymentPage--;
            renderPaymentsTable();
        }
    });

    document.getElementById('nextPayBtn')?.addEventListener('click', () => {
        const totalPages = Math.ceil(filteredPaymentsData.length / PAYMENTS_PAGE_SIZE) || 1;
        if (currentPaymentPage < totalPages) {
            currentPaymentPage++;
            renderPaymentsTable();
        }
    });
});

async function fetchPaymentsData() {
    try {
        let response;
        if (typeof employeeFetch === 'function') {
            response = await employeeFetch('/api/finance-officer/payments');
        } else {
            const userId = localStorage.getItem('userId') || sessionStorage.getItem('userId');
            const headers = userId ? { 'x-user-id': userId } : {};
            response = await fetch('/api/finance-officer/payments', { headers });
        }

        if (!response.ok) throw new Error(await EmployeeUI.errorMessage(response));

        const data = await response.json();

        // Populate User Profile
        const userNameEl = document.getElementById('userName');
        const userAvatarEl = document.getElementById('userAvatar');

        if (userNameEl) userNameEl.textContent = data.user.fullName || 'Financial Officer';
        if (userAvatarEl && data.user.avatarSrc) userAvatarEl.src = data.user.avatarSrc;

        allPaymentsData = data.payments || [];
        latestReconciliation = data.latestReconciliation || null;
        applyPaymentsFilter();
        renderUnreconciledKpi();

    } catch (error) {
        console.error('Could not load live data from the server:', error);
        if (window.EmployeeUI) { EmployeeUI.showError(error); EmployeeUI.failTables(); }
    }
}

function filterPaymentsByChannel(channel, element) {
    currentPaymentChannel = channel;
    document.querySelectorAll('.order-filter-tabs .tab-btn').forEach(btn => btn.classList.remove('active'));
    element.classList.add('active');
    applyPaymentsFilter();
}

function applyPaymentsFilter() {
    const q = document.getElementById('paymentsSearchInput')?.value.toLowerCase().trim() || '';

    filteredPaymentsData = allPaymentsData.filter(item => {
        // Filter by Channel
        if (currentPaymentChannel !== 'all' && item.channel !== currentPaymentChannel) {
            return false;
        }

        // Filter by Search Query
        if (q) {
            const cust = (item.customer_name || '').toLowerCase();
            const order = (item.order_number || '').toLowerCase();
            const ref = (item.ref_id || '').toLowerCase();
            const ch = (item.channel_label || '').toLowerCase();
            if (!cust.includes(q) && !order.includes(q) && !ref.includes(q) && !ch.includes(q)) {
                return false;
            }
        }

        return true;
    });

    // Update KPI Card Calculations
    const totalPayments = allPaymentsData.reduce((sum, item) => sum + (item.amount || 0), 0);
    const ewalletSum = allPaymentsData.filter(i => i.channel === 'ewallet').reduce((sum, item) => sum + (item.amount || 0), 0);
    const cashSum = allPaymentsData.filter(i => i.channel === 'cash').reduce((sum, item) => sum + (item.amount || 0), 0);

    document.getElementById('kpiTotalPayments').textContent = '₱' + formatAmount(totalPayments);
    document.getElementById('kpiEwallet').textContent = '₱' + formatAmount(ewalletSum);
    document.getElementById('kpiCashDrawer').textContent = '₱' + formatAmount(cashSum);

    currentPaymentPage = 1;
    renderPaymentsTable();
}

function renderPaymentsTable() {
    const tbody = document.getElementById('paymentsTableBody');
    const pageInfo = document.getElementById('paymentsPageInfo');
    const prevBtn = document.getElementById('prevPayBtn');
    const nextBtn = document.getElementById('nextPayBtn');

    if (!tbody) return;

    if (filteredPaymentsData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="loading-state-text">No payment transactions match this filter criteria.</td></tr>';
        if (pageInfo) pageInfo.textContent = 'Showing 0 of 0 transactions';
        if (prevBtn) prevBtn.disabled = true;
        if (nextBtn) nextBtn.disabled = true;
        renderPayPagerButtons(1, 1);
        return;
    }

    const totalPages = Math.ceil(filteredPaymentsData.length / PAYMENTS_PAGE_SIZE) || 1;
    const startIndex = (currentPaymentPage - 1) * PAYMENTS_PAGE_SIZE;
    const pageItems = filteredPaymentsData.slice(startIndex, startIndex + PAYMENTS_PAGE_SIZE);

    if (pageInfo) {
        const startNum = startIndex + 1;
        const endNum = Math.min(startIndex + PAYMENTS_PAGE_SIZE, filteredPaymentsData.length);
        pageInfo.textContent = `Showing ${startNum}-${endNum} of ${filteredPaymentsData.length} transactions`;
    }
    if (prevBtn) prevBtn.disabled = currentPaymentPage <= 1;
    if (nextBtn) nextBtn.disabled = currentPaymentPage >= totalPages;

    renderPayPagerButtons(totalPages, currentPaymentPage);

    tbody.innerHTML = pageItems.map(row => {
        const amount = formatAmount(row.amount);
        const channelClass = row.channel === 'cash' ? 'channel-cash' : 'channel-gcash';

        return `
            <tr>
                <td><span style="font-size: 12px; color: var(--text-muted); font-weight: 700;">${escapeHtml(row.date)}</span></td>
                <td>
                    <strong style="color: var(--brown-soft); font-size: 13px;">${escapeHtml(row.customer_name)}</strong>
                    <div style="font-size: 11px; color: var(--text-muted);">${escapeHtml(row.order_number)}</div>
                </td>
                <td>
                    <span class="badge-channel ${channelClass}">${escapeHtml(row.channel_label)}</span>
                </td>
                <td><strong style="color: var(--text-dark); font-size: 12px;">${escapeHtml(row.ref_id)}</strong></td>
                <td><strong style="color: var(--brown-soft); font-family: var(--font-family-heading); font-size: 13.5px;">₱${amount}</strong></td>
                <td>
                    <span class="status-badge-pay verified">
                        ${escapeHtml(row.status_label || '✓ Verified')}
                    </span>
                </td>
                <td style="text-align: right;">
                    <button type="button" class="btn-reconcile-action" onclick="viewTransactionAudit(${row.id})">
                        Audit Receipt
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

// Numbered Pager Buttons
function renderPayPagerButtons(totalPages, activePage) {
    const pagerNumbers = document.getElementById('payPagerNumbers');
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
            if (page && page !== currentPaymentPage) {
                currentPaymentPage = page;
                renderPaymentsTable();
            }
        });
    });
}

// Shows the real variance from the most recent drawer count on file - or an
// honest "not counted yet" state if no reconciliation has ever been
// submitted. Never fabricates a number.
function renderUnreconciledKpi() {
    const el = document.getElementById('kpiUnreconciled');
    if (!el) return;

    if (!latestReconciliation) {
        el.textContent = 'Not counted yet';
        el.style.color = '';
        return;
    }

    const variance = Number(latestReconciliation.variance || 0);
    const sign = variance > 0 ? '+' : (variance < 0 ? '−' : '');
    el.textContent = `${sign}₱${formatAmount(Math.abs(variance))}`;
    el.style.color = variance === 0 ? 'var(--success, #2e7d32)' : 'var(--danger, #c0392b)';
}

async function handleDrawerCount(e) {
    e.preventDefault();

    const amountInput = document.getElementById('drawerCountedAmount');
    const notesInput = document.getElementById('drawerCountNotes');
    const counted_amount = parseFloat(amountInput?.value);

    if (isNaN(counted_amount) || counted_amount < 0) {
        alert('Enter a valid counted amount.');
        return;
    }

    try {
        const userId = localStorage.getItem('userId') || sessionStorage.getItem('userId');
        const response = await fetch('/api/finance-officer/reconciliation', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(userId ? { 'x-user-id': userId } : {})
            },
            body: JSON.stringify({ counted_amount, notes: notesInput?.value || '' })
        });

        const data = await response.json();
        if (!response.ok || data.status !== 'success') {
            throw new Error(data.message || 'Could not save the drawer count.');
        }

        latestReconciliation = data.record;
        renderUnreconciledKpi();
        closeDrawerCountModal();
        alert(`Drawer count saved.\nExpected: ₱${formatAmount(data.record.expected_amount)}\nCounted: ₱${formatAmount(data.record.counted_amount)}\nVariance: ₱${formatAmount(data.record.variance)}`);
    } catch (error) {
        alert(error.message || 'Could not save the drawer count.');
    }
}

function openDrawerCountModal() {
    const m = document.getElementById('drawerCountModal');
    if (m) {
        m.classList.add('open');
        document.body.style.overflow = 'hidden';
    }
}

function closeDrawerCountModal() {
    const m = document.getElementById('drawerCountModal');
    if (m) {
        m.classList.remove('open');
        document.body.style.overflow = '';
    }
    const form = document.getElementById('drawerCountForm');
    if (form) form.reset();
}

function viewTransactionAudit(id) {
    const item = allPaymentsData.find(p => p.id === id);
    if (!item) return;

    alert(`Payment Transaction Audit:\n• Order #: ${item.order_number}\n• Customer / Batch: ${item.customer_name}\n• Payment Channel: ${item.channel_label}\n• Gateway Reference: ${item.ref_id}\n• Amount Received: ₱${formatAmount(item.amount)}\n• Status: ${item.status_label}\n\nReconciliation status: Settled to general treasury.`);
}

function handleAddPaymentRecord(e) {
    e.preventDefault();

    // NOTE: There is currently no backend endpoint to persist a manually
    // logged payment record - it would previously vanish on refresh while
    // claiming to be "reconciled and posted." Rather than fake a save,
    // we say so honestly until a real /api/finance-officer/payments POST
    // endpoint exists.
    alert('Manual payment logging isn\'t connected to the database yet, so nothing was saved. This needs a real backend endpoint before it can record anything.');
    closePaymentModal();
}

function openPaymentModal() {
    const m = document.getElementById('paymentModal');
    if (m) {
        m.classList.add('open');
        document.body.style.overflow = 'hidden';
    }
}

function closePaymentModal() {
    const m = document.getElementById('paymentModal');
    if (m) {
        m.classList.remove('open');
        document.body.style.overflow = '';
    }
}

function formatAmount(val) {
    return Number(val || 0).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
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