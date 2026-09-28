let revenueChart = null;
let chartData = {
    monthsLabels: [],
    monthlyCoffee: [],
    monthlyStrawberry: [],
    monthlyPandan: [],
    monthlyOther: [],
    yearsLabels: [],
    yearlyCoffee: [],
    yearlyStrawberry: [],
    yearlyPandan: [],
    yearlyOther: []
};

// Live figures from /api/ceo/dashboard (used by the PDF export too)
let dashboardStats = { totalSales: null, netMarginPct: null, activeStaff: null };
let dashboardBenchmarks = null;
let rosterStaff = [];

// Major Approvals (> ₱500) State
let pendingMajorApprovals = [];
let currentAppPage = 1;
const APP_PAGE_SIZE = 4;

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

    fetchCeoDashboardData();

    // Search filter listener for pending approvals
    document.getElementById('ceoSearchInput')?.addEventListener('input', (e) => {
        applyApprovalsFilter(e.target.value.toLowerCase().trim());
    });

    // Pagination button listeners
    document.getElementById('prevAppBtn')?.addEventListener('click', () => {
        if (currentAppPage > 1) {
            currentAppPage--;
            renderApprovalsTable();
        }
    });

    document.getElementById('nextAppBtn')?.addEventListener('click', () => {
        const totalPages = Math.ceil(pendingMajorApprovals.length / APP_PAGE_SIZE) || 1;
        if (currentAppPage < totalPages) {
            currentAppPage++;
            renderApprovalsTable();
        }
    });
});

const peso = (n) => '₱' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
}

async function fetchCeoDashboardData() {
    try {
        const response = await fetch('/api/ceo/dashboard');
        if (!response.ok) throw new Error('Failed to load CEO dashboard data');
        const data = await response.json();

        // 1. Profile Header (real logged-in CEO; nothing is invented if it is missing)
        const fullName = data.user?.fullName || '';
        setText('userFullNameDisplay', fullName || '—');
        const firstName = fullName.split(' ')[0];
        setText('greetingName', firstName ? ', ' + firstName : '');
        const userAvatarEl = document.getElementById('userAvatarImg');
        if (userAvatarEl && data.user?.avatarSrc) userAvatarEl.src = data.user.avatarSrc;

        // 2. Overview stats
        const stats = data.stats || {};
        dashboardStats = {
            totalSales: Number(stats.totalSales || 0),
            netMarginPct: stats.netMarginPct === null || stats.netMarginPct === undefined ? null : Number(stats.netMarginPct),
            activeStaff: Number(stats.activeStaff || 0)
        };

        setText('statSales', peso(dashboardStats.totalSales));

        const marginEl = document.getElementById('statMargin');
        if (marginEl) {
            if (dashboardStats.netMarginPct === null) {
                marginEl.textContent = '—';
                marginEl.style.color = '';
                setText('statMarginNote', 'No COGS recorded yet');
            } else {
                marginEl.textContent = dashboardStats.netMarginPct + '%';
                marginEl.style.color = dashboardStats.netMarginPct >= 0 ? '#2E7D32' : '#C9302C';
                setText('statMarginNote', 'Net of recorded COGS');
            }
        }

        // 3. Benchmarks (only what the system can actually measure)
        dashboardBenchmarks = data.benchmarks || null;
        if (typeof applyBenchmarks === 'function') applyBenchmarks(dashboardBenchmarks);

        // 4. Revenue chart (real, current-year monthly + last 4 years)
        if (data.chart) {
            chartData.monthsLabels = data.chart.months || [];
            chartData.yearsLabels = data.chart.years || [];
            chartData.monthlyCoffee = data.chart.monthlyCoffee || [];
            chartData.monthlyStrawberry = data.chart.monthlyStrawberry || [];
            chartData.monthlyPandan = data.chart.monthlyPandan || [];
            chartData.monthlyOther = data.chart.monthlyOther || [];
            chartData.yearlyCoffee = data.chart.yearlyCoffee || [];
            chartData.yearlyStrawberry = data.chart.yearlyStrawberry || [];
            chartData.yearlyPandan = data.chart.yearlyPandan || [];
            chartData.yearlyOther = data.chart.yearlyOther || [];

            if (revenueChart) revenueChart.destroy();
            initRevenueChart();
        }

        // 5. Pending major requisitions (real PENDING_CEO expenses)
        pendingMajorApprovals = data.pendingApprovals || [];
        currentAppPage = 1;
        setText('statPendingApprovals', pendingMajorApprovals.length);
        renderApprovalsTable();

        // 6. Real active employee accounts
        rosterStaff = data.roster || [];
        setText('statActiveRoster', rosterStaff.length);
        setText('rosterBadge', `${rosterStaff.length} Active`);
        renderActiveRoster();

    } catch (error) {
        console.error('Error fetching CEO dashboard data:', error);
        showDashboardLoadError(error.message);
    }
}

// If the API fails we say so — we never fall back to made-up numbers.
function showDashboardLoadError(message) {
    ['statSales', 'statMargin', 'statActiveRoster', 'statPendingApprovals'].forEach(id => setText(id, '—'));
    setText('rosterBadge', '—');
    if (typeof applyBenchmarks === 'function') applyBenchmarks(null);

    const tbody = document.getElementById('ceoApprovalsTableBody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="5" class="loading-state-text" style="color:#C9302C;">Could not load approvals from the database.</td></tr>';
    const roster = document.getElementById('activeRosterList');
    if (roster) roster.innerHTML = '<div class="loading-state-text" style="color:#C9302C;">Could not load workforce data.</div>';

    MMSwal.fire({
        icon: 'warning',
        title: 'System Notice',
        text: message || 'Could not load dashboard data from the database.'
    });
}

// --------------------------------------------------------------------------
// DOA MAJOR APPROVAL QUEUE (> ₱500)
// --------------------------------------------------------------------------
function applyApprovalsFilter(q) {
    const rows = document.querySelectorAll('#ceoApprovalsTableBody tr');
    rows.forEach(r => {
        const text = r.textContent.toLowerCase();
        r.style.display = (!q || text.includes(q)) ? '' : 'none';
    });
}

function renderApprovalsTable() {
    const tbody = document.getElementById('ceoApprovalsTableBody');
    const pageInfo = document.getElementById('approvalsPageInfo');
    const prevBtn = document.getElementById('prevAppBtn');
    const nextBtn = document.getElementById('nextAppBtn');

    if (!tbody) return;

    if (pendingMajorApprovals.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="loading-state-text" style="color:#2E7D32;">All major procurement requests cleared. Zero escalations pending.</td></tr>';
        if (pageInfo) pageInfo.textContent = 'Showing 0 of 0 requests';
        if (prevBtn) prevBtn.disabled = true;
        if (nextBtn) nextBtn.disabled = true;
        return;
    }

    const totalPages = Math.ceil(pendingMajorApprovals.length / APP_PAGE_SIZE) || 1;
    if (currentAppPage > totalPages) currentAppPage = totalPages;
    const startIndex = (currentAppPage - 1) * APP_PAGE_SIZE;
    const pageItems = pendingMajorApprovals.slice(startIndex, startIndex + APP_PAGE_SIZE);

    if (pageInfo) {
        const startNum = startIndex + 1;
        const endNum = Math.min(startIndex + APP_PAGE_SIZE, pendingMajorApprovals.length);
        pageInfo.textContent = `Showing ${startNum}-${endNum} of ${pendingMajorApprovals.length} requests`;
    }
    if (prevBtn) prevBtn.disabled = currentAppPage <= 1;
    if (nextBtn) nextBtn.disabled = currentAppPage >= totalPages;

    tbody.innerHTML = pageItems.map(item => {
        const costStr = peso(item.amount);

        return `
            <tr>
                <td>
                    <strong style="color: var(--brown-soft); font-size: 13px;">${escapeHtml(item.item_name)}</strong>
                    <div style="font-size: 11px; color: var(--text-muted);">${escapeHtml(item.pr_code)}</div>
                </td>
                <td><span style="font-weight: 700; color: var(--text-dark);">${escapeHtml(item.department || '—')}</span></td>
                <td><span style="font-size: 12px; color: var(--text-muted);">${escapeHtml(item.supplier || '—')}</span></td>
                <td><strong style="color: #C9302C; font-family: var(--font-family-heading); font-size: 14px;">${costStr}</strong></td>
                <td style="text-align: right;">
                    <div class="table-action-btns">
                        <button type="button" class="btn-ceo-approve" onclick="handleCeoDecision(${Number(item.id)}, 'approve')">
                            Approve &amp; Sign
                        </button>
                        <button type="button" class="btn-ceo-reject" onclick="handleCeoDecision(${Number(item.id)}, 'reject')">
                            Reject
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

// Decision handler — the decision is saved to the database, then the queue is reloaded.
async function handleCeoDecision(reqId, decision) {
    const item = pendingMajorApprovals.find(i => i.id === reqId);
    if (!item) return;

    let reason = null;

    if (decision === 'approve') {
        const res = await MMSwal.fire({
            title: 'Authorize Major Capital Release?',
            html: `Sign off on procurement requisition <strong>"${escapeHtml(item.item_name)}"</strong> for <strong>${peso(item.amount)}</strong>? This authorises Procurement to execute vendor PO.`,
            icon: 'question',
            showCancelButton: true,
            confirmButtonText: 'Yes, Authorize &amp; Sign',
            cancelButtonText: 'Cancel'
        });
        if (!res.isConfirmed) return;
    } else {
        const { value } = await MMSwal.fire({
            title: 'Reject Requisition',
            input: 'textarea',
            inputLabel: 'Reason for Executive Rejection',
            inputPlaceholder: 'State reason for deferral or rejection...',
            showCancelButton: true,
            confirmButtonText: 'Confirm Rejection',
            inputValidator: (val) => {
                if (!val || val.trim().length === 0) return 'Please provide a justification.';
            }
        });
        if (!value) return;
        reason = value.trim();
    }

    try {
        const response = await fetch('/api/ceo/budget-approval/action', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'expense', id: reqId, action: decision, rejection_reason: reason })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || result.status !== 'success') {
            throw new Error(result.message || 'The server did not accept this decision.');
        }

        await MMSwal.fire(decision === 'approve'
            ? { icon: 'success', title: 'Capital Authorized', text: `Requisition for "${item.item_name}" has been cleared for execution.` }
            : { icon: 'info', title: 'Requisition Rejected', text: `Requisition "${item.item_name}" returned to requester.` });

        pendingMajorApprovals = pendingMajorApprovals.filter(i => i.id !== reqId);
        setText('statPendingApprovals', pendingMajorApprovals.length);
        renderApprovalsTable();
    } catch (err) {
        console.error('CEO decision failed:', err);
        MMSwal.fire({ icon: 'warning', title: 'Update Failed', text: err.message || 'Could not save the decision.' });
        fetchCeoDashboardData(); // resync with the database
    }
}

// --------------------------------------------------------------------------
// ACTIVE WORKFORCE (real active employee accounts, from the database)
// --------------------------------------------------------------------------
function renderActiveRoster() {
    const container = document.getElementById('activeRosterList');
    if (!container) return;

    if (!rosterStaff.length) {
        container.innerHTML = '<div class="loading-state-text">No active employee accounts found.</div>';
        return;
    }

    container.innerHTML = rosterStaff.map(staff => `
        <div class="roster-item-tile">
            <div class="roster-item-left">
                <div class="roster-avatar-sm">
                    <img src="${escapeHtml(staff.avatar || '/customer/images/account.png')}" alt="${escapeHtml(staff.name)}" class="roster-avatar-img">
                </div>
                <div>
                    <div class="roster-name">${escapeHtml(staff.name)}</div>
                    <div class="roster-station">${escapeHtml(staff.role)}</div>
                </div>
            </div>
            <span class="badge-roster-duty">Active</span>
        </div>
    `).join('');
}

// --------------------------------------------------------------------------
// REVENUE TRAJECTORY CHART (CHART.JS)
// --------------------------------------------------------------------------
function initRevenueChart() {
    const ctx = document.getElementById('revenueChart')?.getContext('2d');
    if (!ctx) return;

    revenueChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: chartData.monthsLabels,
            datasets: [
                {
                    label: 'Coffee Jelly',
                    data: chartData.monthlyCoffee,
                    borderColor: '#8b78ff',
                    backgroundColor: '#8b78ff',
                    borderWidth: 2.2,
                    pointRadius: 4,
                    pointBackgroundColor: '#fff',
                    pointBorderColor: '#8b78ff',
                    tension: 0.25
                },
                {
                    label: 'Strawberry Marble',
                    data: chartData.monthlyStrawberry,
                    borderColor: '#ff8579',
                    backgroundColor: '#ff8579',
                    borderWidth: 2.2,
                    pointRadius: 4,
                    pointBackgroundColor: '#fff',
                    pointBorderColor: '#ff8579',
                    tension: 0.25
                },
                {
                    label: 'Pandan Bliss',
                    data: chartData.monthlyPandan,
                    borderColor: '#38c8db',
                    backgroundColor: '#38c8db',
                    borderWidth: 2.2,
                    pointRadius: 4,
                    pointBackgroundColor: '#fff',
                    pointBorderColor: '#38c8db',
                    tension: 0.25
                },
                {
                    label: 'Other Flavors',
                    data: chartData.monthlyOther,
                    borderColor: '#9a8f88',
                    backgroundColor: '#9a8f88',
                    borderWidth: 2.2,
                    pointRadius: 4,
                    pointBackgroundColor: '#fff',
                    pointBorderColor: '#9a8f88',
                    tension: 0.25
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        usePointStyle: true,
                        pointStyle: 'circle',
                        padding: 16,
                        font: { size: 11, family: 'Urbanist', weight: '700' }
                    }
                }
            },
            scales: {
                x: {
                    grid: { color: 'rgba(246, 146, 153, 0.15)', drawBorder: false },
                    ticks: { font: { size: 11, family: 'Urbanist', weight: '700' }, color: '#7C4F38' }
                },
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: function (val) { return '₱' + Number(val).toLocaleString(); },
                        font: { size: 10, family: 'Urbanist', weight: '600' },
                        color: '#7C4F38'
                    },
                    grid: { color: 'rgba(246, 146, 153, 0.15)', drawBorder: false }
                }
            }
        }
    });

    const btnMonths = document.getElementById('btnMonths');
    const btnYears = document.getElementById('btnYears');

    btnMonths?.addEventListener('click', function () {
        btnMonths.classList.add('active');
        btnYears.classList.remove('active');
        revenueChart.data.labels = chartData.monthsLabels;
        revenueChart.data.datasets[0].data = chartData.monthlyCoffee;
        revenueChart.data.datasets[1].data = chartData.monthlyStrawberry;
        revenueChart.data.datasets[2].data = chartData.monthlyPandan;
        revenueChart.data.datasets[3].data = chartData.monthlyOther;
        revenueChart.update();
    });

    btnYears?.addEventListener('click', function () {
        btnYears.classList.add('active');
        btnMonths.classList.remove('active');
        revenueChart.data.labels = chartData.yearsLabels;
        revenueChart.data.datasets[0].data = chartData.yearlyCoffee;
        revenueChart.data.datasets[1].data = chartData.yearlyStrawberry;
        revenueChart.data.datasets[2].data = chartData.yearlyPandan;
        revenueChart.data.datasets[3].data = chartData.yearlyOther;
        revenueChart.update();
    });
}

// --------------------------------------------------------------------------
// THE SINGLE OFFICIAL EXECUTIVE PDF EXPORT
// Fills the hidden "Executive Command Center Summary" template with the
// dashboard's live KPIs, revenue trend, pending approvals and roster, then
// renders it to a downloadable PDF (same html2pdf engine used across the
// other officer report pages) instead of printing the raw dashboard page.
// --------------------------------------------------------------------------
function populateExecutiveSummaryTemplate() {
    const wrapper = document.getElementById('corporatePdfRenderWrapper');
    if (!wrapper) return null;

    const todayStr = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    const setText = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    };

    setText('pdfMetaDate', `Date: ${todayStr}`);

    const nameText = document.getElementById('userFullNameDisplay')?.textContent?.trim() || '';
    const fullName = nameText === '—' ? '' : nameText;
    setText('pdfMetaOfficer', 'CEO');
    setText('pdfSignOfficer', fullName);

    // 1. Macro KPI Summary — every value is the live figure shown on the dashboard.
    const bm = dashboardBenchmarks || {};
    const bmText = (v, unit) => (v === null || v === undefined) ? '—' : `${Number(v).toLocaleString('en-US', { maximumFractionDigits: 1 })}${unit}`;
    const noData = 'Not tracked by the system yet';
    const salesText = dashboardStats.totalSales === null ? '—' : peso(dashboardStats.totalSales);
    const marginText = dashboardStats.netMarginPct === null ? '—' : `${dashboardStats.netMarginPct}%`;
    const approvalsCount = pendingMajorApprovals.length;
    const rosterCount = dashboardStats.activeStaff === null ? '—' : String(dashboardStats.activeStaff);

    const kpiRows = [
        ['Total Realized Revenue', salesText, 'Paid & completed orders'],
        ['Net Operating Margin', marginText, dashboardStats.netMarginPct === null ? 'No COGS recorded yet' : 'Net of recorded COGS'],
        ['Days Sales Outstanding (DSO)', bmText(bm.dso, ' Days'), bm.dso == null ? noData : 'Target: < 45 Days'],
        ['Order-to-Cash Cycle', bmText(bm.o2c, ' Days'), bm.o2c == null ? noData : 'Target: < 5 Days'],
        ['On-Time Fulfillment (OTD)', bmText(bm.otd, '%'), bm.otd == null ? noData : 'Target: > 95%'],
        ['First-Pass Yield (FPY)', bmText(bm.fpy, '%'), bm.fpy == null ? noData : 'Target: > 90%'],
        ['Pending Major Approvals (> ₱500)', String(approvalsCount), approvalsCount > 0 ? 'Awaiting CEO sign-off' : 'Queue clear'],
        ['Active Employee Accounts', rosterCount, 'Active staff accounts']
    ];

    const kpiBody = document.getElementById('pdfKpiTableBody');
    if (kpiBody) {
        kpiBody.innerHTML = kpiRows.map(([metric, value, notes]) => `
            <tr>
                <td>${escapeHtml(metric)}</td>
                <td><strong>${escapeHtml(value)}</strong></td>
                <td>${escapeHtml(notes)}</td>
            </tr>
        `).join('');
    }

    // 2. Revenue Trajectory Summary (last 3 months of data on hand)
    const revenueBody = document.getElementById('pdfRevenueTableBody');
    if (revenueBody) {
        const months = chartData.monthsLabels || [];
        const currentMonth = new Date().getMonth();
        const endIdx = Math.min(currentMonth + 1, months.length);
        const startIdx = Math.max(0, endIdx - 3);
        const rows = [];

        for (let i = startIdx; i < endIdx; i++) {
            const coffee = Number(chartData.monthlyCoffee[i] || 0);
            const strawberry = Number(chartData.monthlyStrawberry[i] || 0);
            const pandan = Number(chartData.monthlyPandan[i] || 0);
            const other = Number(chartData.monthlyOther[i] || 0);
            const total = coffee + strawberry + pandan + other;

            rows.push(`
                <tr>
                    <td>${escapeHtml(months[i])}</td>
                    <td>${peso(coffee)}</td>
                    <td>${peso(strawberry)}</td>
                    <td>${peso(pandan)}</td>
                    <td>${peso(other)}</td>
                    <td><strong>${peso(total)}</strong></td>
                </tr>
            `);
        }

        revenueBody.innerHTML = rows.length ? rows.join('') : '<tr><td colspan="6" class="loading-state-text">No revenue data available for this period.</td></tr>';
    }

    // 3. Major DOA Approvals Pending
    const approvalsBody = document.getElementById('pdfApprovalsTableBody');
    if (approvalsBody) {
        if (pendingMajorApprovals.length === 0) {
            approvalsBody.innerHTML = '<tr><td colspan="4" class="loading-state-text" style="color:#2E7D32;">All major procurement requests cleared. Zero escalations pending.</td></tr>';
        } else {
            approvalsBody.innerHTML = pendingMajorApprovals.map(item => {
                const amount = '₱' + Number(item.amount || item.total_cost || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                return `
                    <tr>
                        <td>${escapeHtml(item.item_name)} <div style="font-size: 10px; color: #8C7A70;">${escapeHtml(item.pr_code)}</div></td>
                        <td>${escapeHtml(item.department || '—')}</td>
                        <td>${escapeHtml(item.supplier || '—')}</td>
                        <td><strong>${amount}</strong></td>
                    </tr>
                `;
            }).join('');
        }
    }

    // 4. Active Workforce Roster
    const rosterBody = document.getElementById('pdfRosterTableBody');
    if (rosterBody) {
        const rosterItems = document.querySelectorAll('#activeRosterList .roster-item-tile');
        if (rosterItems.length === 0) {
            rosterBody.innerHTML = '<tr><td colspan="3" class="loading-state-text">No active employee accounts.</td></tr>';
        } else {
            rosterBody.innerHTML = Array.from(rosterItems).map(tile => {
                const name = tile.querySelector('.roster-name')?.textContent?.trim() || '—';
                const role = tile.querySelector('.roster-station')?.textContent?.trim() || '';
                const status = tile.querySelector('.badge-roster-duty')?.textContent?.trim() || 'Active';

                return `
                    <tr>
                        <td>${escapeHtml(name)}</td>
                        <td>${escapeHtml(role || '—')}</td>
                        <td>${escapeHtml(status)}</td>
                    </tr>
                `;
            }).join('');
        }
    }

    return wrapper;
}

// --------------------------------------------------------------------------
// PREVIEW MODAL — shows the filled-in summary before anything is exported.
// The hidden template is reparented into the modal's scroll pane so the
// preview and the eventual PDF are rendered from the exact same DOM node.
// --------------------------------------------------------------------------
function previewExecutiveSummary() {
    const wrapper = populateExecutiveSummaryTemplate();
    if (!wrapper) return;

    const overlay = document.getElementById('pdfPreviewOverlay');
    const scrollPane = document.getElementById('pdfPreviewScroll');
    const closeBtn = document.getElementById('pdfPreviewCloseBtn');
    const exportBtn = document.getElementById('pdfPreviewExportBtn');
    if (!overlay || !scrollPane || !closeBtn || !exportBtn) return;

    scrollPane.appendChild(wrapper);
    wrapper.style.display = 'block';
    overlay.style.display = 'flex';
    scrollPane.scrollTop = 0;

    function closePreview() {
        overlay.style.display = 'none';
        wrapper.style.display = 'none';
        document.body.appendChild(wrapper);
        closeBtn.removeEventListener('click', closePreview);
        overlay.removeEventListener('click', onBackdropClick);
        exportBtn.removeEventListener('click', onExportClick);
    }

    function onBackdropClick(e) {
        if (e.target === overlay) closePreview();
    }

    async function onExportClick() {
        await generateExecutivePdf(wrapper);
        closePreview();
    }

    closeBtn.addEventListener('click', closePreview);
    overlay.addEventListener('click', onBackdropClick);
    exportBtn.addEventListener('click', onExportClick);
}

// --------------------------------------------------------------------------
// ACTUAL PDF EXPORT — runs only once the officer confirms from the preview.
// --------------------------------------------------------------------------
async function generateExecutivePdf(wrapper) {
    MMSwal.fire({
        title: 'Compiling Executive Summary',
        html: 'Formatting KPIs, revenue and approvals into an official PDF summary...',
        allowOutsideClick: false,
        didOpen: () => {
            MMSwal.showLoading();
        }
    });

    const opt = {
        margin: [8, 10, 8, 10],
        filename: `MilkyMarble_Executive_Summary_${new Date().toISOString().split('T')[0]}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, logging: false },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };

    try {
        await html2pdf().set(opt).from(wrapper).save();

        MMSwal.fire({
            icon: 'success',
            title: 'Executive Summary Generated',
            text: 'Your CEO summary PDF has been downloaded.'
        });
    } catch (err) {
        console.error('Executive PDF export failed:', err);
        MMSwal.fire({
            icon: 'warning',
            title: 'Export Failed',
            text: err.message || 'Could not compile the executive summary PDF.'
        });
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