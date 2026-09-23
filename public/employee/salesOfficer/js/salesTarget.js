let allPresets = [];
let filteredPresets = [];
let currentPresetPage = 1;
const PRESETS_PAGE_SIZE = 5;

document.addEventListener('DOMContentLoaded', () => {
    // 1. Date Filter Listeners
    const filterSelect = document.getElementById('presetDateFilter');
    const customDate = document.getElementById('presetCustomDate');

    if (filterSelect) {
        filterSelect.addEventListener('change', (e) => {
            if (e.target.value === 'custom') {
                customDate.style.display = 'inline-block';
                if (!customDate.value) {
                    customDate.value = SalesCommon.localDate(new Date());
                }
            } else {
                customDate.style.display = 'none';
            }
            applyPresetFilters();
        });
    }

    if (customDate) {
        customDate.addEventListener('change', applyPresetFilters);
    }

    // 2. Pagination Buttons
    const prevBtn = document.getElementById('prevPresetBtn');
    const nextBtn = document.getElementById('nextPresetBtn');

    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            if (currentPresetPage > 1) {
                currentPresetPage--;
                renderPresetsTable();
            }
        });
    }

    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            const totalPages = Math.ceil(filteredPresets.length / PRESETS_PAGE_SIZE) || 1;
            if (currentPresetPage < totalPages) {
                currentPresetPage++;
                renderPresetsTable();
            }
        });
    }

    fetchSalesTargetData();
});

async function fetchSalesTargetData() {
    try {
        const userId = localStorage.getItem('userId') || sessionStorage.getItem('userId');
        const headers = userId ? { 'x-user-id': userId } : {};

        const response = await fetch('/api/sales-officer/sales-target', { headers });
        if (!response.ok) throw new Error(await SalesCommon.errorMessage(response));

        const data = await response.json();

        // 1. User Header
        if (data.user) {
            const userNameEl = document.getElementById('userName');
            const userAvatarEl = document.getElementById('userAvatar');
            if (userNameEl) userNameEl.textContent = data.user.fullName || 'Sales Officer';
            if (userAvatarEl && data.user.avatarSrc) userAvatarEl.src = data.user.avatarSrc;
        }

        // 2. Quota Gauges & Split Metrics
        if (data.metrics) {
            populateGauges(data.metrics);
        }

        allPresets = data.presets || [];
        applyPresetFilters();

    } catch (error) {
        console.error('Could not load live data from the server:', error);
        SalesCommon.showError(error);
        SalesCommon.failTables();
    }
}

function populateGauges(metrics) {
    // Daily Gauges
    const dailyPct = metrics.dailyPct || Math.round((metrics.todaySales / metrics.dailyTarget) * 100) || 0;
    document.getElementById('dailyPct').textContent = `${dailyPct}%`;
    document.getElementById('todaySales').textContent = '₱' + Number(metrics.todaySales || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    document.getElementById('dailyTarget').textContent = 'Daily Target: ₱' + Number(metrics.dailyTarget || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    document.getElementById('dailyGaugeFill').style.width = `${Math.min(dailyPct, 100)}%`;
    document.getElementById('dailyPreorderRev').textContent = '₱' + Number(metrics.dailyPreorderRev || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    document.getElementById('dailyWalkinRev').textContent = '₱' + Number(metrics.dailyWalkinRev || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    // Monthly Gauges
    const monthlyPct = metrics.monthlyPct || Math.round((metrics.monthSales / metrics.monthlyTarget) * 100) || 0;
    document.getElementById('monthlyPct').textContent = `${monthlyPct}%`;
    document.getElementById('monthSales').textContent = '₱' + Number(metrics.monthSales || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    document.getElementById('monthlyTarget').textContent = 'Monthly Target: ₱' + Number(metrics.monthlyTarget || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    document.getElementById('monthlyGaugeFill').style.width = `${Math.min(monthlyPct, 100)}%`;
    document.getElementById('monthPreorderRev').textContent = '₱' + Number(metrics.monthPreorderRev || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    document.getElementById('monthWalkinRev').textContent = '₱' + Number(metrics.monthWalkinRev || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    // Pre-order Fulfillment Rate
    const fulfillmentPct = metrics.fulfillmentPct || (metrics.preordersTotal ? Math.round((metrics.preordersClaimed / metrics.preordersTotal) * 100) : 0);
    document.getElementById('fulfillmentPct').textContent = `${fulfillmentPct}%`;
    document.getElementById('fulfilledCountDisplay').textContent = `${metrics.preordersClaimed || 0} / ${metrics.preordersTotal || 0}`;
    document.getElementById('fulfillmentGaugeFill').style.width = `${Math.min(fulfillmentPct, 100)}%`;
}

// Filter Logic: Date Select + Custom Date
function applyPresetFilters() {
    const filterType = document.getElementById('presetDateFilter')?.value || 'today';
    const customDateVal = document.getElementById('presetCustomDate')?.value;

    const now = new Date();
    const todayStr = SalesCommon.localDate(now);
    const weekAgo = new Date(now);
    weekAgo.setDate(now.getDate() - 7);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    filteredPresets = allPresets.filter(p => {
        if (!p.target_date) return true;
        const pDate = new Date(p.target_date);
        const pDateStr = SalesCommon.localDate(p.target_date);

        if (filterType === 'today') return pDateStr === todayStr;
        if (filterType === 'week') return pDate >= weekAgo;
        if (filterType === 'month') return pDate >= startOfMonth;
        if (filterType === 'custom') return pDateStr === customDateVal;
        return true; // 'all'
    });

    currentPresetPage = 1;
    renderPresetsTable();
}

// Render Table Rows with Pagination
function renderPresetsTable() {
    const tbody = document.getElementById('presetsTableBody');
    const pageInfo = document.getElementById('presetPageInfo');
    const prevBtn = document.getElementById('prevPresetBtn');
    const nextBtn = document.getElementById('nextPresetBtn');

    if (!tbody) return;

    if (filteredPresets.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="loading-state-text">No preset item records found for the selected period.</td></tr>';
        if (pageInfo) pageInfo.textContent = 'Showing 0 of 0 presets';
        if (prevBtn) prevBtn.disabled = true;
        if (nextBtn) nextBtn.disabled = true;
        renderPresetPagerButtons(1, 1);
        return;
    }

    const totalPages = Math.ceil(filteredPresets.length / PRESETS_PAGE_SIZE) || 1;
    const startIndex = (currentPresetPage - 1) * PRESETS_PAGE_SIZE;
    const pageItems = filteredPresets.slice(startIndex, startIndex + PRESETS_PAGE_SIZE);

    if (pageInfo) {
        const startNum = startIndex + 1;
        const endNum = Math.min(startIndex + PRESETS_PAGE_SIZE, filteredPresets.length);
        pageInfo.textContent = `Showing ${startNum}-${endNum} of ${filteredPresets.length} presets`;
    }
    if (prevBtn) prevBtn.disabled = currentPresetPage <= 1;
    if (nextBtn) nextBtn.disabled = currentPresetPage >= totalPages;

    renderPresetPagerButtons(totalPages, currentPresetPage);

    tbody.innerHTML = pageItems.map(p => {
        const pctSold = p.prepared_batch ? Math.round((p.cups_sold / p.prepared_batch) * 100) : 0;
        const revContribution = Number((p.cups_sold || 0) * (p.unit_price || 0)).toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });

        return `
            <tr>
                <td>
                    <div class="preset-name-bold">${escapeHtml(p.name)}</div>
                </td>
                <td>
                    <div class="preset-spec-sub">${escapeHtml([p.cup_size, p.sugar_level].filter(Boolean).join(' • ') || '—')}</div>
                </td>
                <td><strong>${p.prepared_batch != null ? p.prepared_batch + ' cups' : '—'}</strong></td>
                <td><strong style="color: var(--brown-soft);">${p.cups_sold} sold</strong></td>
                <td>
                    <div class="preset-progress-wrap">
                        <div class="progress-track-sm">
                            <div class="progress-fill-sm" style="width: ${Math.min(pctSold, 100)}%;"></div>
                        </div>
                        <span class="progress-pct-label">${p.prepared_batch ? pctSold + '%' : '—'}</span>
                    </div>
                </td>
                <td>
                    <span class="revenue-val-bold">₱${revContribution}</span>
                </td>
            </tr>
        `;
    }).join('');
}

// Numbered Page Buttons: 1, 2, 3...
function renderPresetPagerButtons(totalPages, activePage) {
    const pagerNumbers = document.getElementById('presetPagerNumbers');
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
            if (page && page !== currentPresetPage) {
                currentPresetPage = page;
                renderPresetsTable();
            }
        });
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