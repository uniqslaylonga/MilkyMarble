let currentFinancialData = null;

// Day 1 & DSO Cycle State (October 8, 2026 Benchmark as per SOP Section 7.B)
let cycleStartDate = localStorage.getItem('mm_cycle_start_date') || '2026-10-08';

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

    // Cycle selector event listener
    document.getElementById('reportCycleSelector')?.addEventListener('change', () => {
        fetchFinancialReportsData();
    });
});

// Money display: null means "the system does not record this" and shows as an em dash, never as 0.
const toNum = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v))) ? null : Number(v);

function money(v, parens) {
    const n = toNum(v);
    if (n === null) return '—';
    const t = '₱' + formatAmount(n);
    return parens ? '(' + t + ')' : t;
}

const EMPTY_FINANCIAL_DATA = {
    grossRevenue: null, preorderSales: null, presetSales: null,
    cogsRaw: null, ingredientsCost: null, packagingCost: null, grossProfit: null,
    directBuysExp: null, overheadExp: null, marketingExp: null,
    totalDisbursements: null, netIncome: null, netProfitMarginPct: null,
    latestReconciliation: null
};

async function fetchFinancialReportsData() {
    try {
        const userId = localStorage.getItem('userId') || sessionStorage.getItem('userId');
        const headers = userId ? { 'x-user-id': userId } : {};

        // 1. Revenue + recorded expense totals. If this fails we stop: no substitute figures.
        const revRes = await fetch('/api/finance-officer/revenue', { headers });
        const revData = await revRes.json().catch(() => ({}));
        if (!revRes.ok) {
            throw new Error(`Revenue API error ${revRes.status}: ${revData.message || 'Could not load revenue figures'}`);
        }

        // 2. Drawer reconciliation only feeds the audit card; if it fails that card shows "—".
        let payData = null;
        try {
            const payRes = await fetch('/api/finance-officer/payments', { headers });
            if (payRes.ok) payData = await payRes.json();
        } catch (e) {
            console.warn('Could not load drawer reconciliation:', e.message);
        }

        const user = revData.user || (payData && payData.user) || {};
        const userNameEl = document.getElementById('userName');
        const userAvatarEl = document.getElementById('userAvatar');
        if (userNameEl) userNameEl.textContent = user.fullName || 'Financial Officer';
        if (userAvatarEl && user.avatarSrc) userAvatarEl.src = user.avatarSrc;
        setText('pdfReportingOfficer', user.fullName || '—');

        // 3. Figures straight from the database. Anything not recorded stays null.
        const m = revData.metrics || {};
        const grossRevenue = toNum(m.totalRevenue);
        const preorderSales = toNum(m.preordersInflow);
        const presetSales = toNum(m.presetsInflow);
        const totalExpenses = toNum(m.totalExpenses);              // approved + purchased requisitions
        const cogsRecorded = toNum(m.totalCogs);
        const cogsRaw = cogsRecorded !== null && cogsRecorded > 0 ? cogsRecorded : null;   // needs expenses.category = 'cogs'

        const grossProfit = (grossRevenue !== null && cogsRaw !== null) ? grossRevenue - cogsRaw : null;
        // Non-COGS outflows; the ingredient/packaging and direct/overhead/marketing splits are not tracked.
        const totalDisbursements = totalExpenses !== null ? totalExpenses - (cogsRaw || 0) : null;
        const netIncome = (grossRevenue !== null && totalExpenses !== null) ? grossRevenue - totalExpenses : null;
        const netProfitMarginPct = (netIncome !== null && grossRevenue > 0)
            ? ((netIncome / grossRevenue) * 100).toFixed(1)
            : null;

        currentFinancialData = {
            grossRevenue,
            preorderSales,
            presetSales,
            cogsRaw,
            ingredientsCost: null,
            packagingCost: null,
            grossProfit,
            directBuysExp: null,
            overheadExp: null,
            marketingExp: null,
            totalDisbursements,
            netIncome,
            netProfitMarginPct,
            latestReconciliation: payData ? (payData.latestReconciliation || null) : null
        };

        renderReportsDashboard(currentFinancialData);

    } catch (error) {
        console.error('Could not load financial report figures:', error);
        currentFinancialData = null;
        renderReportsDashboard(EMPTY_FINANCIAL_DATA);
        MMSwal.fire({
            icon: 'warning',
            title: 'System Notice',
            text: error.message || 'Could not load the accounting ledger.'
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
    setText('kpiMarginFooter', `Net Profit Margin: ${data.netProfitMarginPct === null ? '—' : data.netProfitMarginPct + '%'}`);

    // 2. P&L table
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

    // 3. 45-day collection window
    renderDsoSentinel();

    // 4. Drawer Balancing Status
    renderDrawerStatus(data.latestReconciliation);
}

// 45-day cycle progress. This is a day counter from the configured cycle start,
// not a measured collection result, so the text makes no claims about performance.
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
            badge.textContent = 'Term: < 45 Days';
        }
        if (copy) {
            copy.textContent = `Cycle day ${currentDay} of 45. The target is to collect receivables within 45 days of the cycle start.`;
        }
    } else {
        if (badge) {
            badge.className = 'badge-dso-target warn';
            badge.textContent = 'Term: Over 45 Days';
        }
        if (copy) {
            copy.textContent = `Cycle day ${diffDays}: past the 45-day target window. Review outstanding receivables.`;
        }
    }
}

// Cash Drawer Audit Card
function renderDrawerStatus(recon) {
    const varEl = document.getElementById('drawerAuditVariance');
    if (!recon) {
        setText('drawerCashSalesExpected', '—');
        setText('drawerPhysicalCounted', '—');
        setText('drawerAuditVariance', '—');
        if (varEl) varEl.style.color = '';
        setText('lastReconciledTimestamp', 'Last Reconciled: none recorded');
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
            varEl.textContent = (variance >= 0 ? '+' : '-') + '₱' + formatAmount(Math.abs(variance));
            varEl.style.color = variance === 0 ? '#2E7D32' : '#C9302C';
        }
    }

    const when = recon.period_end || recon.created_at;
    const d = when ? new Date(when) : null;
    setText('lastReconciledTimestamp', d && !isNaN(d.getTime())
        ? `Reconciled: ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' })}`
        : 'Reconciled');
}

// ==========================================================================
// CORPORATE EXECUTIVE PDF EXPORT ENGINE (html2pdf.js)
// Adheres strictly to MM-SOP-MASTER-2026 Section 8 Standard
// ==========================================================================
async function exportFinancialReportToPDF() {
    if (!currentFinancialData) {
        MMSwal.fire({
            icon: 'warning',
            title: 'Audit Incomplete',
            text: 'Financial data is still compiling. Please wait a moment.'
        });
        return;
    }

    // Populate Hidden PDF Template
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
    setText('pdfDrawerDiscrepancy', recon ? money(recon.variance) : '—');

    const wrapper = document.getElementById('corporatePdfRenderWrapper');
    if (!wrapper) return;

    // Show temporary loader
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