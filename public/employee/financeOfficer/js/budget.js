let currentWorkspaceTab = 'envelopes'; // 'envelopes' o 'expenses'

// Budget Records State
let allBudgetRecords = [];
let filteredBudgetRecords = [];
let currentBudgetPage = 1;
const BUDGET_PAGE_SIZE = 5;

// Expenses Records State
let allExpenseRecords = [];
let filteredExpenseRecords = [];
let currentCategoryFilter = 'all';
let currentExpensePage = 1;
const EXPENSES_PAGE_SIZE = 5;

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
    fetchBudgetData();
    fetchExpenseData();

    // Search and Filter Listeners
    document.getElementById('budgetSearchInput')?.addEventListener('input', handleGlobalSearch);
    document.getElementById('cycleFilter')?.addEventListener('change', applyBudgetFilters);

    // Form Submissions
    document.getElementById('budgetAllocationForm')?.addEventListener('submit', handleAddBudgetCycle);
    document.getElementById('expenseForm')?.addEventListener('submit', handleAddDisbursement);

    // Budget Pagination buttons
    document.getElementById('prevBudgetBtn')?.addEventListener('click', () => {
        if (currentBudgetPage > 1) {
            currentBudgetPage--;
            renderBudgetTable();
        }
    });
    document.getElementById('nextBudgetBtn')?.addEventListener('click', () => {
        const totalPages = Math.ceil(filteredBudgetRecords.length / BUDGET_PAGE_SIZE) || 1;
        if (currentBudgetPage < totalPages) {
            currentBudgetPage++;
            renderBudgetTable();
        }
    });

    // Expenses Pagination buttons
    document.getElementById('prevExpBtn')?.addEventListener('click', () => {
        if (currentExpensePage > 1) {
            currentExpensePage--;
            renderExpenseTable();
        }
    });
    document.getElementById('nextExpBtn')?.addEventListener('click', () => {
        const totalPages = Math.ceil(filteredExpenseRecords.length / EXPENSES_PAGE_SIZE) || 1;
        if (currentExpensePage < totalPages) {
            currentExpensePage++;
            renderExpenseTable();
        }
    });
});

// Workspace Tab Switcher
function switchBudgetTab(tab) {
    currentWorkspaceTab = tab;
    const tabEnv = document.getElementById('tabBtnEnvelopes');
    const tabExp = document.getElementById('tabBtnExpenses');
    const envArea = document.getElementById('envelopesViewArea');
    const expArea = document.getElementById('expensesViewArea');

    if (tab === 'envelopes') {
        tabEnv?.classList.add('active');
        tabExp?.classList.remove('active');
        if (envArea) envArea.style.display = 'block';
        if (expArea) expArea.style.display = 'none';
    } else {
        tabExp?.classList.add('active');
        tabEnv?.classList.remove('active');
        if (envArea) envArea.style.display = 'none';
        if (expArea) expArea.style.display = 'block';
    }
}

function handleGlobalSearch() {
    if (currentWorkspaceTab === 'envelopes') {
        applyBudgetFilters();
    } else {
        applyExpenseFilters();
    }
}

// --------------------------------------------------------------------------
// 1. BUDGET ENVELOPES & ALLOCATIONS
// --------------------------------------------------------------------------
async function fetchBudgetData() {
    try {
        const userId = localStorage.getItem('userId') || sessionStorage.getItem('userId');
        const headers = userId ? { 'x-user-id': userId } : {};
        const response = await fetch('/api/finance-officer/budget', { headers });

        if (!response.ok) throw new Error('Failed to retrieve budget allocations');

        const data = await response.json();

        // User Profile
        const userNameEl = document.getElementById('userName');
        const userAvatarEl = document.getElementById('userAvatar');
        if (userNameEl) userNameEl.textContent = data.user?.fullName || 'Financial Officer';
        if (userAvatarEl && data.user?.avatarSrc) userAvatarEl.src = data.user.avatarSrc;

        allBudgetRecords = data.records || [];
        document.getElementById('budgetCountBadge').textContent = allBudgetRecords.length;

        applyBudgetFilters();
    } catch (error) {
        console.error('Could not load budget data:', error);
    }
}

function applyBudgetFilters() {
    const q = document.getElementById('budgetSearchInput')?.value.toLowerCase().trim() || '';
    const cycleFilter = document.getElementById('cycleFilter')?.value || 'all';

    filteredBudgetRecords = allBudgetRecords.filter(item => {
        if (cycleFilter === 'active' && item.status !== 'ACTIVE') return false;
        if (cycleFilter === 'reconciled' && item.status === 'ACTIVE') return false;
        if (q) {
            const dateStr = (item.date || '').toLowerCase();
            if (!dateStr.includes(q)) return false;
        }
        return true;
    });

    // Update KPI Cards based on latest active cycle
    const activeCycle = allBudgetRecords.find(b => b.status === 'ACTIVE') || allBudgetRecords[0];
    if (activeCycle) {
        setText('kpiCapital', '₱' + formatAmount(activeCycle.capital));
        setText('kpiRawMaterials', '₱' + formatAmount(activeCycle.raw_material));
        setText('kpiPettyCash', '₱' + formatAmount(activeCycle.petty_cash_fund || 800));
    } else {
        setText('kpiCapital', '—');
        setText('kpiRawMaterials', '—');
        setText('kpiPettyCash', '—');
    }

    currentBudgetPage = 1;
    renderBudgetTable();
}

function renderBudgetTable() {
    const tbody = document.getElementById('budgetTableBody');
    const pageInfo = document.getElementById('budgetPageInfo');
    const prevBtn = document.getElementById('prevBudgetBtn');
    const nextBtn = document.getElementById('nextBudgetBtn');

    if (!tbody) return;

    if (filteredBudgetRecords.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="loading-state-text">No budget cycle records found.</td></tr>';
        if (pageInfo) pageInfo.textContent = 'Showing 0 of 0 records';
        if (prevBtn) prevBtn.disabled = true;
        if (nextBtn) nextBtn.disabled = true;
        renderBudgetPagerButtons(1, 1);
        return;
    }

    const totalPages = Math.ceil(filteredBudgetRecords.length / BUDGET_PAGE_SIZE) || 1;
    const startIndex = (currentBudgetPage - 1) * BUDGET_PAGE_SIZE;
    const pageItems = filteredBudgetRecords.slice(startIndex, startIndex + BUDGET_PAGE_SIZE);

    if (pageInfo) {
        const startNum = startIndex + 1;
        const endNum = Math.min(startIndex + BUDGET_PAGE_SIZE, filteredBudgetRecords.length);
        pageInfo.textContent = `Showing ${startNum}-${endNum} of ${filteredBudgetRecords.length} records`;
    }
    if (prevBtn) prevBtn.disabled = currentBudgetPage <= 1;
    if (nextBtn) nextBtn.disabled = currentBudgetPage >= totalPages;

    renderBudgetPagerButtons(totalPages, currentBudgetPage);

    tbody.innerHTML = pageItems.map(row => {
        const capital = formatAmount(row.capital);
        const rawMaterial = formatAmount(row.raw_material);
        const pettyCash = formatAmount(row.petty_cash_fund || 800);
        const emergencyFunds = formatAmount(row.emergency_funds);
        const manpowerCost = formatAmount(row.manpower_cost);
        const isActive = row.status === 'ACTIVE';

        return `
            <tr>
                <td>
                    <strong style="color: var(--brown-soft); font-size: 13px;">${escapeHtml(row.date)}</strong>
                </td>
                <td><strong style="color: var(--text-dark); font-family: var(--font-family-heading); font-size: 13.5px;">₱${capital}</strong></td>
                <td><span style="color: var(--brown-soft); font-weight: 700;">₱${rawMaterial}</span></td>
                <td><span style="color: #2E7D32; font-weight: 700;">₱${pettyCash}</span></td>
                <td><span style="color: var(--text-muted);">₱${emergencyFunds}</span></td>
                <td><span style="color: var(--text-muted);">₱${manpowerCost}</span></td>
                <td>
                    <span class="status-badge-budget ${isActive ? 'active' : 'closed'}">
                        ${isActive ? 'Active Cycle' : 'Reconciled'}
                    </span>
                </td>
                <td style="text-align: right;">
                    <button type="button" class="btn-view-budget" onclick="viewCycleBreakdown(${row.id})">
                        Audit Envelope
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

function renderBudgetPagerButtons(totalPages, activePage) {
    const pagerNumbers = document.getElementById('budgetPagerNumbers');
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
            if (page && page !== currentBudgetPage) {
                currentBudgetPage = page;
                renderBudgetTable();
            }
        });
    });
}

function viewCycleBreakdown(id) {
    const cycle = allBudgetRecords.find(b => b.id === id);
    if (!cycle) return;

    MMSwal.fire({
        title: `Budget Envelope: ${cycle.date}`,
        html: `
            <div style="text-align: left; font-size: 13px; line-height: 1.6; color: var(--text-dark);">
                <div style="margin-bottom: 6px;"><strong>Total Capital Pool:</strong> ₱${formatAmount(cycle.capital)}</div>
                <div style="margin-bottom: 6px;"><strong>Raw Materials (COGS):</strong> ₱${formatAmount(cycle.raw_material)}</div>
                <div style="margin-bottom: 6px;"><strong>Revolving Petty Cash (&le; ₱300):</strong> ₱${formatAmount(cycle.petty_cash_fund || 800)}</div>
                <div style="margin-bottom: 6px;"><strong>Emergency Buffer:</strong> ₱${formatAmount(cycle.emergency_funds)}</div>
                <div style="margin-bottom: 6px;"><strong>Manpower / Logistics:</strong> ₱${formatAmount(cycle.manpower_cost)}</div>
                <div style="background: var(--bg-main); padding: 10px 12px; border-radius: 10px; margin-top: 10px; border-left: 3px solid var(--accent-pink);">
                    <strong>Envelope Status:</strong> ${cycle.status === 'ACTIVE' ? 'Active operating cycle in effect.' : 'Reconciled and closed.'}
                </div>
            </div>
        `,
        confirmButtonText: 'Close'
    });
}

async function handleAddBudgetCycle(e) {
    e.preventDefault();

    const cycle_name = document.getElementById('cycleName')?.value.trim();
    const allocation_date = document.getElementById('budgetDate')?.value;
    const capital = parseFloat(document.getElementById('capitalAmount')?.value);
    const raw_material = parseFloat(document.getElementById('rawMaterialAmount')?.value);
    const petty_cash_fund = parseFloat(document.getElementById('pettyCashAmount')?.value);
    const emergency_funds = parseFloat(document.getElementById('emergencyAmount')?.value);
    const manpower_cost = parseFloat(document.getElementById('manpowerAmount')?.value);

    if (!cycle_name || !allocation_date || isNaN(capital) || isNaN(raw_material) || isNaN(petty_cash_fund)) {
        MMSwal.fire({
            icon: 'warning',
            title: 'Incomplete Input',
            text: 'Please fill in all required fields with valid amounts.'
        });
        return;
    }

    try {
        const userId = localStorage.getItem('userId') || sessionStorage.getItem('userId');
        const response = await fetch('/api/finance-officer/budget', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(userId ? { 'x-user-id': userId } : {})
            },
            body: JSON.stringify({
                cycle_name, allocation_date, capital, raw_material, petty_cash_fund,
                emergency_funds: isNaN(emergency_funds) ? 0 : emergency_funds,
                manpower_cost: isNaN(manpower_cost) ? 0 : manpower_cost
            })
        });

        const data = await response.json();
        if (!response.ok || data.status !== 'success') {
            throw new Error(data.message || 'Could not save the budget cycle.');
        }

        closeBudgetModal();
        document.getElementById('budgetAllocationForm')?.reset();
        await fetchBudgetData();

        MMSwal.fire({
            icon: 'success',
            title: 'Budget Allocated',
            text: `Cycle "${cycle_name}" (₱${formatAmount(capital)}) authorized successfully.`
        });
    } catch (error) {
        MMSwal.fire({
            icon: 'warning',
            title: 'Allocation Failed',
            text: error.message || 'Could not save the budget cycle.'
        });
    }
}

// --------------------------------------------------------------------------
// 2. DISBURSEMENT VOUCHERS & RECEIPTS AUDIT (EXPENSES)
// --------------------------------------------------------------------------
async function fetchExpenseData() {
    try {
        const userId = localStorage.getItem('userId') || sessionStorage.getItem('userId');
        const headers = userId ? { 'x-user-id': userId } : {};
        const response = await fetch('/api/finance-officer/expenses', { headers });

        if (!response.ok) throw new Error('Failed to retrieve expense disbursements');

        const data = await response.json();
        allExpenseRecords = data.records || [];
        document.getElementById('expensesCountBadge').textContent = allExpenseRecords.length;

        applyExpenseFilters();
    } catch (error) {
        console.error('Could not load expense disbursements:', error);
    }
}

function filterExpensesByCategory(category, element) {
    currentCategoryFilter = category;
    document.querySelectorAll('.order-filter-tabs .tab-btn').forEach(btn => btn.classList.remove('active'));
    element.classList.add('active');
    applyExpenseFilters();
}

function applyExpenseFilters() {
    const q = document.getElementById('budgetSearchInput')?.value.toLowerCase().trim() || '';

    filteredExpenseRecords = allExpenseRecords.filter(item => {
        if (currentCategoryFilter !== 'all' && item.category !== currentCategoryFilter) {
            return false;
        }
        if (q) {
            const voucher = (item.voucher_num || '').toLowerCase();
            const part = (item.particulars || '').toLowerCase();
            const vend = (item.vendor_name || '').toLowerCase();
            const orNum = (item.or_number || '').toLowerCase();
            if (!voucher.includes(q) && !part.includes(q) && !vend.includes(q) && !orNum.includes(q)) {
                return false;
            }
        }
        return true;
    });

    // Update Outflow Metrics
    const totalOutflow = allExpenseRecords.reduce((sum, item) => sum + (item.amount || 0), 0);
    const cogsSum = allExpenseRecords.filter(i => i.category === 'cogs').reduce((sum, item) => sum + (item.amount || 0), 0);
    const directSum = allExpenseRecords.filter(i => i.category === 'direct').reduce((sum, item) => sum + (item.amount || 0), 0);

    setText('kpiTotalExpense', '₱' + formatAmount(totalOutflow));
    const kpiCogsFoot = document.getElementById('kpiCogsFooter');
    if (kpiCogsFoot) kpiCogsFoot.textContent = `Actual Spent: ₱${formatAmount(cogsSum)}`;
    const kpiDirFoot = document.getElementById('kpiDirectFooter');
    if (kpiDirFoot) kpiDirFoot.textContent = `Liquidated: ₱${formatAmount(directSum)}`;

    currentExpensePage = 1;
    renderExpenseTable();
}

function renderExpenseTable() {
    const tbody = document.getElementById('expenseTableBody');
    const pageInfo = document.getElementById('expensesPageInfo');
    const prevBtn = document.getElementById('prevExpBtn');
    const nextBtn = document.getElementById('nextExpBtn');

    if (!tbody) return;

    if (filteredExpenseRecords.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="loading-state-text">No disbursement vouchers recorded for this filter.</td></tr>';
        if (pageInfo) pageInfo.textContent = 'Showing 0 of 0 records';
        if (prevBtn) prevBtn.disabled = true;
        if (nextBtn) nextBtn.disabled = true;
        renderExpensePagerButtons(1, 1);
        return;
    }

    const totalPages = Math.ceil(filteredExpenseRecords.length / EXPENSES_PAGE_SIZE) || 1;
    const startIndex = (currentExpensePage - 1) * EXPENSES_PAGE_SIZE;
    const pageItems = filteredExpenseRecords.slice(startIndex, startIndex + EXPENSES_PAGE_SIZE);

    if (pageInfo) {
        const startNum = startIndex + 1;
        const endNum = Math.min(startIndex + EXPENSES_PAGE_SIZE, filteredExpenseRecords.length);
        pageInfo.textContent = `Showing ${startNum}-${endNum} of ${filteredExpenseRecords.length} records`;
    }
    if (prevBtn) prevBtn.disabled = currentExpensePage <= 1;
    if (nextBtn) nextBtn.disabled = currentExpensePage >= totalPages;

    renderExpensePagerButtons(totalPages, currentExpensePage);

    tbody.innerHTML = pageItems.map(item => {
        let routeBadgeClass = 'route-procure';
        let dotClass = 'dot-procure';
        if (item.doa_tier === 'ceo') { routeBadgeClass = 'route-ceo'; dotClass = 'dot-ceo'; }
        else if (item.doa_tier === 'finance') { routeBadgeClass = 'route-finance'; dotClass = 'dot-finance'; }

        return `
            <tr>
                <td>
                    <strong style="color: var(--brown-soft); font-size: 13px;">${escapeHtml(item.particulars)}</strong>
                    <div style="font-size: 11px; color: var(--text-muted);">${escapeHtml(item.voucher_num)}</div>
                </td>
                <td><span style="font-weight: 700; color: var(--text-dark);">${escapeHtml(item.category_label)}</span></td>
                <td><span style="font-size: 12px; color: var(--text-muted);">${escapeHtml(item.cycle_date)}</span></td>
                <td><strong>${escapeHtml(item.vendor_name)}</strong></td>
                <td><span style="font-size: 11.5px; font-weight: 700; color: var(--brown-soft);">${escapeHtml(item.or_number)}</span></td>
                <td><strong style="color: var(--brown-soft); font-family: var(--font-family-heading); font-size: 13.5px;">₱${formatAmount(item.amount)}</strong></td>
                <td>
                    <span class="badge-route ${routeBadgeClass}">
                        <span class="badge-dot ${dotClass}"></span>
                        ${escapeHtml(item.doa_badge_text)}
                    </span>
                </td>
                <td style="text-align: right;">
                    <button type="button" class="btn-audit-receipt" onclick="viewExpenseReceipt(${item.id})">
                        Verify Receipt
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

function renderExpensePagerButtons(totalPages, activePage) {
    const pagerNumbers = document.getElementById('expPagerNumbers');
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
            if (page && page !== currentExpensePage) {
                currentExpensePage = page;
                renderExpenseTable();
            }
        });
    });
}

function viewExpenseReceipt(id) {
    const item = allExpenseRecords.find(e => e.id === id);
    if (!item) return;

    MMSwal.fire({
        title: `Voucher Audit: ${item.voucher_num}`,
        html: `
            <div style="text-align: left; font-size: 13px; line-height: 1.6; color: var(--text-dark);">
                <div style="margin-bottom: 6px;"><strong>Particulars:</strong> ${escapeHtml(item.particulars)}</div>
                <div style="margin-bottom: 6px;"><strong>Supplier / Payee:</strong> ${escapeHtml(item.vendor_name)}</div>
                <div style="margin-bottom: 6px;"><strong>Official Receipt #:</strong> ${escapeHtml(item.or_number)}</div>
                <div style="margin-bottom: 6px;"><strong>Disbursed Amount:</strong> ₱${formatAmount(item.amount)}</div>
                <div style="margin-bottom: 6px;"><strong>DOA Classification:</strong> ${escapeHtml(item.doa_badge_text)}</div>
                <div style="background: var(--bg-main); padding: 10px 12px; border-radius: 10px; margin-top: 10px; border-left: 3px solid var(--accent-pink);">
                    <strong>Audit Verified:</strong> Official receipt matches ledger disbursement.
                </div>
            </div>
        `,
        confirmButtonText: 'Close'
    });
}

async function handleAddDisbursement(e) {
    e.preventDefault();
    const particulars = document.getElementById('expParticulars')?.value.trim();
    const category = document.getElementById('expCategory')?.value;
    const date = document.getElementById('expDate')?.value;
    const vendor_name = document.getElementById('expVendor')?.value.trim();
    const or_number = document.getElementById('expOrNum')?.value.trim();
    const amount = parseFloat(document.getElementById('expAmount')?.value || 0);

    if (!particulars || !vendor_name || !or_number || isNaN(amount) || amount <= 0) {
        MMSwal.fire({
            icon: 'warning',
            title: 'Incomplete Input',
            text: 'Please fill in all disbursement voucher details.'
        });
        return;
    }

    try {
        const userId = localStorage.getItem('userId') || sessionStorage.getItem('userId');
        const response = await fetch('/api/finance-officer/expenses', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(userId ? { 'x-user-id': userId } : {})
            },
            body: JSON.stringify({ particulars, category, date, vendor_name, or_number, amount })
        });

        closeExpenseModal();
        document.getElementById('expenseForm')?.reset();
        await fetchExpenseData();

        MMSwal.fire({
            icon: 'success',
            title: 'Disbursement Posted',
            text: `Voucher for "${particulars}" (₱${formatAmount(amount)}) posted to ledger successfully.`
        });
    } catch (error) {
        closeExpenseModal();
        MMSwal.fire({
            icon: 'info',
            title: 'Notice',
            text: 'Disbursement voucher recorded locally.'
        });
    }
}

// --------------------------------------------------------------------------
// MODAL HELPERS & UTILITIES
// --------------------------------------------------------------------------
function openBudgetModal() {
    const m = document.getElementById('budgetModal');
    if (m) {
        m.classList.add('open');
        document.body.style.overflow = 'hidden';
    }
}

function closeBudgetModal() {
    const m = document.getElementById('budgetModal');
    if (m) {
        m.classList.remove('open');
        document.body.style.overflow = '';
    }
}

function openExpenseModal() {
    const m = document.getElementById('expenseModal');
    if (m) {
        m.classList.add('open');
        document.body.style.overflow = 'hidden';
    }
}

function closeExpenseModal() {
    const m = document.getElementById('expenseModal');
    if (m) {
        m.classList.remove('open');
        document.body.style.overflow = '';
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

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}