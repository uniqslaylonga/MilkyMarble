let revenueAnalyticsChart = null;
let customerDonutChart = null;

let chartAnalyticsData = {
    monthsLabels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
    yearsLabels: ['2024', '2025', '2026', '2027'],
    monthlyCoffee: [2400, 3100, 2800, 4200, 3900, 4800, 5200, 4900, 6100, 5800, 6400, 7200],
    monthlyStrawberry: [1800, 2400, 2200, 3400, 3100, 3800, 4100, 3900, 4900, 4600, 5200, 5900],
    monthlyPandan: [1400, 1900, 1700, 2600, 2400, 2900, 3200, 3100, 3800, 3600, 4100, 4600],
    yearlyCoffee: [28000, 39000, 54000, 68000],
    yearlyStrawberry: [21000, 29000, 42000, 53000],
    yearlyPandan: [16000, 23000, 33000, 41000],
    customerSegments: [31, 14, 2]
};

// Table & Pagination State
let allFlavorAnalytics = [];
let filteredFlavorAnalytics = [];
let currentAnalyticsPage = 1;
const ANALYTICS_PAGE_SIZE = 5;

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

    fetchCeoAnalyticsData();

    // Search filter listener
    document.getElementById('analyticsSearchInput')?.addEventListener('input', applyAnalyticsFilter);

    // Pagination listeners
    document.getElementById('prevAnalyticsBtn')?.addEventListener('click', () => {
        if (currentAnalyticsPage > 1) {
            currentAnalyticsPage--;
            renderAnalyticsTable();
        }
    });

    document.getElementById('nextAnalyticsBtn')?.addEventListener('click', () => {
        const totalPages = Math.ceil(filteredFlavorAnalytics.length / ANALYTICS_PAGE_SIZE) || 1;
        if (currentAnalyticsPage < totalPages) {
            currentAnalyticsPage++;
            renderAnalyticsTable();
        }
    });
});

async function fetchCeoAnalyticsData() {
    try {
        const userId = localStorage.getItem('userId') || sessionStorage.getItem('userId');
        const headers = userId ? { 'x-user-id': userId } : {};

        const response = await fetch('/api/ceo/analytics', {
            method: 'GET',
            headers: {
                ...headers,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) throw new Error('Failed to load CEO analytics data');
        const data = await response.json();

        // 1. Profile Header
        const userFullNameEl = document.getElementById('userFullNameDisplay');
        const userAvatarEl = document.getElementById('userAvatarImg');
        if (userFullNameEl && data.user?.fullName) {
            userFullNameEl.textContent = data.user.fullName;
        }
        if (userAvatarEl && data.user?.avatarSrc) {
            userAvatarEl.src = data.user.avatarSrc;
        }

        // 2. Overview Stats
        if (data.overview) {
            document.getElementById('statNewOrders').textContent = Number(data.overview.newOrders || 185).toLocaleString();
            document.getElementById('statPreOrders').textContent = Number(data.overview.preOrders || 7).toLocaleString();
            document.getElementById('statSales').textContent = '₱' + Number(data.overview.totalSales || 46567).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        }

        // 3. DSO Calculation (45-Day Benchmark)
        const cycleStartDate = localStorage.getItem('mm_cycle_start_date') || '2026-10-08';
        const start = new Date(cycleStartDate);
        const today = new Date();
        start.setHours(0, 0, 0, 0);
        today.setHours(0, 0, 0, 0);
        const daysElapsed = Math.max(1, Math.floor((today - start) / (1000 * 60 * 60 * 24)) + 1);
        const ceoDso = Math.min(daysElapsed, 12);
        document.getElementById('ceoDsoValue').textContent = `${ceoDso} Days`;

        // 4. Line Chart & Donut Chart Setup
        if (data.charts) {
            chartAnalyticsData.monthsLabels = data.charts.monthsLabels || chartAnalyticsData.monthsLabels;
            chartAnalyticsData.yearsLabels = data.charts.yearsLabels || chartAnalyticsData.yearsLabels;
            if (data.charts.monthlyRevCoffee?.length) chartAnalyticsData.monthlyCoffee = data.charts.monthlyRevCoffee;
            if (data.charts.monthlyRevStrawberry?.length) chartAnalyticsData.monthlyStrawberry = data.charts.monthlyRevStrawberry;
            if (data.charts.monthlyRevPandan?.length) chartAnalyticsData.monthlyPandan = data.charts.monthlyRevPandan;
            if (data.charts.customerData?.length) chartAnalyticsData.customerSegments = data.charts.customerData;
        }

        initRevenueAnalyticsChart();
        initCustomerDonutChart();

        // 5. Populate Detailed Flavor Velocity Table
        await fetchFlavorAnalyticsTable();

    } catch (error) {
        console.error('Error loading CEO Analytics:', error);
        initRevenueAnalyticsChart();
        initCustomerDonutChart();
        await fetchFlavorAnalyticsTable();
    }
}

async function fetchFlavorAnalyticsTable() {
    try {
        const response = await fetch('/api/finance-officer/revenue');
        if (response.ok) {
            const data = await response.json();
            allFlavorAnalytics = data.flavorContributions || getSampleFlavorContributions();
        } else {
            allFlavorAnalytics = getSampleFlavorContributions();
        }
    } catch (e) {
        allFlavorAnalytics = getSampleFlavorContributions();
    }
    applyAnalyticsFilter();
}

function getSampleFlavorContributions() {
    return [
        { flavor: 'Classic Coffee Jelly Pearl', category: 'Pearl Milk Tea', sold: 68, revenue: 1020.00, cogs: 544.00, margin: 46.7, status: 'High Yield' },
        { flavor: 'Strawberry Marble Supreme', category: 'Specialty Latte', sold: 54, revenue: 864.00, cogs: 463.00, margin: 46.4, status: 'High Yield' },
        { flavor: 'Buko Pandan Bliss Jelly', category: 'Specialty Latte', sold: 45, revenue: 675.00, cogs: 382.50, margin: 43.3, status: 'High Yield' },
        { flavor: 'Brown Sugar Marble Jelly', category: 'Pearl Milk Tea', sold: 32, revenue: 480.00, cogs: 288.00, margin: 40.0, status: 'Moderate' },
        { flavor: 'Matcha Milk Tea Presets', category: 'Specialty Latte', sold: 26, revenue: 416.00, cogs: 257.90, margin: 38.1, status: 'Moderate' },
        { flavor: 'Wintermelon Marble Sips', category: 'Pearl Milk Tea', sold: 18, revenue: 270.00, cogs: 172.00, margin: 36.3, status: 'Moderate' }
    ];
}

function applyAnalyticsFilter() {
    const q = document.getElementById('analyticsSearchInput')?.value.toLowerCase().trim() || '';

    filteredFlavorAnalytics = allFlavorAnalytics.filter(item => {
        if (!q) return true;
        const name = (item.flavor || item.flavor_name || '').toLowerCase();
        const cat = (item.category || item.category_label || '').toLowerCase();
        return name.includes(q) || cat.includes(q);
    });

    currentAnalyticsPage = 1;
    renderAnalyticsTable();
}

function renderAnalyticsTable() {
    const tbody = document.getElementById('analyticsTableBody');
    const pageInfo = document.getElementById('analyticsPageInfo');
    const prevBtn = document.getElementById('prevAnalyticsBtn');
    const nextBtn = document.getElementById('nextAnalyticsBtn');

    if (!tbody) return;

    if (filteredFlavorAnalytics.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="loading-state-text">No flavor contribution records found.</td></tr>';
        if (pageInfo) pageInfo.textContent = 'Showing 0 of 0 items';
        if (prevBtn) prevBtn.disabled = true;
        if (nextBtn) nextBtn.disabled = true;
        renderAnalyticsPaginationControls(1, 1);
        return;
    }

    const totalPages = Math.ceil(filteredFlavorAnalytics.length / ANALYTICS_PAGE_SIZE) || 1;
    const startIndex = (currentAnalyticsPage - 1) * ANALYTICS_PAGE_SIZE;
    const pageItems = filteredFlavorAnalytics.slice(startIndex, startIndex + ANALYTICS_PAGE_SIZE);

    if (pageInfo) {
        const startNum = startIndex + 1;
        const endNum = Math.min(startIndex + ANALYTICS_PAGE_SIZE, filteredFlavorAnalytics.length);
        pageInfo.textContent = `Showing ${startNum}-${endNum} of ${filteredFlavorAnalytics.length} items`;
    }
    if (prevBtn) prevBtn.disabled = currentAnalyticsPage <= 1;
    if (nextBtn) nextBtn.disabled = currentAnalyticsPage >= totalPages;

    renderAnalyticsPaginationControls(totalPages, currentAnalyticsPage);

    tbody.innerHTML = pageItems.map(item => {
        const name = item.flavor || item.flavor_name || 'Milk Tea Flavor';
        const category = item.category || item.category_label || 'Pearl Milk Tea';
        const sold = item.sold || item.cups_sold || 0;
        const revenue = Number(item.revenue || item.gross_sales || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const cogs = Number(item.cogs || (item.unit_cogs ? item.unit_cogs * sold : 0)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const margin = item.margin || item.net_margin_pct || 42.0;
        const isHigh = margin >= 42;

        return `
            <tr>
                <td><strong style="color: var(--brown-soft); font-size: 13px;">${escapeHtml(name)}</strong></td>
                <td><span style="font-size: 12px; color: var(--text-dark);">${escapeHtml(category)}</span></td>
                <td><strong>${sold} cups</strong></td>
                <td><strong style="color: var(--brown-soft); font-family: var(--font-family-heading);">₱${revenue}</strong></td>
                <td><span style="color: var(--text-muted);">₱${cogs}</span></td>
                <td><strong style="color: ${isHigh ? '#2E7D32' : '#B26A00'};">${margin}%</strong></td>
                <td style="text-align: right;">
                    <span class="badge-perf ${isHigh ? 'perf-high' : 'perf-mid'}">${isHigh ? 'High Yield' : 'Moderate'}</span>
                </td>
            </tr>
        `;
    }).join('');
}

function renderAnalyticsPaginationControls(totalPages, activePage) {
    const pagerNumbers = document.getElementById('analyticsPagerNumbers');
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
            if (page && page !== currentAnalyticsPage) {
                currentAnalyticsPage = page;
                renderAnalyticsTable();
            }
        });
    });
}

function initRevenueAnalyticsChart() {
    const ctx = document.getElementById('revenueAnalyticsChart')?.getContext('2d');
    if (!ctx) return;

    if (revenueAnalyticsChart) revenueAnalyticsChart.destroy();

    revenueAnalyticsChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: chartAnalyticsData.monthsLabels,
            datasets: [
                {
                    label: 'Coffee Jelly',
                    data: chartAnalyticsData.monthlyCoffee,
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
                    data: chartAnalyticsData.monthlyStrawberry,
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
                    data: chartAnalyticsData.monthlyPandan,
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
                    labels: { usePointStyle: true, pointStyle: 'circle', padding: 16, font: { size: 11, family: 'Urbanist', weight: '700' } }
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
        revenueAnalyticsChart.data.labels = chartAnalyticsData.monthsLabels;
        revenueAnalyticsChart.data.datasets[0].data = chartAnalyticsData.monthlyCoffee;
        revenueAnalyticsChart.data.datasets[1].data = chartAnalyticsData.monthlyStrawberry;
        revenueAnalyticsChart.data.datasets[2].data = chartAnalyticsData.monthlyPandan;
        revenueAnalyticsChart.update();
    });

    btnYears?.addEventListener('click', function () {
        btnYears.classList.add('active');
        btnMonths.classList.remove('active');
        revenueAnalyticsChart.data.labels = chartAnalyticsData.yearsLabels;
        revenueAnalyticsChart.data.datasets[0].data = chartAnalyticsData.yearlyCoffee;
        revenueAnalyticsChart.data.datasets[1].data = chartAnalyticsData.yearlyStrawberry;
        revenueAnalyticsChart.data.datasets[2].data = chartAnalyticsData.yearlyPandan;
        revenueAnalyticsChart.update();
    });
}

function initCustomerDonutChart() {
    const ctx = document.getElementById('customerSegmentDonutChart')?.getContext('2d');
    if (!ctx) return;

    if (customerDonutChart) customerDonutChart.destroy();

    const dataPoints = chartAnalyticsData.customerSegments || [31, 14, 2];
    const total = dataPoints.reduce((a, b) => a + b, 0);
    const pct = v => total > 0 ? Math.round((v / total) * 100) : 0;

    document.getElementById('legendRegisteredVal').textContent = `${pct(dataPoints[0])}% (${dataPoints[0]})`;
    document.getElementById('legendGuestsVal').textContent = `${pct(dataPoints[1])}% (${dataPoints[1]})`;
    document.getElementById('legendCorporateVal').textContent = `${pct(dataPoints[2])}% (${dataPoints[2]})`;

    customerDonutChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Registered Members', 'Guest Checkouts', 'Corporate Accounts'],
            datasets: [{
                data: dataPoints,
                backgroundColor: ['#f28b95', '#EAA342', '#68B0AB'],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '70%',
            plugins: { legend: { display: false } }
        }
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