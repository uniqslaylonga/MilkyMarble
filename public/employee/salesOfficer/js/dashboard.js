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

// Global SweetAlert2 Config
const MMSwal = Swal.mixin({
    customClass: {
        popup: 'mm-swal-popup',
        title: 'mm-swal-title',
        confirmButton: 'mm-swal-confirm',
        cancelButton: 'mm-swal-cancel'
    },
    buttonsStyling: false
});

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

    const pitchTypeSelect = document.getElementById('pitchDiscountType');
    const pitchValLabel = document.getElementById('pitchDiscountValLabel');
    if (pitchTypeSelect && pitchValLabel) {
        pitchTypeSelect.addEventListener('change', (e) => {
            pitchValLabel.textContent = e.target.value === 'percent'
                ? 'Discount Value * (%)'
                : 'Discount Value * (\u20B1 Fixed)';
        });
    }

    const aiDateSelector = document.getElementById('aiDateSelector');
    if (aiDateSelector) {
        aiDateSelector.addEventListener('change', async (e) => {
            await fetchAiSentimentReport(e.target.value);
        });
    }

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

    const weeklyCtx = document.getElementById('weeklyInflowChart');
    if (weeklyCtx) {
        weeklyRevenueChartInstance = new Chart(weeklyCtx.getContext('2d'), {
            type: 'bar',
            data: {
                labels: ['3 Wks Ago', '2 Wks Ago', 'Last Week', 'This Week'],
                datasets: [{
                    label: 'Inflow (\u20B1)',
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
                            label: (ctx) => `\u20B1${Number(ctx.raw || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`
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

        // User Header
        const userNameEl = document.getElementById('userName');
        const userFirstNameEl = document.getElementById('userFirstName');
        if (data.user && data.user.fullName) {
            if (userNameEl) userNameEl.textContent = data.user.fullName;
            if (userFirstNameEl) userFirstNameEl.textContent = data.user.firstName || data.user.fullName;
        }

        // Today's Performance
        const todayOrdersEl = document.getElementById('todayOrders');
        const todaySalesEl = document.getElementById('todaySales');
        const pendingOrdersEl = document.getElementById('pendingOrders');

        if (todayOrdersEl && data.metrics) todayOrdersEl.textContent = Number(data.metrics.todayOrders || 0).toLocaleString();
        if (todaySalesEl && data.metrics) {
            todaySalesEl.textContent = '\u20B1' + Number(data.metrics.todaySales || 0).toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            });
        }
        if (pendingOrdersEl && data.metrics) pendingOrdersEl.textContent = Number(data.metrics.pendingOrders || 0).toLocaleString();

        // Customer Acquisition
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

        allFetchedOrders = data.recentOrders || [];
        updateWeeklyInflowAndDSS();
        applyTransactionFilters();

        await fetchAiSentimentReport();

    } catch (error) {
        console.error('Could not load live data from the server:', error);
        MMSwal.fire({
            icon: 'warning',
            title: 'System Communication Notice',
            text: 'Unable to synchronize real-time sales records. Please verify local network connection.'
        });
        SalesCommon.failTables();
    }
}

// Fetch AI Sentiment Report
async function fetchAiSentimentReport(selectedDate = '') {
    try {
        const userId = localStorage.getItem('userId') || sessionStorage.getItem('userId');
        const headers = {};
        if (userId) headers['x-user-id'] = userId;

        const url = selectedDate 
            ? `/api/sales-officer/ai-sentiment?date=${encodeURIComponent(selectedDate)}`
            : '/api/sales-officer/ai-sentiment';

        const res = await fetch(url, { headers });
        if (!res.ok) return;

        const data = await res.json();
        if (data.status !== 'success' || !data.report) return;

        const report = data.report;
        const availableDates = data.availableDates || [];

        const dateSelect = document.getElementById('aiDateSelector');
        if (dateSelect && dateSelect.options.length <= 1 && availableDates.length > 0) {
            dateSelect.innerHTML = availableDates.map(d => {
                const label = new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                return `<option value="${d}" ${d === data.selectedDate ? 'selected' : ''}>${label}</option>`;
            }).join('');
        }

        const csatEl = document.getElementById('aiCsatScore');
        const reviewsCountEl = document.getElementById('aiReviewsCount');
        const dateLabelEl = document.getElementById('aiReportDateLabel');
        const summaryTextEl = document.getElementById('aiExecutiveSummary');

        if (csatEl) csatEl.textContent = parseFloat(report.average_csat || 5.0).toFixed(1);
        if (reviewsCountEl) reviewsCountEl.textContent = `${report.total_reviews_analyzed || 0} Reviews Analyzed`;
        if (dateLabelEl && data.selectedDate) {
            dateLabelEl.textContent = `Report: ${new Date(data.selectedDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
        }

        const breakdown = report.sentiment_breakdown || { positive: 85, neutral: 10, negative: 5 };
        const pos = parseInt(breakdown.positive, 10) || 0;
        const neu = parseInt(breakdown.neutral, 10) || 0;
        const neg = parseInt(breakdown.negative, 10) || 0;

        const barPos = document.getElementById('barPositive');
        const barNeu = document.getElementById('barNeutral');
        const barNeg = document.getElementById('barNegative');
        const pctPos = document.getElementById('pctPositive');
        const pctNeu = document.getElementById('pctNeutral');
        const pctNeg = document.getElementById('pctNegative');

        if (barPos) barPos.style.width = `${pos}%`;
        if (barNeu) barNeu.style.width = `${neu}%`;
        if (barNeg) barNeg.style.width = `${neg}%`;

        if (pctPos) pctPos.textContent = `${pos}%`;
        if (pctNeu) pctNeu.textContent = `${neu}%`;
        if (pctNeg) pctNeg.textContent = `${neg}%`;

        if (summaryTextEl) {
            const summary = report.raw_ai_summary || report.summary_text || 'Positive operational sentiment maintained across active jelly beverage lines.';
            summaryTextEl.textContent = summary;
        }

    } catch (e) {
        console.warn('[AI Quality Card Sync Warning]:', e.message);
    }
}

// On-Demand Manual Trigger para sa Comprehensive AI Summary (Berdeng Checkmark + Redirection)
async function triggerManualAiPulse() {
    const btn = document.getElementById('btnRunAiPulse');
    if (btn) btn.disabled = true;

    MMSwal.fire({
        title: 'Synthesizing Reviews...',
        html: 'Analyzing customer feedback, rating scores, and product tags...',
        allowOutsideClick: false,
        didOpen: () => {
            Swal.showLoading();
        }
    });

    try {
        const userId = localStorage.getItem('userId') || sessionStorage.getItem('userId');
        const headers = { 'Content-Type': 'application/json' };
        if (userId) headers['x-user-id'] = userId;

        const response = await fetch('/api/sales-officer/ai-sentiment/generate', {
            method: 'POST',
            headers
        });

        const data = await response.json();
        if (!response.ok || data.status !== 'success') {
            throw new Error(data.message || 'Failed to generate AI report.');
        }

        const report = data.report;

        // 1. I-update ang Dashboard Card
        const summaryTextEl = document.getElementById('aiExecutiveSummary');
        const csatEl = document.getElementById('aiCsatScore');
        const reviewsCountEl = document.getElementById('aiReviewsCount');

        if (summaryTextEl) summaryTextEl.textContent = report.raw_ai_summary || report.summary_text;
        if (csatEl) csatEl.textContent = parseFloat(report.average_csat || 5.0).toFixed(1);
        if (reviewsCountEl) reviewsCountEl.textContent = `${report.total_reviews_analyzed || 0} Reviews Analyzed`;

        // 2. I-update ang Progress Bars sa Card
        const breakdown = report.sentiment_breakdown || {};
        const pos = parseInt(breakdown.positive, 10) || 0;
        const neu = parseInt(breakdown.neutral, 10) || 0;
        const neg = parseInt(breakdown.negative, 10) || 0;

        const barPos = document.getElementById('barPositive');
        const barNeu = document.getElementById('barNeutral');
        const barNeg = document.getElementById('barNegative');
        if (barPos) barPos.style.width = `${pos}%`;
        if (barNeu) barNeu.style.width = `${neu}%`;
        if (barNeg) barNeg.style.width = `${neg}%`;

        const pctPos = document.getElementById('pctPositive');
        const pctNeu = document.getElementById('pctNeutral');
        const pctNeg = document.getElementById('pctNegative');
        if (pctPos) pctPos.textContent = `${pos}%`;
        if (pctNeu) pctNeu.textContent = `${neu}%`;
        if (pctNeg) pctNeg.textContent = `${neg}%`;

        // 3. I-render ang Comprehensive Modal (Quotes + Actions + Count)
        const customerVoice = report.sales_insights?.customer_voice || [];
        const actions = report.kitchen_quality_alerts?.operational_actions || report.kitchen_quality_alerts?.alerts || [];

        let voiceHtml = '';
        if (customerVoice.length > 0) {
            voiceHtml = customerVoice.map(v => {
                const isPos = v.type === 'positive';
                const borderColor = isPos ? '#2E7D32' : '#C9302C';
                const badgeBg = isPos ? 'rgba(46, 125, 50, 0.12)' : 'rgba(201, 48, 44, 0.12)';
                const badgeColor = isPos ? '#2E7D32' : '#C9302C';
                const label = isPos ? 'Praise' : 'Pain Point';

                return `
                  <div style="background: #ffffff; border-left: 3px solid ${borderColor}; padding: 8px 12px; border-radius: 8px; margin-bottom: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                      <span style="font-size: 10px; font-weight: 800; text-transform: uppercase; background: ${badgeBg}; color: ${badgeColor}; padding: 2px 6px; border-radius: 4px;">${label}</span>
                      <small style="color: var(--text-muted); font-size: 10.5px;">${escapeHtml(v.context || 'Verified Order')}</small>
                    </div>
                    <p style="font-style: italic; margin: 0; color: var(--text-dark); font-size: 12px;">"${escapeHtml(v.quote || '')}"</p>
                  </div>
                `;
            }).join('');
        } else {
            voiceHtml = '<p style="font-size: 11.5px; color: var(--text-muted); margin: 0;">No written comments recorded for this batch.</p>';
        }

        const actionsHtml = actions.map(act => `<li style="margin-bottom: 4px;">${escapeHtml(act)}</li>`).join('');

        // Modal gamit ang Berdeng Checkmark (icon: 'success') at Redirection Link
        const swalResult = await MMSwal.fire({
            icon: 'success',
            title: 'Shift Quality & Voice of Customer',
            html: `
              <div style="text-align: left; font-size: 12px; line-height: 1.45; color: var(--text-dark);">
                <div style="background: var(--card-sub-bg); padding: 10px 14px; border-radius: 10px; margin-bottom: 12px; border-left: 3px solid var(--accent-pink);">
                  <strong style="color: var(--brown-soft); font-size: 12.5px;">Performance Summary:</strong><br>
                  ${escapeHtml(report.raw_ai_summary || report.summary_text)}
                </div>

                <div style="margin-bottom: 12px;">
                  <strong style="color: var(--brown-soft); font-size: 12px; display: block; margin-bottom: 6px;">Voice of Customer (Anonymized Quotes):</strong>
                  ${voiceHtml}
                </div>

                <div>
                  <strong style="color: var(--brown-soft); font-size: 12px; display: block; margin-bottom: 4px;">Immediate Shift Actions:</strong>
                  <ul style="margin: 0; padding-left: 18px; color: var(--text-dark); font-size: 11.5px;">
                    ${actionsHtml}
                  </ul>
                </div>
              </div>
            `,
            showCancelButton: true,
            confirmButtonText: 'Understood',
            cancelButtonText: 'View in Customer Records &rarr;'
        });

        if (swalResult.dismiss === Swal.DismissReason.cancel) {
            window.location.href = 'customerRecords.html';
        }

    } catch (err) {
        console.error('Manual AI Pulse Error:', err);
        MMSwal.fire({
            icon: 'warning',
            title: 'Synthesis Warning',
            text: err.message
        });
    } finally {
        if (btn) btn.disabled = false;
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

    if (thisWeekEl) thisWeekEl.textContent = '\u20B1' + thisWeek.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (lastWeekEl) lastWeekEl.textContent = '\u20B1' + lastWeek.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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
    const segmentSelect = document.getElementById('pitchTargetSegment');
    const typeSelect = document.getElementById('pitchDiscountType');
    const valInput = document.getElementById('pitchDiscountValue');
    const minSpendInput = document.getElementById('pitchMinSpend');
    const usageCapInput = document.getElementById('pitchUsageCap');
    const noteInput = document.getElementById('pitchNote');

    if (codeInput) codeInput.value = '';
    if (segmentSelect) segmentSelect.value = 'all';
    if (typeSelect) typeSelect.value = 'percent';
    if (valInput) valInput.value = '';
    if (minSpendInput) minSpendInput.value = '';
    if (usageCapInput) usageCapInput.value = '';
    if (noteInput) noteInput.value = 'DSS-triggered initiative: Low weekly inflow detected. Recommending a discount to boost pre-orders.';

    modal.classList.add('open');
}

function closePitchPromoModal() {
    const modal = document.getElementById('pitchPromoModal');
    if (modal) modal.classList.remove('open');
}

async function submitPromoPitch() {
    const code = document.getElementById('pitchPromoCode')?.value.trim().toUpperCase();
    const target_segment = document.getElementById('pitchTargetSegment')?.value || 'all';
    const discount_type = document.getElementById('pitchDiscountType')?.value || 'percent';
    const discount_value = parseFloat(document.getElementById('pitchDiscountValue')?.value);
    const min_spend_raw = document.getElementById('pitchMinSpend')?.value;
    const usage_cap_raw = document.getElementById('pitchUsageCap')?.value;
    const min_spend = min_spend_raw ? parseFloat(min_spend_raw) : null;
    const usage_cap = usage_cap_raw ? parseInt(usage_cap_raw, 10) : null;
    const pitch_note = document.getElementById('pitchNote')?.value.trim();

    if (!code || isNaN(discount_value) || discount_value <= 0) {
        MMSwal.fire({
            icon: 'warning',
            title: 'Incomplete Details',
            text: 'Please provide a valid promo code and discount amount.'
        });
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
                target_segment,
                discount_type,
                discount_value,
                min_spend,
                usage_cap,
                pitch_note: pitch_note || 'DSS sales recovery recommendation'
            })
        });

        const resData = await response.json();
        if (!response.ok || resData.status !== 'success') {
            throw new Error(resData.message || 'Failed to submit promotional pitch.');
        }

        closePitchPromoModal();
        MMSwal.fire({
            icon: 'success',
            title: 'Promotion Pitched',
            text: `Promo code ${code} has been transmitted directly to CEO for approval.`
        });
    } catch (err) {
        console.error('Error submitting promo pitch:', err);
        MMSwal.fire({
            icon: 'warning',
            title: 'Pitch Submission Failed',
            text: err.message
        });
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
                    <div class="order-amount-display">\u20B1${amount}</div>
                </div>
                <div class="row-item-footer">
                    <span class="order-meta-info">${escapeHtml(ord.order_number || '')} &bull; ${dateFormatted}</span>
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
            bannerText.innerHTML = '<span class="status-pulse-dot"></span><strong>Shift Closed &amp; Register Locked</strong> \u2014 Transmitted to Finance';
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
            bannerText.innerHTML = '<span class="status-pulse-dot"></span>Register Open \u2022 Tuesday &amp; Thursday Release Window (10:00 AM – 3:00 PM)';
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
}

function closeOpenShiftModal() {
    const modal = document.getElementById('openShiftModal');
    if (modal) modal.classList.remove('open');
}

async function confirmOpenShift() {
    const floatAmount = parseFloat(document.getElementById('openingFloatInput')?.value || 1000);
    if (isNaN(floatAmount) || floatAmount < 0) {
        MMSwal.fire({
            icon: 'warning',
            title: 'Invalid Float Amount',
            text: 'Please enter a valid cash float amount.'
        });
        return;
    }

    try {
        const userId = localStorage.getItem('userId') || sessionStorage.getItem('userId');
        const headers = { 'Content-Type': 'application/json' };
        if (userId) headers['x-user-id'] = userId;

        const response = await fetch('/api/sales-officer/open-shift', {
            method: 'POST',
            headers,
            body: JSON.stringify({ opening_float: floatAmount })
        });
        if (!response.ok) throw new Error(await SalesCommon.errorMessage(response));

        localStorage.setItem('isRegisterLocked', 'false');
        isRegisterLocked = false;
        closeOpenShiftModal();
        checkRegisterLockState();
        MMSwal.fire({
            icon: 'success',
            title: 'Shift Started Successfully',
            text: `Register is now OPEN with float \u20B1${floatAmount.toFixed(2)}.`
        });
    } catch (error) {
        console.error('Could not open shift:', error);
        MMSwal.fire({
            icon: 'warning',
            title: 'Action Failed',
            text: 'Could not save opening float. Please try again.'
        });
    }
}

async function openXReadingModal() {
    const modal = document.getElementById('xReadingModal');
    if (!modal) return;
    const dateSub = document.getElementById('xModalSubDate');
    if (dateSub) {
        dateSub.textContent = `Interim Snapshot: ${new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: '2-digit', year: 'numeric' })} at ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`;
    }
    modal.classList.add('open');

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
        document.getElementById('xEwalletAmount').textContent = '\u20B1' + (data.eWalletTotal || 0).toFixed(2);
        document.getElementById('xPresetsCount').textContent = `${data.presetsCount} Presets Sold`;
        document.getElementById('xWalkinCash').textContent = '\u20B1' + (data.walkinCashTotal || 0).toFixed(2);
        document.getElementById('xExpectedDrawer').textContent = '\u20B1' + (data.expectedDrawer || 0).toFixed(2);
        document.getElementById('xGrossTotal').textContent = '\u20B1' + (data.grossTotal || 0).toFixed(2);
    } catch (error) {
        console.error('Could not load X-Reading data:', error);
        MMSwal.fire({
            icon: 'warning',
            title: 'Error',
            text: 'Real-time sales snapshot could not be fetched.'
        });
    }
}

function closeXReadingModal() {
    const modal = document.getElementById('xReadingModal');
    if (modal) modal.classList.remove('open');
}

async function openZReadingModal() {
    if (isRegisterLocked) {
        MMSwal.fire({
            icon: 'warning',
            title: 'Shift Already Closed',
            text: 'This operational shift has already been concluded with a Z-Reading.'
        });
        return;
    }
    const modal = document.getElementById('zReadingModal');
    if (!modal) return;
    const cashInput = document.getElementById('zActualCashInput');
    if (cashInput) cashInput.value = '';

    modal.classList.add('open');

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
        document.getElementById('zClaimedAmount').textContent = '\u20B1' + (data.claimedAmount || 0).toFixed(2);
        document.getElementById('zEwalletAmount').textContent = '\u20B1' + (data.eWalletTotal || 0).toFixed(2);
        document.getElementById('zUnclaimedAmount').textContent = '\u20B1' + (data.unclaimedAmount || 0).toFixed(2);
        document.getElementById('zPresetsCount').textContent = `${data.presetsCount} Cups Sold`;
        document.getElementById('zExpectedCash').textContent = '\u20B1' + (data.expectedDrawer || 0).toFixed(2);
    } catch (error) {
        console.error('Could not refresh totals:', error);
        MMSwal.fire({
            icon: 'warning',
            title: 'Error',
            text: 'End-of-shift metrics could not be fetched.'
        });
    }
    calculateZVariance();
}

function closeZReadingModal() {
    const modal = document.getElementById('zReadingModal');
    if (modal) modal.classList.remove('open');
}

function calculateZVariance() {
    const actualInput = parseFloat(document.getElementById('zActualCashInput')?.value || 0);
    const variance = actualInput - expectedCounterCash;
    const varNumEl = document.getElementById('zVarianceValue');
    const varPillEl = document.getElementById('zVarianceStatus');

    if (!varNumEl || !varPillEl) return;
    if (isNaN(actualInput) || actualInput === 0) {
        varNumEl.textContent = '\u20B10.00';
        varNumEl.style.color = '#8C6D6D';
        varPillEl.className = 'var-status-pill neutral';
        varPillEl.textContent = 'Awaiting Count';
        return;
    }

    const varFormatted = '\u20B1' + Math.abs(variance).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (variance === 0) {
        varNumEl.textContent = '\u20B10.00';
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

async function promptZReadingConfirmation() {
    const actualCash = parseFloat(document.getElementById('zActualCashInput')?.value);
    if (isNaN(actualCash) || actualCash < 0) {
        MMSwal.fire({
            icon: 'warning',
            title: 'Incomplete Cash Count',
            text: 'Please enter actual physical cash counted in drawer before locking.'
        });
        return;
    }
    const variance = actualCash - expectedCounterCash;

    const result = await MMSwal.fire({
        title: 'Confirm End-of-Shift Z-Reading?',
        html: `Expected Cash: <strong>\u20B1${expectedCounterCash.toFixed(2)}</strong><br>Actual Drawer: <strong>\u20B1${actualCash.toFixed(2)}</strong><br>Variance: <strong>${variance >= 0 ? '+' : ''}\u20B1${variance.toFixed(2)}</strong><br><br><span style="color:#C9302C;font-size:12px;">Notice: Register will be locked permanently and background AI sentiment analysis will execute.</span>`,
        showCancelButton: true,
        confirmButtonText: 'Lock & Transmit',
        cancelButtonText: 'Cancel'
    });

    if (result.isConfirmed) {
        executeLockdown();
    }
}

async function executeLockdown() {
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
            notes: `Z-Reading | Digital: \u20B1${(latestXReading?.eWalletTotal ?? 0).toFixed(2)} | Cash: \u20B1${(latestXReading?.walkinCashTotal ?? 0).toFixed(2)}`
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

        MMSwal.fire({
            icon: 'success',
            title: 'Z-Reading Transmitted',
            text: 'Sales counter locked. Shift collection transmitted to Finance Officer and AI review analysis initiated.'
        });

        setTimeout(() => fetchAiSentimentReport(), 1500);

    } catch (error) {
        console.error('Z-Reading save failed:', error);
        MMSwal.fire({
            icon: 'warning',
            title: 'Z-Reading Failed',
            text: error.message
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