let currentFinanceTab = 'preapproval'; // 'preapproval' (₱301-₱500) o 'liquidation' (≤ ₱300)
let allPreApprovals = [];
let allLiquidations = [];
let filteredQueue = [];
let currentFinPage = 1;
const FIN_PAGE_SIZE = 4;

let releaseDayChartInstance = null;
let cogsChartInstance = null;

// Global SweetAlert2 Configuration matching Master SOP Section 2.E
const MMSwal = Swal.mixin({
    customClass: {
        popup: 'mm-swal-popup',
        title: 'mm-swal-title',
        confirmButton: 'mm-swal-confirm',
        cancelButton: 'mm-swal-cancel',
        denyButton: 'mm-swal-deny'
    },
    buttonsStyling: false
});

document.addEventListener('DOMContentLoaded', () => {
    if (typeof Chart !== 'undefined') {
        Chart.defaults.font.family = "'Urbanist', sans-serif";
    }
    fetchFinanceDashboardData();

    // Search filter listener
    document.getElementById('financeSearchInput')?.addEventListener('input', applyFinanceFilters);

    // Form submission
    document.getElementById('disbursementForm')?.addEventListener('submit', handleDisbursementSubmit);

    // Pagination buttons
    document.getElementById('prevFinBtn')?.addEventListener('click', () => {
        if (currentFinPage > 1) {
            currentFinPage--;
            renderFinanceTable();
        }
    });

    document.getElementById('nextFinBtn')?.addEventListener('click', () => {
        const totalPages = Math.ceil(filteredQueue.length / FIN_PAGE_SIZE) || 1;
        if (currentFinPage < totalPages) {
            currentFinPage++;
            renderFinanceTable();
        }
    });
});

function getAuthHeaders() {
    const userId = localStorage.getItem('userId') || sessionStorage.getItem('userId');
    const headers = { 'Content-Type': 'application/json' };
    if (userId) {
        headers['x-user-id'] = userId;
    }
    return headers;
}

async function fetchFinanceDashboardData() {
    try {
        let response;
        if (typeof employeeFetch === 'function') {
            response = await employeeFetch('/api/finance-officer/dashboard');
        } else {
            response = await fetch('/api/finance-officer/dashboard', { headers: getAuthHeaders() });
        }

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.message || 'Server error ' + response.status);
        }

        const data = await response.json();

        // Populate User Info
        const userNameEl = document.getElementById('userName');
        const userFirstNameEl = document.getElementById('userFirstName');
        const userAvatarEl = document.getElementById('userAvatar');

        if (userNameEl) userNameEl.textContent = data.user?.fullName || 'Financial Officer';
        if (userFirstNameEl) userFirstNameEl.textContent = data.user?.firstName || 'Finance Officer';
        if (userAvatarEl && data.user?.avatarSrc) userAvatarEl.src = data.user.avatarSrc;

        // Metrics
        if (data.metrics) {
            document.getElementById('totalRevenue').textContent = '₱' + formatAmount(data.metrics.totalRevenue);
            const netMargin = (data.metrics.totalRevenue > 0)
                ? (((data.metrics.totalRevenue - data.metrics.totalExpenses) / data.metrics.totalRevenue) * 100).toFixed(1)
                : null;
            document.getElementById('netMarginVal').textContent = netMargin !== null ? netMargin + '%' : '—';
        }

        allPreApprovals = data.preApprovals || [];
        allLiquidations = data.liquidations || [];

        applyFinanceFilters();
        initReleaseDayChart(data.releaseCashFlow || { revenue: [data.metrics?.totalRevenue || 0, 0], outflow: [data.metrics?.totalExpenses || 0, 0] });
        initCogsDonutChart(data.cogsBreakdown || [42, 33, 25]);

    } catch (error) {
        console.error('Could not load finance dashboard data:', error);
        MMSwal.fire({
            icon: 'warning',
            title: 'System Notice',
            text: error.message || 'Could not load financial records from server.'
        });
    }
}

// Tab Switcher between ₱301-₱500 and ≤ ₱300
function switchFinanceTab(tab) {
    currentFinanceTab = tab;
    const tabPreApp = document.getElementById('tabPreApproval');
    const tabLiq = document.getElementById('tabLiquidation');

    if (tab === 'preapproval') {
        tabPreApp?.classList.add('active');
        tabLiq?.classList.remove('active');
    } else {
        tabLiq?.classList.add('active');
        tabPreApp?.classList.remove('active');
    }

    applyFinanceFilters();
}

function applyFinanceFilters() {
    const q = document.getElementById('financeSearchInput')?.value.toLowerCase().trim() || '';
    const rawList = (currentFinanceTab === 'preapproval') ? allPreApprovals : allLiquidations;

    filteredQueue = rawList.filter(item => {
        if (q) {
            const name = (item.item_name || '').toLowerCase();
            const code = (item.pr_code || '').toLowerCase();
            const dept = (item.department || '').toLowerCase();
            const orNum = (item.or_number || '').toLowerCase();
            if (!name.includes(q) && !code.includes(q) && !dept.includes(q) && !orNum.includes(q)) return false;
        }
        return true;
    });

    // Update Counter Badges
    document.getElementById('pendingApprovalCount').textContent = String(allPreApprovals.length).padStart(2, '0');
    document.getElementById('pendingLiquidationCount').textContent = String(allLiquidations.length).padStart(2, '0');
    document.getElementById('badgePreApp').textContent = allPreApprovals.length;
    document.getElementById('badgeLiq').textContent = allLiquidations.length;

    currentFinPage = 1;
    renderFinanceTable();
}

function renderFinanceTable() {
    const tbody = document.getElementById('financeTableBody');
    const pageInfo = document.getElementById('financePageInfo');
    const prevBtn = document.getElementById('prevFinBtn');
    const nextBtn = document.getElementById('nextFinBtn');
    const headerRow = document.getElementById('tableHeaderRow');

    if (!tbody) return;

    if (headerRow) {
        if (currentFinanceTab === 'preapproval') {
            headerRow.innerHTML = `
                <th>PR Code &amp; Item</th>
                <th>Requesting Dept</th>
                <th>Estimated Cost</th>
                <th>DOA Status</th>
                <th style="text-align: right;">Authorization</th>
            `;
        } else {
            headerRow.innerHTML = `
                <th>PR Code &amp; Direct Buy Item</th>
                <th>Official Receipt (OR)</th>
                <th>Liquidated Amount</th>
                <th>Audit Status</th>
                <th style="text-align: right;">Action</th>
            `;
        }
    }

    if (filteredQueue.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="loading-state-text">No items pending in ${currentFinanceTab === 'preapproval' ? '₱301–₱500 Pre-Approval' : '≤ ₱300 Liquidation Audit'}.</td></tr>`;
        if (pageInfo) pageInfo.textContent = 'Showing 0 of 0 items';
        if (prevBtn) prevBtn.disabled = true;
        if (nextBtn) nextBtn.disabled = true;
        renderFinPagerButtons(1, 1);
        return;
    }

    const totalPages = Math.ceil(filteredQueue.length / FIN_PAGE_SIZE) || 1;
    const startIndex = (currentFinPage - 1) * FIN_PAGE_SIZE;
    const pageItems = filteredQueue.slice(startIndex, startIndex + FIN_PAGE_SIZE);

    if (pageInfo) {
        const startNum = startIndex + 1;
        const endNum = Math.min(startIndex + FIN_PAGE_SIZE, filteredQueue.length);
        pageInfo.textContent = `Showing ${startNum}-${endNum} of ${filteredQueue.length} records`;
    }
    if (prevBtn) prevBtn.disabled = currentFinPage <= 1;
    if (nextBtn) nextBtn.disabled = currentFinPage >= totalPages;

    renderFinPagerButtons(totalPages, currentFinPage);

    tbody.innerHTML = pageItems.map(item => {
        const costStr = '₱' + formatAmount(item.total_cost);

        if (currentFinanceTab === 'preapproval') {
            return `
                <tr>
                    <td>
                        <strong style="color: var(--brown-soft); font-size: 13px;">${escapeHtml(item.item_name)}</strong>
                        <div style="font-size: 11px; color: var(--text-muted);">${escapeHtml(item.pr_code)} • ${escapeHtml(item.vendor || 'Supplier')}</div>
                    </td>
                    <td><span style="font-weight: 700; color: var(--text-dark);">${escapeHtml(item.department || 'Procurement')}</span></td>
                    <td><strong style="color: var(--brown-soft); font-family: var(--font-family-heading); font-size: 13.5px;">${costStr}</strong></td>
                    <td><span class="badge-route route-finance"><span class="badge-dot dot-finance"></span> Endorsed to Finance</span></td>
                    <td style="text-align: right;">
                        <button type="button" class="btn-approve-finance" onclick="reviewAndEndorseModal(${item.id})">
                            Review &amp; Approve
                        </button>
                    </td>
                </tr>
            `;
        } else {
            return `
                <tr>
                    <td>
                        <strong style="color: var(--brown-soft); font-size: 13px;">${escapeHtml(item.item_name)}</strong>
                        <div style="font-size: 11px; color: var(--text-muted);">${escapeHtml(item.pr_code)} • Direct Buy (Procurement)</div>
                    </td>
                    <td>
                        <span style="font-size: 11.5px; font-weight: 700; color: var(--brown-soft);">${escapeHtml(item.or_number || 'OR Attached')}</span>
                    </td>
                    <td><strong style="color: var(--brown-soft); font-family: var(--font-family-heading); font-size: 13.5px;">${costStr}</strong></td>
                    <td><span class="badge-route route-procure"><span class="badge-dot dot-procure"></span> Direct Buy Liquidation</span></td>
                    <td style="text-align: right;">
                        <button type="button" class="btn-liquidate-direct" onclick="verifyAndLiquidate(${item.id}, '${escapeHtml(item.item_name)}', ${item.total_cost})">
                            Verify &amp; Liquidate
                        </button>
                    </td>
                </tr>
            `;
        }
    }).join('');
}

// Numbered Pager
function renderFinPagerButtons(totalPages, activePage) {
    const pagerNumbers = document.getElementById('finPagerNumbers');
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
            if (page && page !== currentFinPage) {
                currentFinPage = page;
                renderFinanceTable();
            }
        });
    });
}

// Quick Action Review Modal para sa ₱301–₱500 Requisitions
async function reviewAndEndorseModal(itemId) {
    const item = allPreApprovals.find(i => i.id === itemId);
    if (!item) return;

    const res = await MMSwal.fire({
        title: `Requisition Clearance: ${item.pr_code || 'PR-Item'}`,
        html: `
            <div style="text-align: left; font-size: 13px; line-height: 1.6; color: var(--text-dark);">
                <div style="margin-bottom: 6px;"><strong>Item / Supplies:</strong> ${escapeHtml(item.item_name)}</div>
                <div style="margin-bottom: 6px;"><strong>Requesting Department:</strong> ${escapeHtml(item.department || 'Procurement')}</div>
                <div style="margin-bottom: 6px;"><strong>Estimated Requisition Amount:</strong> ₱${formatAmount(item.total_cost)}</div>
                <div style="margin-bottom: 6px;"><strong>DOA Threshold:</strong> <span class="badge-route route-finance"><span class="badge-dot dot-finance"></span> ₱301–₱500 Middle-Tier Clearance</span></div>
                
                <div style="background: var(--bg-main); padding: 10px 12px; border-radius: 10px; margin: 10px 0; border-left: 3.5px solid var(--accent-pink);">
                    <strong>Operating Note:</strong> Approving authorizes the requisition in Supabase. Procurement will receive the clearance and execute the actual purchase.
                </div>
            </div>
        `,
        icon: 'question',
        showCancelButton: true,
        showDenyButton: true,
        confirmButtonText: 'Approve for Procurement',
        denyButtonText: 'Reject Request',
        cancelButtonText: 'Cancel'
    });

    if (res.isConfirmed) {
        try {
            const patchRes = await fetch(`/api/finance-officer/expenses/${itemId}/approve`, {
                method: 'PATCH',
                headers: getAuthHeaders(),
                body: JSON.stringify({ approver_id: localStorage.getItem('userId') || null })
            });

            if (!patchRes.ok) {
                const err = await patchRes.json().catch(() => ({}));
                throw new Error(err.message || 'Failed to update approval in Supabase');
            }

            allPreApprovals = allPreApprovals.filter(i => i.id !== itemId);
            applyFinanceFilters();

            MMSwal.fire({
                icon: 'success',
                title: 'Requisition Approved',
                text: `Purchase for "${item.item_name}" has been approved. Procurement Officer is authorized to buy.`
            });
        } catch (error) {
            console.error('Approval failed:', error);
            MMSwal.fire({
                icon: 'error',
                title: 'Failed to Approve',
                text: error.message || 'Database error occurred while approving.'
            });
        }
    } else if (res.isDenied) {
        const { value: reason } = await MMSwal.fire({
            title: 'Reject Requisition',
            input: 'textarea',
            inputLabel: 'Reason for Rejection',
            inputPlaceholder: 'State reason for rejecting this disbursement...',
            showCancelButton: true,
            confirmButtonText: 'Confirm Rejection',
            inputValidator: (val) => {
                if (!val || val.trim().length === 0) return 'Please state a reason for rejection.';
            }
        });

        if (reason) {
            try {
                const rejectRes = await fetch(`/api/finance-officer/expenses/${itemId}/reject`, {
                    method: 'PATCH',
                    headers: getAuthHeaders(),
                    body: JSON.stringify({ reason })
                });

                if (!rejectRes.ok) {
                    const err = await rejectRes.json().catch(() => ({}));
                    throw new Error(err.message || 'Failed to record rejection');
                }

                allPreApprovals = allPreApprovals.filter(i => i.id !== itemId);
                applyFinanceFilters();

                MMSwal.fire({
                    icon: 'info',
                    title: 'Requisition Rejected',
                    text: `Request for "${item.item_name}" was rejected. Rationale logged to database.`
                });
            } catch (error) {
                console.error('Rejection failed:', error);
                MMSwal.fire({
                    icon: 'error',
                    title: 'Action Failed',
                    text: error.message || 'Could not update record.'
                });
            }
        }
    }
}

// Action: Verify Receipt & Liquidate (≤ ₱300)
async function verifyAndLiquidate(id, itemName, cost) {
    const res = await MMSwal.fire({
        title: 'Verify & Replenish Petty Cash?',
        html: `Confirm that Official Receipt / Voucher for <strong>"${escapeHtml(itemName)}"</strong> (₱${cost.toFixed(2)}) has been inspected?<br><br><small style="color:var(--text-muted);">Amount will be settled against the petty cash fund.</small>`,
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: 'Liquidate & Replenish',
        cancelButtonText: 'Cancel'
    });

    if (!res.isConfirmed) return;

    try {
        const response = await fetch(`/api/finance-officer/expenses/${id}/liquidate`, {
            method: 'PATCH',
            headers: getAuthHeaders()
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.message || 'Failed to update liquidation');
        }

        allLiquidations = allLiquidations.filter(i => i.id !== id);
        applyFinanceFilters();

        MMSwal.fire({
            icon: 'success',
            title: 'Disbursement Liquidated',
            text: `₱${cost.toFixed(2)} recorded in petty cash replenishment audit.`
        });
    } catch (error) {
        console.error('Liquidation failed:', error);
        MMSwal.fire({
            icon: 'error',
            title: 'Liquidation Error',
            text: error.message || 'Failed to liquidate expense.'
        });
    }
}

// Chart 1: Release Day Cash Flow
function initReleaseDayChart(customData) {
    const ctx = document.getElementById('releaseDayBarChart')?.getContext('2d');
    if (!ctx) return;

    if (releaseDayChartInstance) releaseDayChartInstance.destroy();

    const labels = ['Tue (10 AM - 3 PM)', 'Thu (10 AM - 3 PM)'];
    const revenueData = (customData && customData.revenue) || [0, 0];
    const outflowData = (customData && customData.outflow) || [0, 0];

    releaseDayChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                {
                    label: 'Gross Sales (Inflow)',
                    data: revenueData,
                    backgroundColor: '#f28b95',
                    borderRadius: 6,
                    barThickness: 24
                },
                {
                    label: 'Procurement COGS (Outflow)',
                    data: outflowData,
                    backgroundColor: '#7C4F38',
                    borderRadius: 6,
                    barThickness: 24
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11, weight: 700 } } }
            },
            scales: {
                y: { beginAtZero: true, grid: { color: 'rgba(246, 146, 153, 0.15)' }, ticks: { font: { size: 10 } } },
                x: { grid: { display: false }, ticks: { font: { size: 11, weight: 700 } } }
            }
        }
    });
}

// Chart 2: COGS Donut
function initCogsDonutChart(customData) {
    const ctx = document.getElementById('cogsDonutChart')?.getContext('2d');
    const canvas = document.getElementById('cogsDonutChart');
    if (!ctx) return;

    if (cogsChartInstance) cogsChartInstance.destroy();

    if (!customData || !Array.isArray(customData) || customData.length === 0) {
        if (canvas) {
            const wrapper = canvas.parentElement;
            if (wrapper && !wrapper.querySelector('.cogs-empty-note')) {
                const note = document.createElement('div');
                note.className = 'cogs-empty-note';
                note.style.cssText = 'text-align:center; font-size:12px; color: var(--text-muted); padding: 20px 10px;';
                note.textContent = 'No ingredient cost-breakdown data available yet.';
                wrapper.appendChild(note);
            }
        }
        return;
    }

    cogsChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Tea & Boba', 'Milk Blend', 'Cups & Film'],
            datasets: [{
                data: customData,
                backgroundColor: ['#f28b95', '#68B0AB', '#EAA342'],
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

// Modal Handlers
function openDisbursementModal() {
    const m = document.getElementById('disbursementModal');
    if (m) {
        m.classList.add('open');
        document.body.style.overflow = 'hidden';
    }
}

function closeDisbursementModal() {
    const m = document.getElementById('disbursementModal');
    if (m) {
        m.classList.remove('open');
        document.body.style.overflow = '';
    }
}

async function handleDisbursementSubmit(e) {
    e.preventDefault();
    const desc = document.getElementById('disburseDesc').value.trim();
    const cat = document.getElementById('disburseCategory').value;
    const amount = parseFloat(document.getElementById('disburseAmount').value || 0);
    const orNum = document.getElementById('disburseOrNum').value.trim();

    try {
        const response = await fetch('/api/finance-officer/expenses/voucher', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({
                description: desc,
                category: cat,
                amount: amount,
                or_number: orNum
            })
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.message || 'Failed to submit disbursement voucher.');
        }

        closeDisbursementModal();
        e.target.reset();

        MMSwal.fire({
            icon: 'success',
            title: 'Disbursement Voucher Posted',
            text: `Disbursement Voucher for "${desc}" (₱${amount.toFixed(2)}) successfully saved to database.`
        });

        // I-reload ang updated metrics at records
        fetchFinanceDashboardData();
    } catch (error) {
        console.error('Voucher submission error:', error);
        MMSwal.fire({
            icon: 'error',
            title: 'Error Posting Voucher',
            text: error.message || 'Could not save voucher to Supabase.'
        });
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