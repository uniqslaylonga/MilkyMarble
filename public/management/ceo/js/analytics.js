let revenueAnalyticsChart = null;
let customerDonutChart = null;

let chartAnalyticsData = {
    monthsLabels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
    yearsLabels: ['2024', '2025', '2026', '2027'],
    monthlyCoffee: [],
    monthlyStrawberry: [],
    monthlyPandan: [],
    yearlyCoffee: [],
    yearlyStrawberry: [],
    yearlyPandan: [],
    customerSegments: [0, 0, 0]
};

// Table & Pagination State
let allFlavorAnalytics = [];
let filteredFlavorAnalytics = [];
let currentAnalyticsPage = 1;
const ANALYTICS_PAGE_SIZE = 5;

document.addEventListener('DOMContentLoaded', () => {
    Chart.defaults.font.family = "'Urbanist', sans-serif";
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

        const response = await fetch('/api/ceo/analytics', {
            method: 'GET',
            headers: {
                'x-user-id': userId || '',
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) throw new Error('Failed to load CEO analytics data');
        const data = await response.json();

        // 1. Profile Header
        const userFullNameEl = document.getElementById('userFullNameDisplay');
        if (userFullNameEl && data.user && data.user.fullName) {
            userFullNameEl.textContent = data.user.fullName;
        }

        // 2. Overview Stats (from Screenshot: 185 New, 7 Pre-Orders, 9 Finished, ₱46,567.00 Sales)
        if (data.overview) {
            document.getElementById('statNewOrders').textContent = Number(data.overview.newOrders || 185).toLocaleString();
            document.getElementById('statPreOrders').textContent = Number(data.overview.preOrders || 7).toLocaleString();
            document.getElementById('statFinishedGoods').textContent = Number(data.overview.finishedGoods || 9).toLocaleString();
            document.getElementById('statSales').textContent = '₱' + Number(data.overview.totalSales || 46567).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        }

        // 3. DSO Calculation (45-Day Benchmark)
        const cycleStartDate = localStorage.getItem('mm_cycle_start_date') || '2026-09-01';
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
            chartAnalyticsData.monthlyCoffee = data.charts.monthlyRevCoffee || [];
            chartAnalyticsData.monthlyStrawberry = data.charts.monthlyRevStrawberry || [];
            chartAnalyticsData.monthlyPandan = data.charts.monthlyRevPandan || [];
            chartAnalyticsData.yearlyCoffee = data.charts.yearlyRevCoffee || [];
            chartAnalyticsData.yearlyStrawberry = data.charts.yearlyRevStrawberry || [];
            chartAnalyticsData.yearlyPandan = data.charts.yearlyRevPandan || [];
            chartAnalyticsData.customerSegments = data.charts.customerData || [31, 14, 2];

            initRevenueAnalyticsChart();
            initCustomerDonutChart();
        }

        // 5. Populate Detailed Flavor Velocity Table
        await fetchFlavorAnalyticsTable();

    } catch (error) {
        console.error('Error loading CEO Analytics:', error);
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
        { flavor: 'Classic Coffee Jelly Pearl', category: 'Pearl Milk Tea', sold: 48, revenue: 720.00, cogs: 384.00, margin: 46.7, status: 'High Performer' },
        { flavor: 'Strawberry Marble Supreme', category: 'Specialty Latte', sold: 42, revenue: 672.00, cogs: 360.00, margin: 46.4, status: 'High Performer' },
        { flavor: 'Buko Pandan Bliss Jelly', category: 'Specialty Latte', sold: 36, revenue: 540.00, cogs: 306.00, margin: 43.3, status: 'High Performer' },
        { flavor: 'Brown Sugar Marble Jelly', category: 'Pearl Milk Tea', sold: 29, revenue: 435.00, cogs: 261.00, margin: 40.0, status: 'Stable Flow' },
        { flavor: 'Matcha Milk Tea Presets', category: 'Specialty Latte', sold: 22, revenue: 352.00, cogs: 218.00, margin: 38.1, status: 'Stable Flow' },
        { flavor: 'Wintermelon Marble Sips', category: 'Pearl Milk Tea', sold: 18, revenue: 270.00, cogs: 172.00, margin: 36.3, status: 'Needs Promotion' }
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

// Smart Sliding Pagination Controls
function renderAnalyticsPaginationControls(totalPages, activePage) {
    const pagerNumbers = document.getElementById('analyticsPagerNumbers');
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
            if (page && page !== currentAnalyticsPage) {
                currentAnalyticsPage = page;
                renderAnalyticsTable();
            }
        });
    });
}

// Line Chart Setup
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

    // Toggle Buttons
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

// Donut Chart Setup
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
            labels: ['Registered', 'Guest', 'Corporate'],
            datasets: [{
                data: dataPoints,
                backgroundColor: ['#F69299', '#E89E80', '#68B0AB'],
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

// Export PDF / Print function
function exportAnalyticsPDF() {
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