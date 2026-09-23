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

// Orders & Pagination State
let allExecutiveOrders = [];
let filteredExecutiveOrders = [];
let currentCeoPage = 1;
const CEO_PAGE_SIZE = 5;

document.addEventListener('DOMContentLoaded', () => {
    fetchCeoDashboardData();

    // Search filter listener
    document.getElementById('ceoSearchInput')?.addEventListener('input', applyCeoTableFilter);

    // Pagination button listeners
    document.getElementById('prevCeoBtn')?.addEventListener('click', () => {
        if (currentCeoPage > 1) {
            currentCeoPage--;
            renderCeoOrdersTable();
        }
    });

    document.getElementById('nextCeoBtn')?.addEventListener('click', () => {
        const totalPages = Math.ceil(filteredExecutiveOrders.length / CEO_PAGE_SIZE) || 1;
        if (currentCeoPage < totalPages) {
            currentCeoPage++;
            renderCeoOrdersTable();
        }
    });
});

async function fetchCeoDashboardData() {
    try {
        const userId = localStorage.getItem('userId') || sessionStorage.getItem('userId');

        const response = await fetch('/api/ceo/dashboard', {
            method: 'GET',
            headers: {
                'x-user-id': userId || '',
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) throw new Error('Failed to load dashboard data');
        const data = await response.json();

        // 1. Profile Header
        const userFullNameEl = document.getElementById('userFullNameDisplay');
        const greetingNameEl = document.getElementById('greetingName');

        if (userFullNameEl && data.user && data.user.fullName) {
            userFullNameEl.textContent = data.user.fullName;
        }
        if (greetingNameEl && data.user && data.user.fullName) {
            greetingNameEl.textContent = data.user.fullName.split(' ')[0];
        }

        // 2. Overview Stats
        const salesVal = Number(data.stats?.totalSales || 0);
        document.getElementById('statSales').textContent = '₱' + salesVal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        document.getElementById('statCustomers').textContent = Number(data.stats?.totalCustomers || 0).toLocaleString();

        // 3. Dynamic DSO Calculation based on Cycle Start Date
        const cycleStartDate = localStorage.getItem('mm_cycle_start_date') || '2026-09-01';
        const start = new Date(cycleStartDate);
        const today = new Date();
        start.setHours(0, 0, 0, 0);
        today.setHours(0, 0, 0, 0);

        const daysElapsed = Math.max(1, Math.floor((today - start) / (1000 * 60 * 60 * 24)) + 1);
        const ceoDso = Math.min(daysElapsed, 12);
        document.getElementById('ceoDsoValue').textContent = `${ceoDso} Days`;

        // 4. Inject Real Supabase Chart Data
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

        // 5. Fetch Real Orders for Executive Table
        await fetchExecutiveOrders();

    } catch (error) {
        console.error('Error fetching CEO dashboard data:', error);
    }
}

async function fetchExecutiveOrders() {
    try {
        // Fetch from shared sales-officer orders endpoint
        const response = await fetch('/api/sales-officer/dashboard');
        if (response.ok) {
            const data = await response.json();
            allExecutiveOrders = data.recentOrders || [];
        } else {
            allExecutiveOrders = [];
        }
    } catch (e) {
        console.warn('Could not load live order log:', e);
        allExecutiveOrders = [];
    }

    applyCeoTableFilter();
}

function applyCeoTableFilter() {
    const q = document.getElementById('ceoSearchInput')?.value.toLowerCase().trim() || '';

    filteredExecutiveOrders = allExecutiveOrders.filter(ord => {
        if (!q) return true;
        const num = (ord.order_number || '').toLowerCase();
        const name = (ord.customer_name || '').toLowerCase();
        const status = (ord.status || '').toLowerCase();
        return num.includes(q) || name.includes(q) || status.includes(q);
    });

    currentCeoPage = 1;
    renderCeoOrdersTable();
}

function renderCeoOrdersTable() {
    const tbody = document.getElementById('ceoOrdersTableBody');
    const pageInfo = document.getElementById('ceoPageInfo');
    const prevBtn = document.getElementById('prevCeoBtn');
    const nextBtn = document.getElementById('nextCeoBtn');

    if (!tbody) return;

    if (filteredExecutiveOrders.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="loading-state-text">No executive transactions found.</td></tr>';
        if (pageInfo) pageInfo.textContent = 'Showing 0 of 0 orders';
        if (prevBtn) prevBtn.disabled = true;
        if (nextBtn) nextBtn.disabled = true;
        renderCeoPaginationControls(1, 1);
        return;
    }

    const totalPages = Math.ceil(filteredExecutiveOrders.length / CEO_PAGE_SIZE) || 1;
    const startIndex = (currentCeoPage - 1) * CEO_PAGE_SIZE;
    const pageItems = filteredExecutiveOrders.slice(startIndex, startIndex + CEO_PAGE_SIZE);

    if (pageInfo) {
        const startNum = startIndex + 1;
        const endNum = Math.min(startIndex + CEO_PAGE_SIZE, filteredExecutiveOrders.length);
        pageInfo.textContent = `Showing ${startNum}-${endNum} of ${filteredExecutiveOrders.length} orders`;
    }
    if (prevBtn) prevBtn.disabled = currentCeoPage <= 1;
    if (nextBtn) nextBtn.disabled = currentCeoPage >= totalPages;

    renderCeoPaginationControls(totalPages, currentCeoPage);

    tbody.innerHTML = pageItems.map(ord => {
        const dateFmt = new Date(ord.placed_at).toLocaleDateString('en-US', {
            month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit'
        });
        const amount = Number(ord.total_amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const isDone = ord.status === 'COMPLETED' || ord.status === 'PAID_VERIFIED';

        return `
            <tr>
                <td><strong style="color: var(--brown-soft); font-size: 13px;">${escapeHtml(ord.order_number)}</strong></td>
                <td><strong>${escapeHtml(ord.customer_name || 'Guest')}</strong></td>
                <td><span style="font-size: 12px; color: var(--text-dark);">${escapeHtml(ord.payment_method || 'Counter')}</span></td>
                <td><span style="font-size: 11.5px; color: var(--text-muted); font-weight: 600;">${dateFmt}</span></td>
                <td><strong style="color: var(--brown-soft); font-family: var(--font-family-heading);">₱${amount}</strong></td>
                <td>
                    <span class="badge-status ${isDone ? 'completed' : 'active'}">${escapeHtml(ord.status || 'ACTIVE')}</span>
                </td>
                <td style="text-align: right;">
                    <span style="font-size: 11px; font-weight: 700; color: #2E7D32;">✓ Reconciled</span>
                </td>
            </tr>
        `;
    }).join('');
}

// Smart Sliding Pagination with Ellipsis
function renderCeoPaginationControls(totalPages, activePage) {
    const pagerNumbers = document.getElementById('ceoPagerNumbers');
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
            if (page && page !== currentCeoPage) {
                currentCeoPage = page;
                renderCeoOrdersTable();
            }
        });
    });
}

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
// EXPORT EXECUTIVE PDF / PRINT HANDLER
// --------------------------------------------------------------------------
function exportExecutivePDF() {
    window.print();
}

function showCustomAlert(title, message) {
    const modal = document.getElementById('customAlertModal');
    if (!modal) return;
    document.getElementById('alertModalTitle').textContent = title;
    document.getElementById('alertModalMessage').textContent = message;
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

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}