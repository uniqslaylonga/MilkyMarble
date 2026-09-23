let allProductsRank = [];
let filteredProductsRank = [];
let currentReportPage = 1;
const REPORTS_PAGE_SIZE = 5;

let allPresets = [];
let filteredPresets = [];
let currentPresetPage = 1;
const PRESETS_PAGE_SIZE = 5;

let currentReportMetrics = null;
let currentTargetMetrics = null;
let officerFullName = 'Sales Officer';

document.addEventListener('DOMContentLoaded', () => {
    const filterSelect = document.getElementById('reportDateFilter');
    const customDateInput = document.getElementById('reportCustomDate');

    if (filterSelect) {
        filterSelect.addEventListener('change', (e) => {
            if (e.target.value === 'custom') {
                customDateInput.style.display = 'inline-block';
                if (!customDateInput.value) {
                    customDateInput.value = SalesCommon.localDate(new Date());
                }
            } else {
                customDateInput.style.display = 'none';
            }
            fetchAllReportData();
        });
    }

    if (customDateInput) customDateInput.addEventListener('change', fetchAllReportData);

    const prevReportBtn = document.getElementById('prevReportBtn');
    const nextReportBtn = document.getElementById('nextReportBtn');
    if (prevReportBtn) {
        prevReportBtn.addEventListener('click', () => {
            if (currentReportPage > 1) {
                currentReportPage--;
                renderPaginatedProductRankings();
            }
        });
    }
    if (nextReportBtn) {
        nextReportBtn.addEventListener('click', () => {
            const totalPages = Math.ceil(filteredProductsRank.length / REPORTS_PAGE_SIZE) || 1;
            if (currentReportPage < totalPages) {
                currentReportPage++;
                renderPaginatedProductRankings();
            }
        });
    }

    const prevPresetBtn = document.getElementById('prevPresetBtn');
    const nextPresetBtn = document.getElementById('nextPresetBtn');
    if (prevPresetBtn) {
        prevPresetBtn.addEventListener('click', () => {
            if (currentPresetPage > 1) {
                currentPresetPage--;
                renderPresetsTable();
            }
        });
    }
    if (nextPresetBtn) {
        nextPresetBtn.addEventListener('click', () => {
            const totalPages = Math.ceil(filteredPresets.length / PRESETS_PAGE_SIZE) || 1;
            if (currentPresetPage < totalPages) {
                currentPresetPage++;
                renderPresetsTable();
            }
        });
    }

    fetchAllReportData();
});

// Load combined sales target and reports data
async function fetchAllReportData() {
    try {
        const userId = localStorage.getItem('userId') || sessionStorage.getItem('userId');
        const headers = userId ? { 'x-user-id': userId } : {};

        const range = document.getElementById('reportDateFilter')?.value || 'month';
        const date = document.getElementById('reportCustomDate')?.value || '';

        const [reportsRes, targetRes] = await Promise.all([
            fetch('/api/sales-officer/sales-reports?' + new URLSearchParams({ range, date }), { headers }),
            fetch('/api/sales-officer/sales-target', { headers })
        ]);

        if (!reportsRes.ok) throw new Error(await SalesCommon.errorMessage(reportsRes));
        if (!targetRes.ok) throw new Error(await SalesCommon.errorMessage(targetRes));

        const reportsData = await reportsRes.json();
        const targetData = await targetRes.json();

        // User Details
        const user = reportsData.user || targetData.user;
        if (user && user.fullName) {
            officerFullName = user.fullName;
            const userNameEl = document.getElementById('userName');
            const userAvatarEl = document.getElementById('userAvatar');
            if (userNameEl) userNameEl.textContent = user.fullName;
            if (userAvatarEl && user.avatarSrc) userAvatarEl.src = user.avatarSrc;
        }

        // Section 1: Target Gauges & DSO 45 Days
        if (targetData.metrics) {
            currentTargetMetrics = targetData.metrics;
            populateTargetGauges(targetData.metrics);
        }

        // Section 2: Financial Highlights
        if (reportsData.metrics) {
            currentReportMetrics = reportsData.metrics;
            document.getElementById('grossSales').textContent = '₱' + Number(reportsData.metrics.grossSales || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            document.getElementById('netSales').textContent = '₱' + Number(reportsData.metrics.netSales || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            document.getElementById('aov').textContent = '₱' + Number(reportsData.metrics.aov || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        }

        // Section 3: Presets Quota
        allPresets = targetData.presets || [];
        applyPresetFilters();

        // Section 4: Product Rankings
        allProductsRank = reportsData.productsRank || [];
        filteredProductsRank = [...allProductsRank];
        currentReportPage = 1;
        renderPaginatedProductRankings();

        const dateSub = document.getElementById('reportGeneratedDate');
        if (dateSub) {
            dateSub.textContent = `Generated on ${new Date().toLocaleDateString('en-US', { month: 'long', day: '2-digit', year: 'numeric' })} • Standard 45-Day DSO Window`;
        }

    } catch (error) {
        console.error('Could not load reports data:', error);
        SalesCommon.showError(error);
        SalesCommon.failTables();
    }
}

function populateTargetGauges(metrics) {
    const dailyPct = metrics.dailyPct || (metrics.dailyTarget ? Math.round((metrics.todaySales / metrics.dailyTarget) * 100) : 0);
    document.getElementById('dailyPct').textContent = `${dailyPct}%`;
    document.getElementById('todaySales').textContent = '₱' + Number(metrics.todaySales || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    document.getElementById('dailyTarget').textContent = 'Daily Target: ₱' + Number(metrics.dailyTarget || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    document.getElementById('dailyGaugeFill').style.width = `${Math.min(dailyPct, 100)}%`;
    document.getElementById('dailyPreorderRev').textContent = '₱' + Number(metrics.dailyPreorderRev || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    document.getElementById('dailyWalkinRev').textContent = '₱' + Number(metrics.dailyWalkinRev || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const monthlyPct = metrics.monthlyPct || (metrics.monthlyTarget ? Math.round((metrics.monthSales / metrics.monthlyTarget) * 100) : 0);
    document.getElementById('monthlyPct').textContent = `${monthlyPct}%`;
    document.getElementById('monthSales').textContent = '₱' + Number(metrics.monthSales || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    document.getElementById('monthlyTarget').textContent = 'Monthly Target: ₱' + Number(metrics.monthlyTarget || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    document.getElementById('monthlyGaugeFill').style.width = `${Math.min(monthlyPct, 100)}%`;
    document.getElementById('monthPreorderRev').textContent = '₱' + Number(metrics.monthPreorderRev || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    document.getElementById('monthWalkinRev').textContent = '₱' + Number(metrics.monthWalkinRev || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const fulfillmentPct = metrics.fulfillmentPct || (metrics.preordersTotal ? Math.round((metrics.preordersClaimed / metrics.preordersTotal) * 100) : 0);
    document.getElementById('fulfillmentPct').textContent = `${fulfillmentPct}%`;
    document.getElementById('fulfilledCountDisplay').textContent = `${metrics.preordersClaimed || 0} / ${metrics.preordersTotal || 0}`;
    document.getElementById('fulfillmentGaugeFill').style.width = `${Math.min(fulfillmentPct, 100)}%`;

    const dsoEl = document.getElementById('dsoValueDisplay');
    if (dsoEl) dsoEl.textContent = '45 Days';
}

function applyPresetFilters() {
    const filterType = document.getElementById('reportDateFilter')?.value || 'month';
    const customDateVal = document.getElementById('reportCustomDate')?.value;

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
        return true;
    });

    currentPresetPage = 1;
    renderPresetsTable();
}

function renderPresetsTable() {
    const tbody = document.getElementById('presetsTableBody');
    const pageInfo = document.getElementById('presetPageInfo');
    const prevBtn = document.getElementById('prevPresetBtn');
    const nextBtn = document.getElementById('nextPresetBtn');

    if (!tbody) return;

    if (filteredPresets.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="loading-state-text">No preset item records found.</td></tr>';
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
                <td><div class="preset-name-bold">${escapeHtml(p.name)}</div></td>
                <td><div class="preset-spec-sub">${escapeHtml(p.cup_size || '8oz / 12oz')}</div></td>
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
                <td><span class="revenue-val-bold">₱${revContribution}</span></td>
            </tr>
        `;
    }).join('');
}

function renderPresetPagerButtons(totalPages, activePage) {
    const pagerNumbers = document.getElementById('presetPagerNumbers');
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
            if (page && page !== currentPresetPage) {
                currentPresetPage = page;
                renderPresetsTable();
            }
        });
    });
}

function renderPaginatedProductRankings() {
    const tbody = document.getElementById('productsTableBody');
    const pageInfo = document.getElementById('reportPageInfo');
    const prevBtn = document.getElementById('prevReportBtn');
    const nextBtn = document.getElementById('nextReportBtn');

    if (!tbody) return;

    if (filteredProductsRank.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" class="loading-state-text">No product performance records found.</td></tr>';
        if (pageInfo) pageInfo.textContent = 'Showing 0 of 0 products';
        if (prevBtn) prevBtn.disabled = true;
        if (nextBtn) nextBtn.disabled = true;
        renderReportPagerButtons(1, 1);
        return;
    }

    const totalPages = Math.ceil(filteredProductsRank.length / REPORTS_PAGE_SIZE) || 1;
    const startIndex = (currentReportPage - 1) * REPORTS_PAGE_SIZE;
    const pageItems = filteredProductsRank.slice(startIndex, startIndex + REPORTS_PAGE_SIZE);

    if (pageInfo) {
        const startNum = startIndex + 1;
        const endNum = Math.min(startIndex + REPORTS_PAGE_SIZE, filteredProductsRank.length);
        pageInfo.textContent = `Showing ${startNum}-${endNum} of ${filteredProductsRank.length} products`;
    }
    if (prevBtn) prevBtn.disabled = currentReportPage <= 1;
    if (nextBtn) nextBtn.disabled = currentReportPage >= totalPages;

    renderReportPagerButtons(totalPages, currentReportPage);

    tbody.innerHTML = pageItems.map((prod, index) => {
        const absoluteIndex = startIndex + index + 1;
        const unitsSold = Number(prod.units_sold || 0).toLocaleString();
        const revenue = Number(prod.revenue || 0).toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });

        return `
            <tr>
                <td>
                    <div class="prod-cell">
                        <span class="rank-badge top">#${absoluteIndex}</span>
                        <div>
                            <div class="prod-title">${escapeHtml(prod.name)}</div>
                            <div class="prod-sku">SKU: ${escapeHtml(prod.sku || 'N/A')}</div>
                        </div>
                    </div>
                </td>
                <td><strong>${unitsSold} units</strong></td>
                <td><span class="spent-val">₱${revenue}</span></td>
            </tr>
        `;
    }).join('');
}

function renderReportPagerButtons(totalPages, activePage) {
    const pagerNumbers = document.getElementById('reportPagerNumbers');
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
            if (page && page !== currentReportPage) {
                currentReportPage = page;
                renderPaginatedProductRankings();
            }
        });
    });
}

// POPULATES PURE EXECUTIVE CORPORATE TEMPLATE AND EXPORTS TO PDF
async function exportReportToPDF() {
    const renderWrapper = document.getElementById('corporatePdfRenderWrapper');
    if (!renderWrapper) return;

    SalesCommon.alert('Compiling Executive Audit Report', 'Formatting official commercial tables, DSO 45 metrics, and sign-off sheets into formal corporate PDF...', 'info');

    const periodFilter = document.getElementById('reportDateFilter');
    const selectedPeriodText = periodFilter ? periodFilter.options[periodFilter.selectedIndex].text : 'Current Month';
    const todayFormatted = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: '2-digit' });

    // 1. Meta Details
    document.getElementById('pdfMetaDate').textContent = `Date: ${todayFormatted}`;
    document.getElementById('pdfMetaPeriod').textContent = `Period: ${selectedPeriodText}`;
    document.getElementById('pdfSignOfficer').textContent = officerFullName;

    // 2. Section 1 Table: KPIs
    const dailyTarget = currentTargetMetrics?.dailyTarget || 0;
    const todaySales = currentTargetMetrics?.todaySales || 0;
    const dailyPct = dailyTarget ? Math.round((todaySales / dailyTarget) * 100) : 0;

    const monthlyTarget = currentTargetMetrics?.monthlyTarget || 0;
    const monthSales = currentTargetMetrics?.monthSales || 0;
    const monthlyPct = monthlyTarget ? Math.round((monthSales / monthlyTarget) * 100) : 0;

    const gross = currentReportMetrics?.grossSales || 0;
    const net = currentReportMetrics?.netSales || 0;
    const aov = currentReportMetrics?.aov || 0;

    document.getElementById('pdfKpiTableBody').innerHTML = `
        <tr>
            <td><strong>Daily Revenue Target</strong></td>
            <td>₱${Number(dailyTarget).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
            <td>₱${Number(todaySales).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
            <td><strong>${dailyPct}%</strong></td>
            <td>${dailyPct >= 100 ? 'Quota Achieved' : 'In Progress'}</td>
        </tr>
        <tr>
            <td><strong>Monthly Revenue Target</strong></td>
            <td>₱${Number(monthlyTarget).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
            <td>₱${Number(monthSales).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
            <td><strong>${monthlyPct}%</strong></td>
            <td>${monthlyPct >= 100 ? 'Target Exceeded' : 'Active Cycle'}</td>
        </tr>
        <tr>
            <td><strong>Gross Billed Sales</strong></td>
            <td>—</td>
            <td>₱${Number(gross).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
            <td>100.0%</td>
            <td>Audited</td>
        </tr>
        <tr>
            <td><strong>Net Realized Sales (Post-Discount)</strong></td>
            <td>—</td>
            <td>₱${Number(net).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
            <td>${gross > 0 ? ((net / gross) * 100).toFixed(1) : 100}%</td>
            <td>Cleared</td>
        </tr>
        <tr>
            <td><strong>Average Order Value (AOV)</strong></td>
            <td>₱25.00 Baseline</td>
            <td>₱${Number(aov).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
            <td>—</td>
            <td>Standard Basket Size</td>
        </tr>
    `;

    // 3. Section 2 Table: Channel Breakdown
    const preorderRev = currentTargetMetrics?.dailyPreorderRev || 0;
    const walkinRev = currentTargetMetrics?.dailyWalkinRev || 0;
    const totalRev = preorderRev + walkinRev;
    const prePct = totalRev > 0 ? ((preorderRev / totalRev) * 100).toFixed(1) : 0;
    const walkPct = totalRev > 0 ? ((walkinRev / totalRev) * 100).toFixed(1) : 0;

    document.getElementById('pdfChannelTableBody').innerHTML = `
        <tr>
            <td><strong>Scheduled Online Pre-orders (Digital Settlement)</strong></td>
            <td>₱${Number(preorderRev).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
            <td>${prePct}%</td>
        </tr>
        <tr>
            <td><strong>Chiller Walk-in Presets (Counter Physical Cash)</strong></td>
            <td>₱${Number(walkinRev).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
            <td>${walkPct}%</td>
        </tr>
    `;

    // 4. Section 3 Table: Chiller Presets
    if (allPresets.length > 0) {
        document.getElementById('pdfPresetTableBody').innerHTML = allPresets.map(p => {
            const pct = p.prepared_batch ? Math.round((p.cups_sold / p.prepared_batch) * 100) : 0;
            const rev = Number((p.cups_sold || 0) * (p.unit_price || 0)).toLocaleString('en-US', { minimumFractionDigits: 2 });
            return `
                <tr>
                    <td><strong>${escapeHtml(p.name)}</strong></td>
                    <td>${escapeHtml(p.cup_size || '8oz / 12oz')}</td>
                    <td>${p.prepared_batch != null ? p.prepared_batch : '—'}</td>
                    <td>${p.cups_sold}</td>
                    <td>${pct}%</td>
                    <td>₱${rev}</td>
                </tr>
            `;
        }).join('');
    } else {
        document.getElementById('pdfPresetTableBody').innerHTML = `<tr><td colspan="6" style="text-align:center;">No preset chiller batches recorded.</td></tr>`;
    }

    // 5. Section 4 Table: Catalog SKU Rankings
    if (allProductsRank.length > 0) {
        document.getElementById('pdfRankingTableBody').innerHTML = allProductsRank.map((prod, idx) => `
            <tr>
                <td>#${idx + 1}</td>
                <td><strong>${escapeHtml(prod.name)}</strong></td>
                <td>${escapeHtml(prod.sku || 'N/A')}</td>
                <td>${Number(prod.units_sold || 0).toLocaleString()}</td>
                <td>₱${Number(prod.revenue || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
            </tr>
        `).join('');
    } else {
        document.getElementById('pdfRankingTableBody').innerHTML = `<tr><td colspan="5" style="text-align:center;">No itemized catalog transactions found.</td></tr>`;
    }

    // Temporarily unhide for capture
    renderWrapper.style.display = 'block';

    const opt = {
        margin: [10, 10, 10, 10],
        filename: `Milky_Marble_Executive_Sales_Report_${new Date().toISOString().slice(0, 10)}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, logging: false },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };

    try {
        await html2pdf().set(opt).from(renderWrapper).save();
        renderWrapper.style.display = 'none';
        SalesCommon.alert('PDF Export Complete', 'Official executive audit report has been generated successfully.', 'success');
    } catch (err) {
        renderWrapper.style.display = 'none';
        console.error('Corporate PDF export failed:', err);
        SalesCommon.alert('Export Failed', 'Error generating PDF: ' + err.message, 'error');
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