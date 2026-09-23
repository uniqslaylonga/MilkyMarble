let customerAcquisitionData = {
    today: 0,
    week: 0,
    month: 0,
    last3Months: 0,
    last6Months: 0
};

let acquisitionChartInstance = null;
let weeklyRevenueChartInstance = null;

// Pagination & Transactions State
let allFetchedOrders = [];
let filteredOrders = [];
let currentTxPage = 1;
const TX_PAGE_SIZE = 4;

// Register Lock State
let isRegisterLocked = localStorage.getItem('isRegisterLocked') === 'true';
let expectedCounterCash = 0;
let latestXReading = null;

document.addEventListener('DOMContentLoaded', async () => {
    initCharts();
    checkRegisterLockState();

    const acqFilter = document.getElementById('acquisitionFilter');
    if (acqFilter) acqFilter.addEventListener('change', updateAcquisitionDisplay);

    const txDateFilter = document.getElementById('txDateFilter');
    const txCustomDate = document.getElementById('txCustomDate');
    const prevBtn = document.getElementById('prevTxBtn');
    const nextBtn = document.getElementById('nextTxBtn');

    if (txDateFilter) {
        txDateFilter.addEventListener('change', (e) => {
            if (e.target.value === 'custom') {
                txCustomDate.style.display = 'inline-block';
                if (!txCustomDate.value) txCustomDate.value = SalesCommon.localDate(new Date());
            } else {
                txCustomDate.style.display = 'none';
            }
            applyTransactionFilters();
        });
    }

    if (txCustomDate) txCustomDate.addEventListener('change', applyTransactionFilters);

    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            if (currentTxPage > 1) {
                currentTxPage--;
                renderPaginatedTransactions();
            }
        });
    }

    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            const totalPages = Math.ceil(filteredOrders.length / TX_PAGE_SIZE) || 1;
            if (currentTxPage < totalPages) {
                currentTxPage++;
                renderPaginatedTransactions();
            }
        });
    }

    const cashInput = document.getElementById('zActualCashInput');
    if (cashInput) cashInput.addEventListener('input', calculateZVariance);

    const btnExecute = document.getElementById('btnExecuteLockAndTransmit');
    if (btnExecute) btnExecute.addEventListener('click', executeLockdown);

    await loadPageData();
});

// Setup Chart.js
function initCharts() {
    const acqCtx = document.getElementById('acquisitionMiniChart');
    if (acqCtx) {
        acquisitionChartInstance = new Chart(acqCtx.getContext('2d'), {
            type: 'bar',
            data: {
                labels: ['Today', 'Week', 'Month', '90 Days', '180 Days'],
                datasets: [{
                    label: 'New Users',
                    data: [0, 0, 0, 0, 0],
                    backgroundColor: '#F69299',
                    borderRadius: 4,
                    barThickness: 16
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false }, tooltip: { enabled: true } },
                scales: {
                    x: { grid: { display: false }, ticks: { font: { size: 10, family: 'Urbanist' }, color: '#7C4F38' } },
                    y: { display: false, beginAtZero: true }
                }
            }
        });
    }

    // Weekly Inflow Chart
    const weeklyCtx = document.getElementById('weeklyInflowChart');
    if (weeklyCtx) {
        weeklyRevenueChartInstance = new Chart(weeklyCtx.getContext('2d'), {
            type: 'bar',
            data: {
                labels: ['3 Wks Ago', '2 Wks Ago', 'Last Week', 'This Week'],
                datasets: [{
                    label: 'Inflow (₱)',
                    data: [0, 0, 0, 0],
                    backgroundColor: ['#FAD5D9', '#FAD5D9', '#F8A5AD', '#F69299'],
                    borderRadius: 4,
                    barThickness: 24
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => `₱${Number(ctx.raw || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`
                        }
                    }
                },
                scales: {
                    x: { grid: { display: false }, ticks: { font: { size: 10, family: 'Urbanist' }, color: '#7C4F38' } },
                    y: { display: false, beginAtZero: true }
                }
            }
        });
    }
}

async function loadPageData() {
    try {
        const userId = localStorage.getItem('userId') || sessionStorage.getItem('userId');
        const headers = {};
        if (userId) headers['x-user-id'] = userId;

        const response = await fetch('/api/sales-officer/dashboard', { headers });
        if (!response.ok) throw new Error(await SalesCommon.errorMessage(response));

        const data = await response.json();

        // 1. User Header
        const userNameEl = document.getElementById('userName');
        const userFirstNameEl = document.getElementById('userFirstName');
        if (data.user && data.user.fullName) {
            if (userNameEl) userNameEl.textContent = data.user.fullName;
            if (userFirstNameEl) userFirstNameEl.textContent = data.user.firstName || data.user.fullName;
        }

        // 2. Today's Performance
        const todayOrdersEl = document.getElementById('todayOrders');
        const todaySalesEl = document.getElementById('todaySales');
        const pendingOrdersEl = document.getElementById('pendingOrders');

        if (todayOrdersEl && data.metrics) todayOrdersEl.textContent = Number(data.metrics.todayOrders || 0).toLocaleString();
        if (todaySalesEl && data.metrics) {
            todaySalesEl.textContent = '₱' + Number(data.metrics.todaySales || 0).toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            });
        }
        if (pendingOrdersEl && data.metrics) pendingOrdersEl.textContent = Number(data.metrics.pendingOrders || 0).toLocaleString();

        // 3. Customer Acquisition
        if (data.newAccounts) {
            customerAcquisitionData = {
                today: data.newAccounts.today || 0,
                week: data.newAccounts.week || 0,
                month: data.newAccounts.month || 0,
                last3Months: data.newAccounts.last3Months || 0,
                last6Months: data.newAccounts.last6Months || 0
            };

            if (acquisitionChartInstance) {
                acquisitionChartInstance.data.datasets[0].data = [
                    customerAcquisitionData.today,
                    customerAcquisitionData.week,
                    customerAcquisitionData.month,
                    customerAcquisitionData.last3Months,
                    customerAcquisitionData.last6Months
                ];
                acquisitionChartInstance.update();
            }
            updateAcquisitionDisplay();
        }

        syncRegisterLockState(data.registerStatus);

        // 4. Transactions and Weekly Inflow DSS
        allFetchedOrders = data.recentOrders || [];
        updateWeeklyInflowAndDSS();
        applyTransactionFilters();

    } catch (error) {
        console.error('Could not load live data from the server:', error);
        SalesCommon.showError(error);
        SalesCommon.failTables();
    }
}

// Compute Weekly Revenue Inflow and Trigger DSS Alert
function updateWeeklyInflowAndDSS() {
    const now = new Date();
    const dayMs = 24 * 60 * 60 * 1000;
    const week1Start = new Date(now.getTime() - 7 * dayMs);
    const week2Start = new Date(now.getTime() - 14 * dayMs);
    const week3Start = new Date(now.getTime() - 21 * dayMs);
    const week4Start = new Date(now.getTime() - 28 * dayMs);

    let thisWeek = 0;
    let lastWeek = 0;
    let twoWeeksAgo = 0;
    let threeWeeksAgo = 0;

    allFetchedOrders.forEach(ord => {
        const placed = new Date(ord.placed_at);
        const amt = Number(ord.total_amount || 0);
        if (placed >= week1Start) thisWeek += amt;
        else if (placed >= week2Start) lastWeek += amt;
        else if (placed >= week3Start) twoWeeksAgo += amt;
        else if (placed >= week4Start) threeWeeksAgo += amt;
    });

    const thisWeekEl = document.getElementById('thisWeekRevDisplay');
    const lastWeekEl = document.getElementById('lastWeekRevDisplay');
    const trendPill = document.getElementById('weeklyTrendPill');
    const dssBox = document.getElementById('dssAlertBox');
    const dssIconWrap = document.getElementById('dssIconWrap');
    const dssMessage = document.getElementById('dssMessage');
    const btnPitch = document.getElementById('btnDssPitch');

    if (thisWeekEl) thisWeekEl.textContent = '₱' + thisWeek.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (lastWeekEl) lastWeekEl.textContent = '₱' + lastWeek.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    if (weeklyRevenueChartInstance) {
        weeklyRevenueChartInstance.data.datasets[0].data = [threeWeeksAgo, twoWeeksAgo, lastWeek, thisWeek];
        weeklyRevenueChartInstance.update();
    }

    let diffPct = 0;
    const hasPriorData = lastWeek > 0;
    if (hasPriorData) {
        diffPct = Math.round(((thisWeek - lastWeek) / lastWeek) * 100);
    }

    if (trendPill) {
        if (hasPriorData) {
            trendPill.textContent = `${diffPct >= 0 ? '+' : ''}${diffPct}%`;
            trendPill.className = `trend-pill ${diffPct >= 0 ? 'trend-up' : 'trend-down'}`;
        } else {
            trendPill.textContent = 'Active';
            trendPill.className = 'trend-pill trend-neutral';
        }
    }

    // Decision Support System (DSS) Rule: Alert on any negative drop
    if (dssBox && dssMessage && btnPitch) {
        if (hasPriorData && diffPct < 0) {
            dssBox.className = 'dss-alert-box alert-active';
            if (dssIconWrap) dssIconWrap.className = 'dss-icon-wrap warning';
            dssMessage.innerHTML = `<strong>Revenue Alert:</strong> Inflow dropped by <strong>${Math.abs(diffPct)}%</strong> vs. last week. Recommending an immediate promotional campaign pitch to CEO to boost customer traction.`;
            btnPitch.style.display = 'inline-flex';
        } else if (hasPriorData && diffPct >= 0) {
            dssBox.className = 'dss-alert-box normal';
            if (dssIconWrap) dssIconWrap.className = 'dss-icon-wrap success';
            dssMessage.innerHTML = `<strong>Performance Healthy:</strong> Weekly inflow grew by <strong>+${diffPct}%</strong>. Inflow trends are steady and meet operational targets.`;
            btnPitch.style.display = 'none';
        } else {
            dssBox.className = 'dss-alert-box normal';
            if (dssIconWrap) dssIconWrap.className = 'dss-icon-wrap neutral';
            dssMessage.textContent = 'Aggregating weekly inflow records to formulate predictive revenue recommendations.';
            btnPitch.style.display = 'none';
        }
    }
}

// Pitch Promo Modal Logic
function openPitchPromoModal() {
    const modal = document.getElementById('pitchPromoModal');
    if (!modal) return;
    const codeInput = document.getElementById('pitchPromoCode');
    const noteInput = document.getElementById('pitchNote');
    if (codeInput) codeInput.value = '';
    if (noteInput) noteInput.value = 'DSS-triggered initiative: Low weekly inflow detected. Recommending a discount to boost pre-orders.';
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
}

function closePitchPromoModal() {
    const modal = document.getElementById('pitchPromoModal');
    if (modal) {
        modal.classList.remove('open');
        document.body.style.overflow = '';
    }
}

async function submitPromoPitch() {
    const code = document.getElementById('pitchPromoCode')?.value.trim();
    const discount_type = document.getElementById('pitchDiscountType')?.value;
    const discount_value = parseFloat(document.getElementById('pitchDiscountValue')?.value);
    const pitch_note = document.getElementById('pitchNote')?.value.trim();

    if (!code || isNaN(discount_value) || discount_value <= 0) {
        showCustomAlert('Incomplete Details', 'Please provide a valid promo code and discount amount.', 'warning');
        return;
    }

    try {
        const userId = localStorage.getItem('userId') || sessionStorage.getItem('userId');
        const headers = { 'Content-Type': 'application/json' };
        if (userId) headers['x-user-id'] = userId;

        const response = await fetch('/api/sales-officer/promotions/pitch', {
            method: 'POST',
            headers,
            body: JSON.stringify({
                code,
                discount_type,
                discount_value,
                pitch_note: pitch_note || 'DSS sales recovery recommendation'
            })
        });

        const resData = await response.json();
        if (!response.ok || resData.status !== 'success') {
            throw new Error(resData.message || 'Failed to submit promotional pitch.');
        }

        closePitchPromoModal();
        showCustomAlert('Promotion Pitched', `Promo code ${code.toUpperCase()} has been submitted directly to the CEO for approval.`, 'success');
    } catch (err) {
        console.error('Error submitting promo pitch:', err);
        showCustomAlert('Pitch Failed', err.message, 'warning');
    }
}

// Transactions Filter & Pagination
function applyTransactionFilters() {
    const filterType = document.getElementById('txDateFilter')?.value || 'today';
    const customDateVal = document.getElementById('txCustomDate')?.value;
    const now = new Date();
    const todayStr = SalesCommon.localDate(now);
    const weekAgo = new Date(now);
    weekAgo.setDate(now.getDate() - 7);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    filteredOrders = allFetchedOrders.filter(ord => {
        if (!ord.placed_at) return false;
        const ordDate = new Date(ord.placed_at);
        const ordDateStr = SalesCommon.localDate(ord.placed_at);
        if (filterType === 'today') return ordDateStr === todayStr;
        if (filterType === 'week') return ordDate >= weekAgo;
        if (filterType === 'month') return ordDate >= startOfMonth;
        if (filterType === 'custom') return ordDateStr === customDateVal;
        return true;
    });

    currentTxPage = 1;
    renderPaginatedTransactions();
}

function renderPaginatedTransactions() {
    const ordersGrid = document.getElementById('recentOrdersGrid');
    const paginationBar = document.getElementById('txPaginationBar');
    const pageInfo = document.getElementById('txPageInfo');
    const prevBtn = document.getElementById('prevTxBtn');
    const nextBtn = document.getElementById('nextTxBtn');

    if (!ordersGrid) return;
    if (paginationBar) paginationBar.style.display = 'flex';

    if (filteredOrders.length === 0) {
        ordersGrid.innerHTML = '<p class="loading-state-text">No transactions found for the selected period.</p>';
        if (pageInfo) pageInfo.textContent = 'Showing 0 of 0 orders';
        if (prevBtn) prevBtn.disabled = true;
        if (nextBtn) nextBtn.disabled = true;
        renderPaginationControls(1, 1);
        return;
    }

    const totalPages = Math.ceil(filteredOrders.length / TX_PAGE_SIZE) || 1;
    const startIndex = (currentTxPage - 1) * TX_PAGE_SIZE;
    const pageItems = filteredOrders.slice(startIndex, startIndex + TX_PAGE_SIZE);

    if (pageInfo) {
        const startNum = startIndex + 1;
        const endNum = Math.min(startIndex + TX_PAGE_SIZE, filteredOrders.length);
        pageInfo.textContent = `Showing ${startNum}-${endNum} of ${filteredOrders.length} orders`;
    }
    if (prevBtn) prevBtn.disabled = currentTxPage <= 1;
    if (nextBtn) nextBtn.disabled = currentTxPage >= totalPages;

    renderPaginationControls(totalPages, currentTxPage);

    ordersGrid.innerHTML = pageItems.map(ord => {
        const dateFormatted = new Date(ord.placed_at).toLocaleDateString('en-US', {
            month: 'short',
            day: '2-digit',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });
        const amount = Number(ord.total_amount || 0).toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });

        // Walk-in vs Registered Member badge (no Guest)
        const isWalkin = !ord.customer_id || String(ord.customer_name || '').toLowerCase().includes('walk');
        const badgeClass = isWalkin ? 'badge-walkin' : 'badge-member';
        const badgeText = isWalkin ? 'Walk-in' : 'Member';
        const displayName = escapeHtml(ord.customer_name || 'Walk-in Counter');

        return `
            <div class="order-row-item">
                <div class="row-item-main">
                    <div class="name-badge-group">
                        <span class="customer-name-bold">${displayName}</span>
                        <span class="client-badge ${badgeClass}">${badgeText}</span>
                    </div>
                    <div class="order-amount-display">₱${amount}</div>
                </div>
                <div class="row-item-footer">
                    <span class="order-meta-info">${escapeHtml(ord.order_number || '')} • ${dateFormatted}</span>
                    <span>Status: <strong>${escapeHtml(ord.status || 'PENDING')}</strong></span>
                </div>
            </div>
        `;
    }).join('');
}

function renderPaginationControls(totalPages, activePage) {
    const pagerNumbers = document.getElementById('pagerNumbers');
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
            if (page && page !== currentTxPage) {
                currentTxPage = page;
                renderPaginatedTransactions();
            }
        });
    });
}

function updateAcquisitionDisplay() {
    const filterEl = document.getElementById('acquisitionFilter');
    const valueEl = document.getElementById('filteredNewAccounts');
    const footerEl = document.getElementById('acquisitionPeriodFooter');
    const selected = filterEl ? filterEl.value : 'today';

    const timeframeConfig = {
        today: { footer: "Registered today" },
        week: { footer: "Past 7 days" },
        month: { footer: "Current calendar month" },
        last3Months: { footer: "Past 90 days" },
        last6Months: { footer: "Past 180 days" }
    };

    const config = timeframeConfig[selected] || timeframeConfig.today;
    if (valueEl) valueEl.textContent = Number(customerAcquisitionData[selected] || 0).toLocaleString();
    if (footerEl) footerEl.textContent = config.footer;
}

// Shift controls (Open / Lock)
function checkRegisterLockState() {
    const banner = document.getElementById('registerStatusBanner');
    const bannerText = document.getElementById('registerStatusText');
    const shiftBtn = document.getElementById('btnShiftTrigger');

    if (isRegisterLocked) {
        if (banner) {
            banner.className = 'topbar-status-strip locked';
            bannerText.innerHTML = '<span class="status-pulse-dot"></span><strong>Shift Closed &amp; Register Locked</strong> — Transmitted to Finance';
        }
        if (shiftBtn) {
            shiftBtn.className = 'btn-open-shift';
            shiftBtn.innerHTML = `
              <svg class="btn-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10" />
                <polygon points="10 8 16 12 10 16 10 8" />
              </svg>
              <span>Start Shift / Open Register</span>
            `;
        }
    } else {
        if (banner) {
            banner.className = 'topbar-status-strip open';
            bannerText.innerHTML = '<span class="status-pulse-dot"></span>Register Open • Tuesday &amp; Thursday Release Window (10:00 AM – 3:00 PM)';
        }
        if (shiftBtn) {
            shiftBtn.className = 'btn-z-reading';
            shiftBtn.innerHTML = `
              <svg class="btn-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              <span>End Shift &amp; Z-Reading</span>
            `;
        }
    }
}

function handleShiftButtonClick() {
    if (isRegisterLocked) openOpenShiftModal();
    else openZReadingModal();
}

function syncRegisterLockState(serverStatus) {
    const shouldBeLocked = serverStatus === 'LOCKED';
    if (shouldBeLocked === isRegisterLocked) {
        checkRegisterLockState();
        return;
    }
    isRegisterLocked = shouldBeLocked;
    localStorage.setItem('isRegisterLocked', shouldBeLocked ? 'true' : 'false');
    checkRegisterLockState();
}

function openOpenShiftModal() {
    const modal = document.getElementById('openShiftModal');
    if (!modal) return;
    const dateSub = document.getElementById('openShiftSubDate');
    if (dateSub) {
        dateSub.textContent = `Shift Start: ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: '2-digit', year: 'numeric' })} at 10:00 AM`;
    }
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
}

function closeOpenShiftModal() {
    const modal = document.getElementById('openShiftModal');
    if (modal) {
        modal.classList.remove('open');
        document.body.style.overflow = '';
    }
}

async function confirmOpenShift() {
    const floatAmount = parseFloat(document.getElementById('openingFloatInput')?.value || 1000);
    if (isNaN(floatAmount) || floatAmount < 0) {
        showCustomAlert("Invalid Float Amount", "Please enter a valid cash float amount.", "warning");
        return;
    }
    localStorage.setItem('isRegisterLocked', 'false');
    isRegisterLocked = false;
    closeOpenShiftModal();
    checkRegisterLockState();
    showCustomAlert("Shift Started Successfully", `Register is now OPEN with float ₱${floatAmount.toFixed(2)}.`, "success");
}

async function openXReadingModal() {
    const modal = document.getElementById('xReadingModal');
    if (!modal) return;
    const dateSub = document.getElementById('xModalSubDate');
    if (dateSub) {
        dateSub.textContent = `Interim Snapshot: ${new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: '2-digit', year: 'numeric' })} at ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`;
    }
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';

    try {
        const userId = localStorage.getItem('userId') || sessionStorage.getItem('userId');
        const headers = {};
        if (userId) headers['x-user-id'] = userId;

        const response = await fetch('/api/sales-officer/x-reading', { headers });
        if (!response.ok) throw new Error(await SalesCommon.errorMessage(response));
        const data = await response.json();
        expectedCounterCash = data.expectedDrawer;
        latestXReading = data;

        document.getElementById('xPreOrdersCount').textContent = `${data.preordersCount} Claims`;
        document.getElementById('xEwalletAmount').textContent = '₱' + (data.digitalSubtotal || 0).toFixed(2);
        document.getElementById('xPresetsCount').textContent = `${data.presetsCount} Presets Sold`;
        document.getElementById('xWalkinCash').textContent = '₱' + (data.walkinCashTotal || 0).toFixed(2);
        document.getElementById('xExpectedDrawer').textContent = '₱' + (data.expectedDrawer || 0).toFixed(2);
        document.getElementById('xGrossTotal').textContent = '₱' + (data.grossTotal || 0).toFixed(2);
    } catch (error) {
        console.error('Could not load X-Reading data:', error);
        showCustomAlert('Error', 'Real sales data could not be fetched.', 'warning');
    }
}

function closeXReadingModal() {
    const modal = document.getElementById('xReadingModal');
    if (modal) {
        modal.classList.remove('open');
        document.body.style.overflow = '';
    }
}

async function openZReadingModal() {
    if (isRegisterLocked) {
        showCustomAlert("Shift Already Closed", "This shift has already been concluded with a Z-Reading.", "warning");
        return;
    }
    const modal = document.getElementById('zReadingModal');
    if (!modal) return;
    const cashInput = document.getElementById('zActualCashInput');
    if (cashInput) cashInput.value = '';

    modal.classList.add('open');
    document.body.style.overflow = 'hidden';

    try {
        const userId = localStorage.getItem('userId') || sessionStorage.getItem('userId');
        const headers = {};
        if (userId) headers['x-user-id'] = userId;

        const response = await fetch('/api/sales-officer/x-reading', { headers });
        if (!response.ok) throw new Error(await SalesCommon.errorMessage(response));
        const data = await response.json();
        expectedCounterCash = data.expectedDrawer;
        latestXReading = data;

        document.getElementById('zPreOrdersCount').textContent = `${data.preordersCount} Orders`;
        document.getElementById('zClaimedAmount').textContent = '₱' + (data.digitalSubtotal || 0).toFixed(2);
        document.getElementById('zEwalletAmount').textContent = '₱' + (data.digitalSubtotal || 0).toFixed(2);
        document.getElementById('zUnclaimedAmount').textContent = '₱0.00';
        document.getElementById('zPresetsCount').textContent = `${data.presetsCount} Cups Sold`;
        document.getElementById('zExpectedCash').textContent = '₱' + (data.expectedDrawer || 0).toFixed(2);
    } catch (error) {
        console.error('Could not refresh totals:', error);
        showCustomAlert('Error', 'Sales data could not be fetched.', 'warning');
    }
    calculateZVariance();
}

function closeZReadingModal() {
    const modal = document.getElementById('zReadingModal');
    if (modal) {
        modal.classList.remove('open');
        document.body.style.overflow = '';
    }
}

function calculateZVariance() {
    const actualInput = parseFloat(document.getElementById('zActualCashInput')?.value || 0);
    const variance = actualInput - expectedCounterCash;
    const varNumEl = document.getElementById('zVarianceValue');
    const varPillEl = document.getElementById('zVarianceStatus');

    if (!varNumEl || !varPillEl) return;
    if (isNaN(actualInput) || actualInput === 0) {
        varNumEl.textContent = '₱0.00';
        varNumEl.style.color = '#8C6D6D';
        varPillEl.className = 'var-status-pill neutral';
        varPillEl.textContent = 'Awaiting Count';
        return;
    }

    const varFormatted = '₱' + Math.abs(variance).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (variance === 0) {
        varNumEl.textContent = '₱0.00';
        varNumEl.style.color = '#2E7D32';
        varPillEl.className = 'var-status-pill exact';
        varPillEl.textContent = 'Exact Balanced';
    } else if (variance < 0) {
        varNumEl.textContent = `-${varFormatted}`;
        varNumEl.style.color = '#C9302C';
        varPillEl.className = 'var-status-pill short';
        varPillEl.textContent = 'Shortage';
    } else {
        varNumEl.textContent = `+${varFormatted}`;
        varNumEl.style.color = '#B26A00';
        varPillEl.className = 'var-status-pill over';
        varPillEl.textContent = 'Overage';
    }
}

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

function promptZReadingConfirmation() {
    const actualCash = parseFloat(document.getElementById('zActualCashInput')?.value);
    if (isNaN(actualCash) || actualCash < 0) {
        showCustomAlert("Incomplete Cash Count", "Please enter the actual physical cash counted in the drawer.", "warning");
        return;
    }
    const variance = actualCash - expectedCounterCash;
    document.getElementById('confirmExpectedCash').textContent = '₱' + expectedCounterCash.toFixed(2);
    document.getElementById('confirmActualCash').textContent = '₱' + actualCash.toFixed(2);
    document.getElementById('confirmVariance').textContent = `${variance >= 0 ? '+' : ''}₱${variance.toFixed(2)}`;

    const confirmModal = document.getElementById('customConfirmModal');
    if (confirmModal) {
        confirmModal.classList.add('open');
        document.body.style.overflow = 'hidden';
    }
}

function closeCustomConfirm() {
    const confirmModal = document.getElementById('customConfirmModal');
    if (confirmModal) {
        confirmModal.classList.remove('open');
        document.body.style.overflow = '';
    }
}

async function executeLockdown() {
    closeCustomConfirm();
    const actualCash = parseFloat(document.getElementById('zActualCashInput')?.value) || 0;
    const variance = actualCash - expectedCounterCash;

    try {
        const userId = localStorage.getItem('userId') || sessionStorage.getItem('userId');
        const headers = { 'Content-Type': 'application/json' };
        if (userId) headers['x-user-id'] = userId;

        const payload = {
            actual_cash: actualCash,
            expected_cash: expectedCounterCash,
            variance: variance,
            notes: `Z-Reading | Digital: ₱${(latestXReading?.digitalSubtotal ?? 0).toFixed(2)} | Cash: ₱${(latestXReading?.walkinCashTotal ?? 0).toFixed(2)}`
        };

        const response = await fetch('/api/sales-officer/z-reading', {
            method: 'POST',
            headers,
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        if (!response.ok || data.status !== 'success') throw new Error(data.message || 'Server rejected Z-Reading.');

        localStorage.setItem('latestZReport', JSON.stringify(data.record));
        localStorage.setItem('isRegisterLocked', 'true');
        isRegisterLocked = true;
        closeZReadingModal();
        checkRegisterLockState();

        showCustomAlert("Z-Reading Transmitted", "Sales counter locked. Report sent to Financial Officer.", "success");
    } catch (error) {
        console.error('Z-Reading save failed:', error);
        showCustomAlert("Failed", error.message, "warning");
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