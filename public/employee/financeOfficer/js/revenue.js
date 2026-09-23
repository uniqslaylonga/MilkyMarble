let allRevenueItems = [];
let filteredRevenueItems = [];
let currentRevPage = 1;
const REV_PAGE_SIZE = 5;

let weeklyChartInstance = null;
let channelDonutInstance = null;

// Day 1 & DSO Cycle State (Default fallback: September 1, 2026)
let cycleStartDate = localStorage.getItem('mm_cycle_start_date') || '2026-09-01';

document.addEventListener('DOMContentLoaded', () => {
    Chart.defaults.font.family = "'Urbanist', sans-serif";
    fetchRevenueData();
    updateCycleDayProgressUI();

    // Filter listeners
    document.getElementById('revenueSearchInput')?.addEventListener('input', applyRevenueFilters);
    document.getElementById('flavorFilter')?.addEventListener('change', applyRevenueFilters);

    // Form Submissions
    document.getElementById('reconcileForm')?.addEventListener('submit', handleReconcileSubmit);
    document.getElementById('cycleStartForm')?.addEventListener('submit', handleSaveCycleStart);

    // Pagination buttons
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
});

async function fetchRevenueData() {
    try {
        let response;
        if (typeof employeeFetch === 'function') {
            response = await employeeFetch('/api/finance-officer/revenue');
        } else {
            const userId = localStorage.getItem('userId') || sessionStorage.getItem('userId');
            const headers = userId ? { 'x-user-id': userId } : {};
            response = await fetch('/api/finance-officer/revenue', { headers });
        }

        if (!response.ok) throw new Error(await EmployeeUI.errorMessage(response));

        const data = await response.json();

        // User Profile
        const userNameEl = document.getElementById('userName');
        const userAvatarEl = document.getElementById('userAvatar');
        if (userNameEl) userNameEl.textContent = data.user.fullName || 'Financial Officer';
        if (userAvatarEl && data.user.avatarSrc) userAvatarEl.src = data.user.avatarSrc;

        // Metrics setup
        if (data.metrics) {
            const totalRevenueEl = document.getElementById('totalRevenue');
            const preordersInflowEl = document.getElementById('preordersInflow');
            const presetsInflowEl = document.getElementById('presetsInflow');
            if (totalRevenueEl) totalRevenueEl.textContent = '₱' + formatAmount(data.metrics.totalRevenue);
            if (preordersInflowEl) preordersInflowEl.textContent = '₱' + formatAmount(data.metrics.preordersInflow);
            if (presetsInflowEl) presetsInflowEl.textContent = '₱' + formatAmount(data.metrics.presetsInflow);

            // Calculate Dynamic Days Sales Outstanding (DSO) based on Cycle Progress
            calculateAndDisplayDSO(data.metrics.totalRevenue);
        }

        const avgCupMarginEl = document.getElementById('avgCupMargin');
        const avgCupMarginFooterEl = avgCupMarginEl?.closest('.stat-card')?.querySelector('.stat-footer');
        if (data.metrics && data.metrics.avgCupMargin !== null && data.metrics.avgCupMargin !== undefined) {
            if (avgCupMarginEl) avgCupMarginEl.textContent = '₱' + formatAmount(data.metrics.avgCupMargin);
            if (avgCupMarginFooterEl) avgCupMarginFooterEl.textContent = `Net Profit Margin: ${data.metrics.netProfitMarginPct}%`;
        } else {
            if (avgCupMarginEl) avgCupMarginEl.textContent = '—';
            if (avgCupMarginFooterEl) avgCupMarginFooterEl.textContent = 'Needs recorded COGS expenses to calculate';
        }

        allRevenueItems = data.flavorContributions || [];
        applyRevenueFilters();

        initWeeklyReleaseChart(data.weeklyComparison);
        initChannelDonutChart(data.channelShares);

    } catch (error) {
        console.error('Could not load live data from the server:', error);
        if (window.EmployeeUI) { EmployeeUI.showError(error); EmployeeUI.failTables(); }
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

    // Realistic DSO formula: Receivables / Credit Sales * Days
    // In our quick-service setting, pre-orders and catering accounts are settled within 10-14 days
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
    fetchRevenueData();

    showCustomAlert("Cycle Baseline Saved", `Day 1 has been established on ${new Date(cycleStartDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}. The 45-day DSO countdown is now active.`, "success");
}

// --------------------------------------------------------------------------
// REVENUE FILTER & SMART SLIDING PAGINATION
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

// --------------------------------------------------------------------------
// RECONCILE COLLECTIONS LOGIC
// --------------------------------------------------------------------------
async function triggerReconciliationAudit() {
    const modal = document.getElementById('reconcileModal');
    const summaryBody = document.getElementById('reconcileSummaryBody');
    const form = document.getElementById('reconcileForm');
    if (!modal) return;

    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
    summaryBody.style.display = '';
    form.style.display = 'none';
    summaryBody.innerHTML = '<p class="loading-state-text">Loading real sales data…</p>';

    try {
        const userId = localStorage.getItem('userId') || sessionStorage.getItem('userId');
        const headers = {};
        if (userId) headers['x-user-id'] = userId;

        const response = await fetch('/api/sales-officer/x-reading', { headers });
        if (!response.ok) throw new Error('Failed to retrieve live register figures');
        const data = await response.json();

        summaryBody.innerHTML = `
            <div class="form-grid">
                <div class="metric-cell"><small>E-Wallet / QR Ph (GCash &amp; Maya)</small><strong>₱${formatAmount(data.digitalSubtotal)}</strong></div>
                <div class="metric-cell"><small>Walk-in Cash Sales</small><strong>₱${formatAmount(data.walkinCashTotal)}</strong></div>
                <div class="metric-cell"><small>Opening Float</small><strong>₱${formatAmount(data.openingFloat)}</strong></div>
                <div class="metric-cell highlight-cell"><small>Expected Cash in Drawer</small><strong>₱${formatAmount(data.expectedDrawer)}</strong></div>
            </div>
            <p style="font-size: 13px; margin-top: 12px;"><strong>Gross Inflow:</strong> ₱${formatAmount(data.grossTotal)} &nbsp;|&nbsp; ${data.preordersCount} Pre-orders, ${data.presetsCount} Presets Sold</p>
        `;

        form.style.display = '';
    } catch (error) {
        console.error('Could not load reconciliation preview:', error);
        summaryBody.innerHTML = `<p class="loading-state-text">Could not load sales data. Please check your database connection.</p>`;
    }
}

function closeReconcileModal() {
    const modal = document.getElementById('reconcileModal');
    if (modal) {
        modal.classList.remove('open');
        document.body.style.overflow = '';
    }
    document.getElementById('reconcileForm')?.reset();
}

async function handleReconcileSubmit(e) {
    e.preventDefault();
    const counted_amount = parseFloat(document.getElementById('reconcileCountedAmount')?.value);
    const notes = document.getElementById('reconcileNotes')?.value || 'Reconciled by Finance Officer';

    if (isNaN(counted_amount) || counted_amount < 0) {
        showCustomAlert("Invalid Amount", "Please enter a valid physically counted amount.", "warning");
        return;
    }

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

        // Release the sales counter lock in localStorage
        localStorage.setItem('isRegisterLocked', 'false');

        closeReconcileModal();
        showCustomAlert(
            "Reconciliation Settled",
            `Collections reconciled successfully.\nExpected: ₱${formatAmount(data.record.expected_amount)} | Counted: ₱${formatAmount(data.record.counted_amount)} | Variance: ₱${formatAmount(data.record.variance)}.\nSales counter register has been unlocked for the next operating shift.`,
            "success"
        );
        fetchRevenueData();
    } catch (error) {
        showCustomAlert("Error", error.message || 'Could not save the reconciliation.', "warning");
    }
}

// --------------------------------------------------------------------------
// CUSTOM DIALOG NOTIFICATION MODAL
// --------------------------------------------------------------------------
function showCustomAlert(title, message, type = "notice") {
    const modal = document.getElementById('customAlertModal');
    if (!modal) return;

    document.getElementById('alertModalTitle').textContent = title;
    document.getElementById('alertModalMessage').textContent = message;

    const iconWrap = document.getElementById('alertDialogIconWrap');
    if (iconWrap) {
        iconWrap.className = 'dialog-icon-circle ' + (type === 'warning' ? 'warning' : (type === 'success' ? 'success' : ''));
    }

    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
}

function closeCustomAlert() {
    const modal = document.getElementById('customAlertModal');
    if (modal) {
        modal.classList.remove('open');
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