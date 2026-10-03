let currentFinancialData = null;

// Day 1 & DSO Cycle State (Default benchmark: October 8, 2026 SOP Section 7.B)
let cycleStartDate = '2026-10-08';

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
    fetchFinancialReportsData();

    document.getElementById('reportCycleSelector')?.addEventListener('change', () => {
        fetchFinancialReportsData();
    });
});

const toNum = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v))) ? null : Number(v);

function money(v, parens) {
    const n = toNum(v);
    if (n === null) return '—';
    const t = '₱' + formatAmount(n);
    return parens ? '(' + t + ')' : t;
}

function getAuthHeaders() {
    const userId = localStorage.getItem('userId') || sessionStorage.getItem('userId');
    const headers = { 'Content-Type': 'application/json' };
    if (userId) headers['x-user-id'] = userId;
    return headers;
}

async function fetchFinancialReportsData() {
    try {
        const headers = getAuthHeaders();
        const response = await fetch('/api/finance-officer/reports', { headers });

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.message || 'Could not load reports figures from server.');
        }

        const data = await response.json();

        if (data.cycleStartDate) {
            cycleStartDate = data.cycleStartDate;
        }

        const user = data.user || {};
        const userNameEl = document.getElementById('userName');
        const userAvatarEl = document.getElementById('userAvatar');
        if (userNameEl) userNameEl.textContent = user.fullName || 'Financial Officer';
        if (userAvatarEl && user.avatarSrc) userAvatarEl.src = user.avatarSrc;
        setText('pdfReportingOfficer', user.fullName || 'Financial Officer');

        currentFinancialData = data.financialData || {};
        renderReportsDashboard(currentFinancialData);

    } catch (error) {
        console.error('Could not load financial report figures:', error);
        MMSwal.fire({
            icon: 'warning',
            title: 'System Notice',
            text: error.message || 'Could not load accounting ledger from Supabase.'
        });
    }
}

function renderReportsDashboard(data) {
    if (!data) return;

    // 1. KPI Cards
    setText('kpiGrossRevenue', money(data.grossRevenue));
    setText('kpiCogsTotal', money(data.cogsRaw));
    setText('kpiOperatingExpenses', money(data.totalDisbursements));
    setText('kpiNetProfit', money(data.netIncome));
    setText('kpiMarginFooter', `Net Profit Margin: ${data.netProfitMarginPct === null ? '0.0%' : data.netProfitMarginPct + '%'}`);

    // 2. P&L Table
    setText('pnlPreorderSales', money(data.preorderSales));
    setText('pnlPresetSales', money(data.presetSales));
    setText('pnlGrossRevenue', money(data.grossRevenue));

    setText('pnlIngredientsCost', money(data.ingredientsCost));
    setText('pnlPackagingCost', money(data.packagingCost));
    setText('pnlTotalCogs', money(data.cogsRaw, true));

    setText('pnlGrossProfit', money(data.grossProfit));

    setText('pnlDirectBuyExp', money(data.directBuysExp));
    setText('pnlOverheadExp', money(data.overheadExp));
    setText('pnlMarketingExp', money(data.marketingExp));
    setText('pnlTotalDisbursements', money(data.totalDisbursements, true));

    setText('pnlNetOperatingIncome', money(data.netIncome));

    // 3. 45-day Collection Window
    renderDsoSentinel();

    // 4. Cash Drawer Status
    renderDrawerStatus(data.latestReconciliation);
}

function renderDsoSentinel() {
    const start = new Date(cycleStartDate);
    const today = new Date();
    start.setHours(0, 0, 0, 0);
    today.setHours(0, 0, 0, 0);

    const diffDays = Math.max(1, Math.floor((today - start) / (1000 * 60 * 60 * 24)) + 1);
    const currentDay = Math.min(diffDays, 45);
    const pct = ((currentDay / 45) * 100).toFixed(1);

    setText('dsoCurrentDaysText', `Day ${currentDay} of 45 Days`);
    setText('pdfDsoDays', `Day ${currentDay} of 45`);
    const progressFill = document.getElementById('dsoProgressFill');
    if (progressFill) progressFill.style.width = `${pct}%`;

    const badge = document.getElementById('dsoBadgeIndicator');
    const copy = document.getElementById('dsoInsightCopy');

    if (diffDays <= 45) {
        if (badge) {
            badge.className = 'badge-dso-target good';
            badge.textContent = 'Term: ≤ 45 Days';
        }
        if (copy) {
            copy.textContent = `Operating cycle is at day ${currentDay} of 45. Collections from Tuesday and Thursday releases are within the healthy working capital liquidity threshold.`;
        }
    } else {
        if (badge) {
            badge.className = 'badge-dso-target warn';
            badge.textContent = 'Term: Over 45 Days';
        }
        if (copy) {
            copy.textContent = `Cycle day ${diffDays}: exceeded the standard 45-day cycle window. Review outstanding account collections.`;
        }
    }
}

function renderDrawerStatus(recon) {
    const varEl = document.getElementById('drawerAuditVariance');
    if (!recon) {
        setText('drawerCashSalesExpected', '—');
        setText('drawerPhysicalCounted', '—');
        setText('drawerAuditVariance', '₱0.00');
        if (varEl) varEl.style.color = '#2E7D32';
        setText('lastReconciledTimestamp', 'Last Reconciled: Register open');
        return;
    }

    setText('drawerCashSalesExpected', money(recon.expected_amount));
    setText('drawerPhysicalCounted', money(recon.counted_amount));

    const variance = toNum(recon.variance);
    if (varEl) {
        if (variance === null) {
            varEl.textContent = '—';
            varEl.style.color = '';
        } else {
            const prefix = variance > 0 ? '+' : '';
            varEl.textContent = prefix + '₱' + formatAmount(variance);
            varEl.style.color = variance === 0 ? '#2E7D32' : '#C9302C';
        }
    }

    const when = recon.period_end || recon.created_at;
    const d = when ? new Date(when) : null;
    setText('lastReconciledTimestamp', d && !isNaN(d.getTime())
        ? `Reconciled: ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
        : 'Reconciled');
}

// Corporate Executive PDF Export Standard (MM-SOP-MASTER-2026 Section 8)
async function exportFinancialReportToPDF() {
    if (!currentFinancialData) {
        MMSwal.fire({
            icon: 'warning',
            title: 'Audit Incomplete',
            text: 'Financial data is still compiling. Please wait a moment.'
        });
        return;
    }

    const todayStr = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    setText('pdfReportDate', `Date: ${todayStr}`);
    setText('pdfPreorderSales', money(currentFinancialData.preorderSales));
    setText('pdfPresetSales', money(currentFinancialData.presetSales));
    setText('pdfGrossRevenue', money(currentFinancialData.grossRevenue));

    setText('pdfIngredientsCost', money(currentFinancialData.ingredientsCost));
    setText('pdfPackagingCost', money(currentFinancialData.packagingCost));
    setText('pdfTotalCogs', money(currentFinancialData.cogsRaw, true));

    setText('pdfGrossProfit', money(currentFinancialData.grossProfit));

    setText('pdfDirectBuyExp', money(currentFinancialData.directBuysExp));
    setText('pdfOverheadExp', money(currentFinancialData.overheadExp));
    setText('pdfMarketingExp', money(currentFinancialData.marketingExp));
    setText('pdfTotalDisbursements', money(currentFinancialData.totalDisbursements, true));

    setText('pdfNetOperatingIncome', money(currentFinancialData.netIncome));

    const recon = currentFinancialData.latestReconciliation;
    setText('pdfDrawerDiscrepancy', recon ? money(recon.variance) : '₱0.00');

    const wrapper = document.getElementById('corporatePdfRenderWrapper');
    if (!wrapper) return;

    MMSwal.fire({
        title: 'Compiling Financial Statement',
        html: 'Formatting official P&L and corporate audit sign-offs into PDF...',
        allowOutsideClick: false,
        didOpen: () => {
            MMSwal.showLoading();
        }
    });

    wrapper.style.display = 'block';

    const opt = {
        margin: [8, 10, 8, 10],
        filename: `MilkyMarble_Financial_Audit_Report_${new Date().toISOString().split('T')[0]}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, logging: false },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };

    try {
        await html2pdf().set(opt).from(wrapper).save();
        wrapper.style.display = 'none';

        MMSwal.fire({
            icon: 'success',
            title: 'Audit PDF Generated',
            text: 'Official financial report has been downloaded with formal executive sign-off lines.'
        });
    } catch (err) {
        wrapper.style.display = 'none';
        console.error('PDF Export failed:', err);
        MMSwal.fire({
            icon: 'warning',
            title: 'Export Failed',
            text: err.message || 'Could not compile report to PDF.'
        });
    }
}

function formatAmount(val) {
    return Number(val || 0).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}