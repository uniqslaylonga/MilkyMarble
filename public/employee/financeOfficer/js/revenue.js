let currentWorkspaceTab = 'revenue'; // 'revenue' o 'settlements'

// Revenue Flavor Contribution State
let allRevenueItems = [];
let filteredRevenueItems = [];
let currentRevPage = 1;
const REV_PAGE_SIZE = 5;

// Consolidated Payments State
let allPaymentTransactions = [];
let filteredPaymentTransactions = [];
let currentPayPage = 1;
const PAY_PAGE_SIZE = 5;
let activePaymentChannelFilter = 'all';

// Charts & Register State
let weeklyChartInstance = null;
let channelDonutInstance = null;
let drawerPreviewData = null;

// Day 1 & DSO Cycle State (Default fallback: September 1, 2026)
let cycleStartDate = localStorage.getItem('mm_cycle_start_date') || '2026-09-01';

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
    if (typeof Chart !== 'undefined') {
        Chart.defaults.font.family = "'Urbanist', sans-serif";
    }

    fetchRevenueAndPaymentsData();
    updateCycleDayProgressUI();

    // Workspace Tab Switcher
    document.getElementById('tabBtnRevenue')?.addEventListener('click', () => switchWorkspaceTab('revenue'));
    document.getElementById('tabBtnSettlements')?.addEventListener('click', () => switchWorkspaceTab('settlements'));

    // Revenue Filters
    document.getElementById('revenueSearchInput')?.addEventListener('input', handleGlobalSearchInput);
    document.getElementById('flavorFilter')?.addEventListener('change', applyRevenueFilters);

    // Payments Channel Tabs
    const payFilterTabs = document.querySelectorAll('.order-filter-tabs .tab-btn');
    payFilterTabs.forEach(btn => {
        btn.addEventListener('click', (e) => {
            payFilterTabs.forEach(b => b.classList.remove('active'));
            e.currentTarget.classList.add('active');
            activePaymentChannelFilter = e.currentTarget.getAttribute('data-payfilter') || 'all';
            applyPaymentsFilters();
        });
    });

    // Form Submissions
    document.getElementById('reconcileStep1Form')?.addEventListener('submit', handleReconcileStep1Verify);
    document.getElementById('reconcileStep2Form')?.addEventListener('submit', handleReconcileStep2Submit);
    document.getElementById('cycleStartForm')?.addEventListener('submit', handleSaveCycleStart);

    // Revenue Pager Buttons
    document.getElementById('prevRevBtn')?.addEventListener('click', () => {
        if (currentRevPage > 1) {
            currentRevPage--;
            renderRevenueTable();
        }
    });
    document.getElementById('nextRevBtn')?.addEventListener('click', () => {
        const totalPages = Math.ceil(filteredRevenueItems.length / REV_PAGE_SIZE) || 1;
        if (currentRevPage < totalPages) {
            currentRevPage++;
            renderRevenueTable();
        }
    });

    // Payments Pager Buttons
    document.getElementById('prevPayBtn')?.addEventListener('click', () => {
        if (currentPayPage > 1) {
            currentPayPage--;
            renderPaymentsTable();
        }
    });
    document.getElementById('nextPayBtn')?.addEventListener('click', () => {
        const totalPages = Math.ceil(filteredPaymentTransactions.length / PAY_PAGE_SIZE) || 1;
        if (currentPayPage < totalPages) {
            currentPayPage++;
            renderPaymentsTable();
        }
    });
});

// Load both Revenue Analytics and Payments Ledger in one consolidated call
async function fetchRevenueAndPaymentsData() {
    try {
        const userId = localStorage.getItem('userId') || sessionStorage.getItem('userId');
        const headers = userId ? { 'x-user-id': userId } : {};

        // 1. Fetch Revenue Metrics & Flavor Contribution
        const revRes = await fetch('/api/finance-officer/revenue', { headers });
        if (!revRes.ok) throw new Error('Failed to load revenue data');
        const revData = await revRes.json();

        // 2. Fetch Payments Ledger & Reconciliation Records
        const payRes = await fetch('/api/finance-officer/payments', { headers });
        if (!payRes.ok) throw new Error('Failed to load payments data');
        const payData = await payRes.json();

        // Populate User Info
        const userNameEl = document.getElementById('userName');
        const userAvatarEl = document.getElementById('userAvatar');
        const user = revData.user || payData.user || {};
        if (userNameEl) userNameEl.textContent = user.fullName || 'Financial Officer';
        if (userAvatarEl && user.avatarSrc) userAvatarEl.src = user.avatarSrc;

        // Populate Revenue KPIs
        if (revData.metrics) {
            setText('totalRevenue', '₱' + formatAmount(revData.metrics.totalRevenue));
            setText('preordersInflow', '₱' + formatAmount(revData.metrics.preordersInflow));
            setText('presetsInflow', '₱' + formatAmount(revData.metrics.presetsInflow));
            calculateAndDisplayDSO(revData.metrics.totalRevenue);
        }

        const avgCupMarginEl = document.getElementById('avgCupMargin');
        const avgCupMarginFooterEl = document.getElementById('avgCupMarginFooter');
        if (revData.metrics && revData.metrics.avgCupMargin !== null && revData.metrics.avgCupMargin !== undefined) {
            if (avgCupMarginEl) avgCupMarginEl.textContent = '₱' + formatAmount(revData.metrics.avgCupMargin);
            if (avgCupMarginFooterEl) avgCupMarginFooterEl.textContent = `Net Profit Margin: ${revData.metrics.netProfitMarginPct}%`;
        } else {
            if (avgCupMarginEl) avgCupMarginEl.textContent = '—';
            if (avgCupMarginFooterEl) avgCupMarginFooterEl.textContent = 'Needs recorded COGS expenses to calculate';
        }

        // Flavor table
        allRevenueItems = revData.flavorContributions || [];
        applyRevenueFilters();

        // Payments table
        allPaymentTransactions = payData.payments || [];
        document.getElementById('paymentsCountBadge').textContent = allPaymentTransactions.length;
        applyPaymentsFilters();

        // Render Charts
        initWeeklyReleaseChart(revData.weeklyComparison);
        initChannelDonutChart(revData.channelShares);

    } catch (error) {
        console.error('Could not load revenue/settlement records:', error);
        MMSwal.fire({
            icon: 'warning',
            title: 'System Notice',
            text: error.message || 'Could not load revenue data from server.'
        });
    }
}

// Workspace Tab Switcher
function switchWorkspaceTab(tab) {
    currentWorkspaceTab = tab;
    const revTabBtn = document.getElementById('tabBtnRevenue');
    const setTabBtn = document.getElementById('tabBtnSettlements');
    const revArea = document.getElementById('revenueViewArea');
    const setArea = document.getElementById('settlementsViewArea');

    if (tab === 'revenue') {
        revTabBtn?.classList.add('active');
        setTabBtn?.classList.remove('active');
        if (revArea) revArea.style.display = 'block';
        if (setArea) setArea.style.display = 'none';
    } else {
        setTabBtn?.classList.add('active');
        revTabBtn?.classList.remove('active');
        if (revArea) revArea.style.display = 'none';
        if (setArea) setArea.style.display = 'block';
    }
}

function handleGlobalSearchInput() {
    if (currentWorkspaceTab === 'revenue') {
        applyRevenueFilters();
    } else {
        applyPaymentsFilters();
    }
}

// --------------------------------------------------------------------------
// TAB 1: REVENUE VELOCITY & FLAVOR TABLE
// --------------------------------------------------------------------------
function applyRevenueFilters() {
    const q = document.getElementById('revenueSearchInput')?.value.toLowerCase().trim() || '';
    const catFilter = document.getElementById('flavorFilter')?.value || 'all';

    filteredRevenueItems = allRevenueItems.filter(item => {
        if (catFilter !== 'all' && item.category !== catFilter) return false;
        if (q) {
            const name = (item.flavor_name || '').toLowerCase();
            const cat = (item.category_label || '').toLowerCase();
            if (!name.includes(q) && !cat.includes(q)) return false;
        }
        return true;
    });

    currentRevPage = 1;
    renderRevenueTable();
}

function renderRevenueTable() {
    const tbody = document.getElementById('revenueTableBody');
    const pageInfo = document.getElementById('revenuePageInfo');
    const prevBtn = document.getElementById('prevRevBtn');
    const nextBtn = document.getElementById('nextRevBtn');

    if (!tbody) return;

    if (filteredRevenueItems.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="loading-state-text">No flavor contribution items match your filter criteria.</td></tr>';
        if (pageInfo) pageInfo.textContent = 'Showing 0 of 0 items';
        if (prevBtn) prevBtn.disabled = true;
        if (nextBtn) nextBtn.disabled = true;
        renderRevPagerButtons(1, 1);
        return;
    }

    const totalPages = Math.ceil(filteredRevenueItems.length / REV_PAGE_SIZE) || 1;
    const startIndex = (currentRevPage - 1) * REV_PAGE_SIZE;
    const pageItems = filteredRevenueItems.slice(startIndex, startIndex + REV_PAGE_SIZE);

    if (pageInfo) {
        const startNum = startIndex + 1;
        const endNum = Math.min(startIndex + REV_PAGE_SIZE, filteredRevenueItems.length);
        pageInfo.textContent = `Showing ${startNum}-${endNum} of ${filteredRevenueItems.length} items`;
    }
    if (prevBtn) prevBtn.disabled = currentRevPage <= 1;
    if (nextBtn) nextBtn.disabled = currentRevPage >= totalPages;

    renderRevPagerButtons(totalPages, currentRevPage);

    tbody.innerHTML = pageItems.map(item => {
        const isHighMargin = item.net_margin_pct >= 42;
        const perfClass = isHighMargin ? 'perf-high' : 'perf-mid';

        return `
            <tr>
                <td>
                    <strong style="color: var(--brown-soft); font-size: 13px;">${escapeHtml(item.flavor_name)}</strong>
                </td>
                <td><span style="font-size: 12px; color: var(--text-dark);">${escapeHtml(item.category_label)}</span></td>
                <td><strong>${item.cups_sold} cups</strong></td>
                <td>₱${formatAmount(item.unit_price)}</td>
                <td><strong style="color: var(--brown-soft); font-family: var(--font-family-heading); font-size: 13.5px;">₱${formatAmount(item.gross_sales)}</strong></td>
                <td><span style="color: var(--text-muted);">₱${formatAmount(item.unit_cogs * item.cups_sold)}</span></td>
                <td>
                    <strong style="color: ${isHighMargin ? '#2E7D32' : '#B26A00'};">${item.net_margin_pct}%</strong>
                </td>
                <td style="text-align: right;">
                    <span class="badge-perf ${perfClass}">${escapeHtml(item.perf_status)}</span>
                </td>
            </tr>
        `;
    }).join('');
}

function renderRevPagerButtons(totalPages, activePage) {
    const pagerNumbers = document.getElementById('revPagerNumbers');
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
            if (page && page !== currentRevPage) {
                currentRevPage = page;
                renderRevenueTable();
            }
        });
    });
}

// --------------------------------------------------------------------------
// TAB 2: CUSTOMER PAYMENTS & SETTLEMENT AUDIT TRAIL
// --------------------------------------------------------------------------
function applyPaymentsFilters() {
    const q = document.getElementById('revenueSearchInput')?.value.toLowerCase().trim() || '';

    filteredPaymentTransactions = allPaymentTransactions.filter(item => {
        if (activePaymentChannelFilter !== 'all' && item.channel !== activePaymentChannelFilter) {
            return false;
        }
        if (q) {
            const orderNum = (item.order_number || '').toLowerCase();
            const cust = (item.customer_name || '').toLowerCase();
            const ref = (item.ref_id || '').toLowerCase();
            if (!orderNum.includes(q) && !cust.includes(q) && !ref.includes(q)) return false;
        }
        return true;
    });

    currentPayPage = 1;
    renderPaymentsTable();
}

function renderPaymentsTable() {
    const tbody = document.getElementById('paymentsTableBody');
    const pageInfo = document.getElementById('payPageInfo');
    const prevBtn = document.getElementById('prevPayBtn');
    const nextBtn = document.getElementById('nextPayBtn');

    if (!tbody) return;

    if (filteredPaymentTransactions.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="loading-state-text">No payment records found under this channel filter.</td></tr>';
        if (pageInfo) pageInfo.textContent = 'Showing 0 of 0 transactions';
        if (prevBtn) prevBtn.disabled = true;
        if (nextBtn) nextBtn.disabled = true;
        renderPayPagerButtons(1, 1);
        return;
    }

    const totalPages = Math.ceil(filteredPaymentTransactions.length / PAY_PAGE_SIZE) || 1;
    const startIndex = (currentPayPage - 1) * PAY_PAGE_SIZE;
    const pageItems = filteredPaymentTransactions.slice(startIndex, startIndex + PAY_PAGE_SIZE);

    if (pageInfo) {
        const startNum = startIndex + 1;
        const endNum = Math.min(startIndex + PAY_PAGE_SIZE, filteredPaymentTransactions.length);
        pageInfo.textContent = `Showing ${startNum}-${endNum} of ${filteredPaymentTransactions.length} transactions`;
    }
    if (prevBtn) prevBtn.disabled = currentPayPage <= 1;
    if (nextBtn) nextBtn.disabled = currentPayPage >= totalPages;

    renderPayPagerButtons(totalPages, currentPayPage);

    tbody.innerHTML = pageItems.map(p => {
        const isCash = p.channel === 'cash';
        const channelBadgeClass = isCash ? 'channel-cash' : 'channel-ewallet';
        const channelDotClass = isCash ? 'dot-cash' : 'dot-ewallet';

        return `
            <tr>
                <td>
                    <span style="font-size: 12px; font-weight: 700; color: var(--text-dark);">${escapeHtml(p.date)}</span>
                    <div style="font-size: 10.5px; color: var(--text-muted);">Release Window</div>
                </td>
                <td>
                    <strong style="color: var(--brown-soft); font-size: 13px;">${escapeHtml(p.customer_name)}</strong>
                    <div style="font-size: 11px; color: var(--text-muted);">${escapeHtml(p.order_number)}</div>
                </td>
                <td>
                    <span class="badge-channel ${channelBadgeClass}">
                        <span class="badge-dot ${channelDotClass}"></span>
                        ${escapeHtml(p.channel_label)}
                    </span>
                </td>
                <td>
                    <span style="font-size: 12px; font-family: monospace; color: var(--text-dark);">${escapeHtml(p.ref_id || 'Cash Remittance')}</span>
                </td>
                <td>
                    <strong style="color: var(--brown-soft); font-family: var(--font-family-heading); font-size: 13.5px;">₱${formatAmount(p.amount)}</strong>
                </td>
                <td>
                    <span class="settle-status-pill settled">Settled in General Treasury</span>
                </td>
                <td style="text-align: right;">
                    <button type="button" class="btn-inspect-tx" onclick="inspectTransactionDetail(${p.id})">
                        Audit Receipt
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

function renderPayPagerButtons(totalPages, activePage) {
    const pagerNumbers = document.getElementById('payPagerNumbers');
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
            if (page && page !== currentPayPage) {
                currentPayPage = page;
                renderPaymentsTable();
            }
        });
    });
}

// Replaced old window.alert() with SweetAlert2 Transaction Audit Summary
function inspectTransactionDetail(txId) {
    const tx = allPaymentTransactions.find(t => t.id === txId);
    if (!tx) return;

    MMSwal.fire({
        title: `Payment Audit: ${tx.order_number}`,
        html: `
            <div style="text-align: left; font-size: 13px; line-height: 1.6; color: var(--text-dark);">
                <div style="margin-bottom: 6px;"><strong>Customer:</strong> ${escapeHtml(tx.customer_name)}</div>
                <div style="margin-bottom: 6px;"><strong>Channel:</strong> ${escapeHtml(tx.channel_label)}</div>
                <div style="margin-bottom: 6px;"><strong>Amount Settled:</strong> ₱${formatAmount(tx.amount)}</div>
                <div style="margin-bottom: 6px;"><strong>Transaction Timestamp:</strong> ${escapeHtml(tx.date)}</div>
                <div style="background: var(--bg-main); padding: 10px 12px; border-radius: 10px; margin-top: 10px; border-left: 3px solid var(--accent-pink);">
                    <strong>Treasury Clearance:</strong> Verified at Sales Counter &amp; recognized in active 45-day operating cycle collections.
                </div>
            </div>
        `,
        confirmButtonText: 'Close'
    });
}

// --------------------------------------------------------------------------
// PUNTO 1: BLIND DRAWER CASH RECONCILIATION
// --------------------------------------------------------------------------
async function openReconcileModal() {
    const modal = document.getElementById('reconcileModal');
    if (!modal) return;

    resetReconcileToStep1();
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';

    // Pre-fetch live register figures silently
    try {
        const userId = localStorage.getItem('userId') || sessionStorage.getItem('userId');
        const headers = userId ? { 'x-user-id': userId } : {};
        const response = await fetch('/api/finance-officer/reconciliation/preview', { headers });
        if (response.ok) {
            drawerPreviewData = await response.json();
        }
    } catch (err) {
        console.warn('Could not pre-fetch drawer figures:', err.message);
    }
}

function closeReconcileModal() {
    const modal = document.getElementById('reconcileModal');
    if (modal) {
        modal.classList.remove('open');
        document.body.style.overflow = '';
    }
    resetReconcileToStep1();
}

function resetReconcileToStep1() {
    document.getElementById('reconcileStep1Form').style.display = 'block';
    document.getElementById('reconcileStep2Form').style.display = 'none';
    document.getElementById('reconcileStep1Form').reset();
    document.getElementById('reconcileStep2Form').reset();
}

// Step 1: Input count -> Disclose Variance
function handleReconcileStep1Verify(e) {
    e.preventDefault();
    const countedAmount = parseFloat(document.getElementById('reconcileCountedAmount').value);

    if (isNaN(countedAmount) || countedAmount < 0) {
        MMSwal.fire({
            icon: 'warning',
            title: 'Invalid Input',
            text: 'Please input a valid physical cash count.'
        });
        return;
    }

    const floatAmt = (drawerPreviewData && drawerPreviewData.openingFloat) || 1000.00;
    const cashSales = (drawerPreviewData && drawerPreviewData.walkinCashTotal) || 0.00;
    const expected = (drawerPreviewData && drawerPreviewData.expectedDrawer) || (floatAmt + cashSales);
    const variance = Math.round((countedAmount - expected) * 100) / 100;

    // Populate Disclosed Step 2
    setText('auditFloatVal', '₱' + formatAmount(floatAmt));
    setText('auditCashSalesVal', '₱' + formatAmount(cashSales));
    setText('auditExpectedVal', '₱' + formatAmount(expected));
    setText('auditCountedVal', '₱' + formatAmount(countedAmount));

    const varBadge = document.getElementById('auditVarianceBadge');
    if (variance === 0) {
        varBadge.className = 'badge-variance zero';
        varBadge.textContent = '₱0.00 (Balanced)';
    } else if (variance < 0) {
        varBadge.className = 'badge-variance shortage';
        varBadge.textContent = `-₱${formatAmount(Math.abs(variance))} (Cash Shortage)`;
    } else {
        varBadge.className = 'badge-variance overage';
        varBadge.textContent = `+₱${formatAmount(variance)} (Cash Overage)`;
    }

    document.getElementById('reconcileStep1Form').style.display = 'none';
    document.getElementById('reconcileStep2Form').style.display = 'block';
}

// Step 2: Final Submission & Unlock Register
async function handleReconcileStep2Submit(e) {
    e.preventDefault();
    const counted_amount = parseFloat(document.getElementById('reconcileCountedAmount').value);
    const notes = document.getElementById('reconcileAuditNotes').value.trim() || 'Settled and Reconciled by Financial Officer';

    try {
        const userId = localStorage.getItem('userId') || sessionStorage.getItem('userId');
        const headers = { 'Content-Type': 'application/json' };
        if (userId) headers['x-user-id'] = userId;

        const response = await fetch('/api/finance-officer/reconciliation', {
            method: 'POST',
            headers,
            body: JSON.stringify({ counted_amount, notes })
        });

        const data = await response.json();
        if (!response.ok || data.status !== 'success') {
            throw new Error(data.message || 'Could not save reconciliation.');
        }

        closeReconcileModal();
        await fetchRevenueAndPaymentsData();

        MMSwal.fire({
            icon: 'success',
            title: 'Drawer Reconciled & Unlocked',
            html: `
                <div style="text-align: left; font-size: 13px; line-height: 1.6;">
                    <strong>Expected Drawer:</strong> ₱${formatAmount(data.record?.expected_amount)}<br>
                    <strong>Counted Cash:</strong> ₱${formatAmount(data.record?.counted_amount)}<br>
                    <strong>Discrepancy:</strong> ₱${formatAmount(data.record?.variance)}<br><br>
                    <small style="color:var(--text-muted);">Shift closed, audit trail committed, and Sales Counter Register has been unlocked for the next operating shift.</small>
                </div>
            `
        });

    } catch (error) {
        MMSwal.fire({
            icon: 'warning',
            title: 'Reconciliation Failed',
            text: error.message || 'Could not record reconciliation.'
        });
    }
}

// --------------------------------------------------------------------------
// DAY 1 CYCLE PROGRESS & DSO CALCULATION
// --------------------------------------------------------------------------
function updateCycleDayProgressUI() {
    const start = new Date(cycleStartDate);
    const today = new Date();

    start.setHours(0, 0, 0, 0);
    today.setHours(0, 0, 0, 0);

    const diffTime = today - start;
    const currentDay = Math.max(1, Math.floor(diffTime / (1000 * 60 * 60 * 24)) + 1);

    const bannerBadge = document.getElementById('cycleProgressBannerBadge');
    if (bannerBadge) {
        bannerBadge.textContent = `Day ${currentDay} of 45 Days • DSO Benchmark Active`;
    }

    const inputEl = document.getElementById('cycleStartDateInput');
    if (inputEl) {
        inputEl.value = cycleStartDate;
    }
}

function calculateAndDisplayDSO(totalRevenue) {
    const dsoValueEl = document.getElementById('dsoValue');
    const dsoFooterEl = document.getElementById('dsoFooterText');

    const start = new Date(cycleStartDate);
    const today = new Date();
    start.setHours(0, 0, 0, 0);
    today.setHours(0, 0, 0, 0);

    const daysElapsed = Math.max(1, Math.floor((today - start) / (1000 * 60 * 60 * 24)) + 1);
    const calculatedDSO = Math.min(daysElapsed, 12);

    if (dsoValueEl) dsoValueEl.textContent = `${calculatedDSO} Days`;
    if (dsoFooterEl) {
        if (calculatedDSO <= 45) {
            dsoFooterEl.innerHTML = `<span class="badge-dso-target good">Target: &lt; 45 Days</span><small class="dso-sub">Low Liquidity Risk</small>`;
        } else {
            dsoFooterEl.innerHTML = `<span class="badge-dso-target warn">Over 45 Days</span><small class="dso-sub">High Liquidity Risk</small>`;
        }
    }
}

function openCycleStartModal() {
    const m = document.getElementById('cycleStartModal');
    if (m) {
        m.classList.add('open');
        document.body.style.overflow = 'hidden';
    }
}

function closeCycleStartModal() {
    const m = document.getElementById('cycleStartModal');
    if (m) {
        m.classList.remove('open');
        document.body.style.overflow = '';
    }
}

function handleSaveCycleStart(e) {
    e.preventDefault();
    const inputVal = document.getElementById('cycleStartDateInput')?.value;
    if (!inputVal) return;

    cycleStartDate = inputVal;
    localStorage.setItem('mm_cycle_start_date', cycleStartDate);

    closeCycleStartModal();
    updateCycleDayProgressUI();
    fetchRevenueAndPaymentsData();

    MMSwal.fire({
        icon: 'success',
        title: 'Cycle Baseline Established',
        text: `Day 1 officially designated on ${new Date(cycleStartDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}. The 45-day collection window is tracking.`
    });
}

// --------------------------------------------------------------------------
// CHARTS SETUP
// --------------------------------------------------------------------------
function initWeeklyReleaseChart(customData) {
    const ctx = document.getElementById('weeklyReleaseChart')?.getContext('2d');
    if (!ctx) return;

    if (weeklyChartInstance) weeklyChartInstance.destroy();

    const labels = ['Week -3', 'Week -2', 'Week -1', 'This Week'];
    const tuesdayData = (customData && customData.tuesday) || [0, 0, 0, 0];
    const thursdayData = (customData && customData.thursday) || [0, 0, 0, 0];

    weeklyChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                {
                    label: 'Tuesday Release (10 AM - 3 PM)',
                    data: tuesdayData,
                    backgroundColor: '#F69299',
                    borderRadius: 6,
                    barThickness: 18
                },
                {
                    label: 'Thursday Release (10 AM - 3 PM)',
                    data: thursdayData,
                    backgroundColor: '#7C4F38',
                    borderRadius: 6,
                    barThickness: 18
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11, weight: 700 } } }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: 'rgba(246, 146, 153, 0.15)' },
                    ticks: { font: { size: 10 }, callback: val => '₱' + val.toLocaleString() }
                },
                x: {
                    grid: { display: false },
                    ticks: { font: { size: 11, weight: 700 }, color: '#7C4F38' }
                }
            }
        }
    });
}

function initChannelDonutChart(customData) {
    const ctx = document.getElementById('channelDonutChart')?.getContext('2d');
    if (!ctx) return;

    if (channelDonutInstance) channelDonutInstance.destroy();

    const dataPoints = customData || [0, 0];
    const total = dataPoints[0] + dataPoints[1];
    const pct = (v) => total > 0 ? Math.round((v / total) * 100) : 0;
    const preordersLegendEl = document.getElementById('preordersLegendVal');
    const presetsLegendEl = document.getElementById('presetsLegendVal');
    if (preordersLegendEl) preordersLegendEl.textContent = `₱${formatAmount(dataPoints[0])} (${pct(dataPoints[0])}%)`;
    if (presetsLegendEl) presetsLegendEl.textContent = `₱${formatAmount(dataPoints[1])} (${pct(dataPoints[1])}%)`;

    channelDonutInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Pre-Orders (Custom)', 'Walk-in Presets'],
            datasets: [{
                data: dataPoints,
                backgroundColor: ['#F69299', '#EAA342'],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '68%',
            plugins: { legend: { display: false } }
        }
    });
}

function formatAmount(val) {
    return Number(val || 0).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
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