let revenueAnalyticsChart = null;
let customerDonutChart = null;

let chartAnalyticsData = {
    monthsLabels: [],
    yearsLabels: [],
    monthlyCoffee: [],
    monthlyStrawberry: [],
    monthlyPandan: [],
    monthlyOther: [],
    yearlyCoffee: [],
    yearlyStrawberry: [],
    yearlyPandan: [],
    yearlyOther: [],
    customerSegments: [0, 0]
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

const peso = (n) => '₱' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
}

async function fetchCeoAnalyticsData() {
    try {
        const response = await fetch('/api/ceo/analytics');
        if (!response.ok) throw new Error('Failed to load CEO analytics data');
        const data = await response.json();

        // 1. Profile Header (real logged-in CEO)
        setText('userFullNameDisplay', data.user?.fullName || '—');
        const userAvatarEl = document.getElementById('userAvatarImg');
        if (userAvatarEl && data.user?.avatarSrc) userAvatarEl.src = data.user.avatarSrc;

        // 2. Overview Stats
        const ov = data.overview || {};
        setText('statSales', peso(ov.totalSales));
        setText('statPreOrders', Number(ov.activePreOrders || 0).toLocaleString());
        setText('statNewOrders', Number(ov.realizedCups || 0).toLocaleString());
        setText('statCupsNote', `Cups across ${Number(ov.realizedOrders || 0).toLocaleString()} realized orders`);

        // 3. Customer satisfaction + sentiment (real ratings)
        renderSentiment(data.sentiment);

        // 4. Benchmarks (only what the system can measure)
        if (typeof applyBenchmarks === 'function') applyBenchmarks(data.benchmarks || null);

        // 5. Charts
        const ch = data.charts || {};
        chartAnalyticsData.monthsLabels = ch.monthsLabels || [];
        chartAnalyticsData.yearsLabels = ch.yearsLabels || [];
        chartAnalyticsData.monthlyCoffee = ch.monthlyRevCoffee || [];
        chartAnalyticsData.monthlyStrawberry = ch.monthlyRevStrawberry || [];
        chartAnalyticsData.monthlyPandan = ch.monthlyRevPandan || [];
        chartAnalyticsData.monthlyOther = ch.monthlyRevOther || [];
        chartAnalyticsData.yearlyCoffee = ch.yearlyRevCoffee || [];
        chartAnalyticsData.yearlyStrawberry = ch.yearlyRevStrawberry || [];
        chartAnalyticsData.yearlyPandan = ch.yearlyRevPandan || [];
        chartAnalyticsData.yearlyOther = ch.yearlyRevOther || [];
        chartAnalyticsData.customerSegments = ch.customerData || [0, 0];

        initRevenueAnalyticsChart();
        initCustomerDonutChart();

        // 6. Flavor contribution table (real order lines)
        allFlavorAnalytics = data.flavorContributions || [];
        applyAnalyticsFilter();

    } catch (error) {
        // No made-up fallback: tell the CEO the data could not be loaded.
        console.error('Error loading CEO Analytics:', error);
        ['statSales', 'statPreOrders', 'statNewOrders', 'statCsatScore'].forEach(id => setText(id, '—'));
        if (typeof applyBenchmarks === 'function') applyBenchmarks(null);
        allFlavorAnalytics = [];
        applyAnalyticsFilter();
        const tbody = document.getElementById('analyticsTableBody');
        if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="loading-state-text" style="color:#C9302C;">Could not load analytics from the database.</td></tr>';
        MMSwal.fire({ icon: 'warning', title: 'System Notice', text: error.message || 'Could not load analytics data.' });
    }
}

// Customer satisfaction card + sentiment pulse, all from the `ratings` table.
function renderSentiment(sentiment) {
    const showTile = (tileId, textId, metaId, item, fallbackMeta) => {
        const tile = document.getElementById(tileId);
        if (!tile) return false;
        if (!item || !item.text) { tile.style.display = 'none'; return false; }
        setText(textId, `“${item.text}”`);
        const dateStr = item.created_at ? new Date(item.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
        setText(metaId, [item.product, `${item.score}/5`, dateStr].filter(Boolean).join(' • ') || fallbackMeta);
        tile.style.display = '';
        return true;
    };

    if (!sentiment) {
        setText('statCsatScore', '—');
        setText('statCsatNote', 'No ratings yet');
        setText('aiPositivePct', '—');
        ['barPositive', 'barNeutral', 'barNegative'].forEach(id => { const el = document.getElementById(id); if (el) el.style.width = '0%'; });
        showTile('quotePositiveTile', 'quotePositiveText', 'quotePositiveMeta', null);
        showTile('quoteCriticalTile', 'quoteCriticalText', 'quoteCriticalMeta', null);
        const empty = document.getElementById('quoteEmptyText'); if (empty) empty.style.display = '';
        setText('sentimentFooter', 'No customer ratings recorded yet');
        return;
    }

    setText('statCsatScore', `${sentiment.average.toFixed(1)} / 5.0`);
    setText('statCsatNote', `${sentiment.positivePct}% positive • ${sentiment.count} rating${sentiment.count === 1 ? '' : 's'}`);
    setText('aiPositivePct', `${sentiment.positivePct}% Positive`);

    const setBar = (id, pct, label) => {
        const el = document.getElementById(id);
        if (el) { el.style.width = pct + '%'; el.title = `${label} (${pct}%)`; }
    };
    setBar('barPositive', sentiment.positivePct, 'Positive');
    setBar('barNeutral', sentiment.neutralPct, 'Neutral');
    setBar('barNegative', sentiment.negativePct, 'Critical');

    const hasPos = showTile('quotePositiveTile', 'quotePositiveText', 'quotePositiveMeta', sentiment.latestPositive);
    const hasNeg = showTile('quoteCriticalTile', 'quoteCriticalText', 'quoteCriticalMeta', sentiment.latestCritical);
    const empty = document.getElementById('quoteEmptyText');
    if (empty) empty.style.display = (hasPos || hasNeg) ? 'none' : '';
    setText('sentimentFooter', `Based on ${sentiment.count} customer rating${sentiment.count === 1 ? '' : 's'} (4–5★ positive, 3★ neutral, 1–2★ critical)`);
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

    const money = (n) => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    tbody.innerHTML = pageItems.map(item => {
        const name = item.flavor || item.flavor_name || '—';
        const category = item.category || item.category_label || '—';
        const sold = Number(item.sold || item.cups_sold || 0);
        const revenue = money(item.revenue || item.gross_sales || 0);
        // COGS / margin are not recorded per flavor, so they are shown as "—" rather than guessed
        const hasCogs = item.cogs !== null && item.cogs !== undefined;
        const hasMargin = item.margin !== null && item.margin !== undefined;
        const margin = hasMargin ? Number(item.margin) : null;
        const isHigh = hasMargin && margin >= 42;

        return `
            <tr>
                <td><strong style="color: var(--brown-soft); font-size: 13px;">${escapeHtml(name)}</strong></td>
                <td><span style="font-size: 12px; color: var(--text-dark);">${escapeHtml(category)}</span></td>
                <td><strong>${sold} cups</strong></td>
                <td><strong style="color: var(--brown-soft); font-family: var(--font-family-heading);">₱${revenue}</strong></td>
                <td><span style="color: var(--text-muted);">${hasCogs ? '₱' + money(item.cogs) : '—'}</span></td>
                <td><strong style="color: ${hasMargin ? (isHigh ? '#2E7D32' : '#B26A00') : 'var(--text-muted)'};">${hasMargin ? margin + '%' : '—'}</strong></td>
                <td style="text-align: right;">
                    ${hasMargin
                        ? `<span class="badge-perf ${isHigh ? 'perf-high' : 'perf-mid'}">${isHigh ? 'High Yield' : 'Moderate'}</span>`
                        : '<span style="font-size: 11.5px; color: var(--text-muted);">Margin not tracked</span>'}
                </td>
            </tr>
        `;
    }).join('');
}

function renderAnalyticsPaginationControls(totalPages, activePage) {
    const pagerNumbers = document.getElementById('analyticsPagerNumbers');
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
                },
                {
                    label: 'Other Flavors',
                    data: chartAnalyticsData.monthlyOther,
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
        revenueAnalyticsChart.data.datasets[3].data = chartAnalyticsData.monthlyOther;
        revenueAnalyticsChart.update();
    });

    btnYears?.addEventListener('click', function () {
        btnYears.classList.add('active');
        btnMonths.classList.remove('active');
        revenueAnalyticsChart.data.labels = chartAnalyticsData.yearsLabels;
        revenueAnalyticsChart.data.datasets[0].data = chartAnalyticsData.yearlyCoffee;
        revenueAnalyticsChart.data.datasets[1].data = chartAnalyticsData.yearlyStrawberry;
        revenueAnalyticsChart.data.datasets[2].data = chartAnalyticsData.yearlyPandan;
        revenueAnalyticsChart.data.datasets[3].data = chartAnalyticsData.yearlyOther;
        revenueAnalyticsChart.update();
    });
}

function initCustomerDonutChart() {
    const ctx = document.getElementById('customerSegmentDonutChart')?.getContext('2d');
    if (!ctx) return;

    if (customerDonutChart) customerDonutChart.destroy();

    const dataPoints = chartAnalyticsData.customerSegments || [0, 0];
    const total = dataPoints.reduce((a, b) => a + b, 0);
    const pct = v => total > 0 ? Math.round((v / total) * 100) : 0;

    document.getElementById('legendRegisteredVal').textContent = total > 0 ? `${pct(dataPoints[0])}% (${dataPoints[0]})` : '—';
    document.getElementById('legendGuestsVal').textContent = total > 0 ? `${pct(dataPoints[1])}% (${dataPoints[1]})` : '—';

    customerDonutChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Registered Members', 'Guest Checkouts'],
            datasets: [{
                data: dataPoints,
                backgroundColor: ['#f28b95', '#EAA342'],
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