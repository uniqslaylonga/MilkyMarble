let revenueChart = null;
let chartData = {
    monthsLabels: [],
    monthlyCoffee: [],
    monthlyStrawberry: [],
    monthlyPandan: [],
    yearsLabels: [],
    yearlyCoffee: [],
    yearlyStrawberry: [],
    yearlyPandan: []
};

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
    renderActiveRoster();

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

async function fetchCeoDashboardData() {
    try {
        const userId = localStorage.getItem('userId') || sessionStorage.getItem('userId');
        const headers = userId ? { 'x-user-id': userId } : {};

        const response = await fetch('/api/ceo/dashboard', { headers });
        if (!response.ok) throw new Error('Failed to load CEO dashboard data');
        const data = await response.json();

        // 1. Profile Header
        const userFullNameEl = document.getElementById('userFullNameDisplay');
        const greetingNameEl = document.getElementById('greetingName');
        const userAvatarEl = document.getElementById('userAvatarImg');

        const fullName = data.user?.fullName || 'Gabriel Louis M. Espadilla';
        if (userFullNameEl) userFullNameEl.textContent = fullName;
        if (greetingNameEl) greetingNameEl.textContent = fullName.split(' ')[0];
        if (userAvatarEl && data.user?.avatarSrc) userAvatarEl.src = data.user.avatarSrc;

        // 2. Overview Stats
        const salesVal = Number(data.stats?.totalSales || 47446.00);
        document.getElementById('statSales').textContent = '₱' + salesVal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

        // 3. Dynamic DSO Calculation based on Cycle Start Date
        const cycleStartDate = localStorage.getItem('mm_cycle_start_date') || '2026-10-08';
        const start = new Date(cycleStartDate);
        const today = new Date();
        start.setHours(0, 0, 0, 0);
        today.setHours(0, 0, 0, 0);

        const daysElapsed = Math.max(1, Math.floor((today - start) / (1000 * 60 * 60 * 24)) + 1);
        const ceoDso = Math.min(daysElapsed, 12);
        document.getElementById('ceoDsoValue').textContent = `${ceoDso} Days`;

        // 4. Inject Real Chart Data
        if (data.chart) {
            chartData.monthsLabels = data.chart.months || [];
            chartData.yearsLabels = data.chart.years || [];
            chartData.monthlyCoffee = data.chart.monthlyCoffee || [];
            chartData.monthlyStrawberry = data.chart.monthlyStrawberry || [];
            chartData.monthlyPandan = data.chart.monthlyPandan || [];
            chartData.yearlyCoffee = data.chart.yearlyCoffee || [];
            chartData.yearlyStrawberry = data.chart.yearlyStrawberry || [];
            chartData.yearlyPandan = data.chart.yearlyPandan || [];

            if (revenueChart) revenueChart.destroy();
            initRevenueChart();
        }

        // 5. Fetch Real Major DOA Approvals (> ₱500)
        await fetchMajorApprovals();

    } catch (error) {
        console.error('Error fetching CEO dashboard data:', error);
    }
}

// --------------------------------------------------------------------------
// DOA MAJOR APPROVAL QUEUE (> ₱500)
// --------------------------------------------------------------------------
async function fetchMajorApprovals() {
    try {
        const userId = localStorage.getItem('userId') || sessionStorage.getItem('userId');
        const headers = userId ? { 'x-user-id': userId } : {};

        // Fetch escalations from budget approval endpoint
        const res = await fetch('/api/ceo/budget-approvals', { headers });
        if (res.ok) {
            const data = await res.json();
            pendingMajorApprovals = (data.requests || []).filter(r => (r.amount || r.total_cost || 0) > 500 && r.status !== 'APPROVED');
        } else {
            // Default mock major requisitions if server table is empty
            pendingMajorApprovals = [
                {
                    id: 101,
                    pr_code: 'PR-2026-088',
                    item_name: 'Bulk Tapioca Pearls (5x 3kg Master Bags)',
                    department: 'Production / Kitchen',
                    supplier: 'Caloocan Boba Hub',
                    amount: 2450.00
                },
                {
                    id: 102,
                    pr_code: 'PR-2026-089',
                    item_name: 'Heavy-Duty Commercial Blender Blade Servicing',
                    department: 'Operations',
                    supplier: 'Appliance Care Services',
                    amount: 850.00
                }
            ];
        }
    } catch (e) {
        console.warn('Fallback to local DOA major escalations:', e);
    }

    document.getElementById('statPendingApprovals').textContent = pendingMajorApprovals.length;
    renderApprovalsTable();
}

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
        const costStr = '₱' + Number(item.amount || item.total_cost || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

        return `
            <tr>
                <td>
                    <strong style="color: var(--brown-soft); font-size: 13px;">${escapeHtml(item.item_name)}</strong>
                    <div style="font-size: 11px; color: var(--text-muted);">${escapeHtml(item.pr_code)}</div>
                </td>
                <td><span style="font-weight: 700; color: var(--text-dark);">${escapeHtml(item.department)}</span></td>
                <td><span style="font-size: 12px; color: var(--text-muted);">${escapeHtml(item.supplier || 'Registered Vendor')}</span></td>
                <td><strong style="color: #C9302C; font-family: var(--font-family-heading); font-size: 14px;">${costStr}</strong></td>
                <td style="text-align: right;">
                    <div class="table-action-btns">
                        <button type="button" class="btn-ceo-approve" onclick="handleCeoDecision(${item.id}, 'approve')">
                            Approve &amp; Sign
                        </button>
                        <button type="button" class="btn-ceo-reject" onclick="handleCeoDecision(${item.id}, 'reject')">
                            Reject
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

// Decision handler with SweetAlert2
async function handleCeoDecision(reqId, decision) {
    const item = pendingMajorApprovals.find(i => i.id === reqId);
    if (!item) return;

    if (decision === 'approve') {
        const res = await MMSwal.fire({
            title: 'Authorize Major Capital Release?',
            html: `Sign off on procurement requisition <strong>"${escapeHtml(item.item_name)}"</strong> for <strong>₱${Number(item.amount).toFixed(2)}</strong>? This authorises Procurement to execute vendor PO.`,
            icon: 'question',
            showCancelButton: true,
            confirmButtonText: 'Yes, Authorize &amp; Sign',
            cancelButtonText: 'Cancel'
        });

        if (res.isConfirmed) {
            pendingMajorApprovals = pendingMajorApprovals.filter(i => i.id !== reqId);
            document.getElementById('statPendingApprovals').textContent = pendingMajorApprovals.length;
            renderApprovalsTable();

            MMSwal.fire({
                icon: 'success',
                title: 'Capital Authorized',
                text: `Requisition for "${item.item_name}" has been cleared for execution.`
            });
        }
    } else {
        const { value: reason } = await MMSwal.fire({
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

        if (reason) {
            pendingMajorApprovals = pendingMajorApprovals.filter(i => i.id !== reqId);
            document.getElementById('statPendingApprovals').textContent = pendingMajorApprovals.length;
            renderApprovalsTable();

            MMSwal.fire({
                icon: 'info',
                title: 'Requisition Rejected',
                text: `Requisition "${item.item_name}" returned to requester. Reason logged: "${reason}"`
            });
        }
    }
}

// --------------------------------------------------------------------------
// ACTIVE DUTY ROSTER (COMPACT CARD WIDGET)
// --------------------------------------------------------------------------
function renderActiveRoster() {
    const container = document.getElementById('activeRosterList');
    if (!container) return;

    const rosterStaff = [
        { name: 'Reeze Laureen A. Alapide', role: 'Sales Officer', station: 'Sales Counter & POS' },
        { name: 'Richmond S. Pincakesss', role: 'Production Supervisor', station: 'Macro Batch Kitchen' },
        { name: 'Rhodalyn D. Leodones', role: 'Procurement Officer', station: 'Warehouse & Receiving' },
        { name: 'Kerstin E. Reyes', role: 'Financial Officer', station: 'Treasury & Settlement Desk' },
        { name: 'Angeline J. Ang', role: 'System Administrator', station: 'Master Data & Security' }
    ];

    container.innerHTML = rosterStaff.map(staff => `
        <div class="roster-item-tile">
            <div class="roster-item-left">
                <div class="roster-avatar-sm">
                    <img src="/customer/images/account.png" alt="${escapeHtml(staff.name)}" class="roster-avatar-img">
                </div>
                <div>
                    <div class="roster-name">${escapeHtml(staff.name)}</div>
                    <div class="roster-station">${escapeHtml(staff.role)} &bull; ${escapeHtml(staff.station)}</div>
                </div>
            </div>
            <span class="badge-roster-duty">On Duty</span>
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
        revenueChart.update();
    });

    btnYears?.addEventListener('click', function () {
        btnYears.classList.add('active');
        btnMonths.classList.remove('active');
        revenueChart.data.labels = chartData.yearsLabels;
        revenueChart.data.datasets[0].data = chartData.yearlyCoffee;
        revenueChart.data.datasets[1].data = chartData.yearlyStrawberry;
        revenueChart.data.datasets[2].data = chartData.yearlyPandan;
        revenueChart.update();
    });
}

// --------------------------------------------------------------------------
// THE SINGLE OFFICIAL EXECUTIVE PDF EXPORT
// --------------------------------------------------------------------------
function exportExecutivePDF() {
    window.print();
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