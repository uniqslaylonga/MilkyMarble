let allExpenseRecords = [];
let filteredExpenseRecords = [];
let currentCategoryFilter = 'all';
let currentExpensePage = 1;
const EXPENSES_PAGE_SIZE = 5;

document.addEventListener('DOMContentLoaded', () => {
    fetchExpenseRecords();

    // Search filter listener
    document.getElementById('expenseSearchInput')?.addEventListener('input', applyExpenseFilters);

    // Form submission
    document.getElementById('expenseForm')?.addEventListener('submit', handleAddDisbursement);

    // Pagination buttons
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

async function fetchExpenseRecords() {
    try {
        let response;
        if (typeof employeeFetch === 'function') {
            response = await employeeFetch('/api/finance-officer/expenses');
        } else {
            const userId = localStorage.getItem('userId') || sessionStorage.getItem('userId');
            const headers = userId ? { 'x-user-id': userId } : {};
            response = await fetch('/api/finance-officer/expenses', { headers });
        }

        if (!response.ok) throw new Error(await EmployeeUI.errorMessage(response));

        const data = await response.json();

        // User profile setup
        const userNameEl = document.getElementById('userName');
        const userAvatarEl = document.getElementById('userAvatar');

        if (userNameEl) userNameEl.textContent = data.user.fullName || 'Financial Officer';
        if (userAvatarEl && data.user.avatarSrc) userAvatarEl.src = data.user.avatarSrc;

        allExpenseRecords = data.records || [];
        applyExpenseFilters();

    } catch (error) {
        console.error('Could not load live data from the server:', error);
        if (window.EmployeeUI) { EmployeeUI.showError(error); EmployeeUI.failTables(); }
    }
}

// Category filter switch
function filterExpensesByCategory(category, element) {
    currentCategoryFilter = category;
    document.querySelectorAll('.order-filter-tabs .tab-btn').forEach(btn => btn.classList.remove('active'));
    element.classList.add('active');
    applyExpenseFilters();
}

// Search and Category Filter Handler
function applyExpenseFilters() {
    const q = document.getElementById('expenseSearchInput')?.value.toLowerCase().trim() || '';

    filteredExpenseRecords = allExpenseRecords.filter(item => {
        // Tab Category Filter
        if (currentCategoryFilter !== 'all' && item.category !== currentCategoryFilter) {
            return false;
        }

        // Search Filter
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

    // Update KPI Card values
    const totalOutflow = allExpenseRecords.reduce((sum, item) => sum + (item.amount || 0), 0);
    const cogsSum = allExpenseRecords.filter(i => i.category === 'cogs').reduce((sum, item) => sum + (item.amount || 0), 0);
    const directSum = allExpenseRecords.filter(i => i.category === 'direct').reduce((sum, item) => sum + (item.amount || 0), 0);
    const mktgSum = allExpenseRecords.filter(i => i.category === 'marketing' || i.category === 'admin').reduce((sum, item) => sum + (item.amount || 0), 0);

    document.getElementById('kpiTotalExpense').textContent = '₱' + formatAmount(totalOutflow);
    document.getElementById('kpiCogs').textContent = '₱' + formatAmount(cogsSum);
    document.getElementById('kpiDirectBuys').textContent = '₱' + formatAmount(directSum);
    document.getElementById('kpiMarketing').textContent = '₱' + formatAmount(mktgSum);

    currentExpensePage = 1;
    renderExpenseTable();
}

// Render Expenses Table with Permanent Numbered Pager
function renderExpenseTable() {
    const tbody = document.getElementById('expenseTableBody');
    const pageInfo = document.getElementById('expensesPageInfo');
    const prevBtn = document.getElementById('prevExpBtn');
    const nextBtn = document.getElementById('nextExpBtn');

    if (!tbody) return;

    if (filteredExpenseRecords.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="loading-state-text">No expense or disbursement records match this criteria.</td></tr>';
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
        if (item.doa_tier === 'ceo') routeBadgeClass = 'route-ceo';
        else if (item.doa_tier === 'finance') routeBadgeClass = 'route-finance';

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
                <td><span class="badge-route ${routeBadgeClass}">${escapeHtml(item.doa_badge_text)}</span></td>
                <td style="text-align: right;">
                    <button type="button" class="btn-audit-receipt" onclick="viewExpenseReceipt(${item.id})">
                        Verify Receipt
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

// Numbered Pager Buttons: 1, 2, 3...
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

    alert(`Disbursement Voucher Audit:\n• Voucher: ${item.voucher_num}\n• Particulars: ${item.particulars}\n• Payee: ${item.vendor_name}\n• OR / Invoice: ${item.or_number}\n• Amount Disbursed: ₱${formatAmount(item.amount)}\n• DOA Classification: ${item.doa_badge_text}`);
}

function handleAddDisbursement(e) {
    e.preventDefault();

    // NOTE: There is no finance-officer endpoint to persist a disbursement
    // record - it would previously vanish on refresh while claiming to be
    // "recorded to official ledger." Rather than fake a save, we say so
    // honestly until a real POST endpoint exists for this.
    alert('Disbursement logging isn\'t connected to the database yet, so nothing was saved. This needs a real backend endpoint before it can record anything.');
    closeExpenseModal();
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

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}