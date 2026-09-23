// State Arrays
let allInventoryRequests = [];
let allPromoRequests = [];
let allHistoryRecords = [];

// Filtered Arrays
let filteredInventoryRequests = [];
let filteredPromoRequests = [];
let filteredHistoryRecords = [];

// Active Stream Tab ('inventory' | 'promos' | 'history')
let currentStream = 'inventory';

// Pagination State
const PAGE_SIZE = 5;
let pageInventory = 1;
let pagePromos = 1;
let pageHistory = 1;

// Active Decision Modal Target
let activeDecisionTarget = null; // { type: 'expense'|'promotion', id, action: 'approve'|'reject', record }

document.addEventListener('DOMContentLoaded', () => {
    fetchCeoBudgetApprovals();

    // Search filter listener
    document.getElementById('approvalSearchInput')?.addEventListener('input', applyCurrentStreamFilter);

    // Decision Confirmation Button Listener
    document.getElementById('btnConfirmDecisionAction')?.addEventListener('click', executeDecisionAction);

    // Pagination Click Listeners
    setupPaginationEventListeners();
});

async function fetchCeoBudgetApprovals() {
    try {
        const userId = localStorage.getItem('userId') || sessionStorage.getItem('userId');

        const response = await fetch('/api/ceo/budget-approval', {
            method: 'GET',
            headers: {
                'x-user-id': userId || '',
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) throw new Error('Failed to retrieve budget approvals queue');
        const data = await response.json();

        // 1. Profile Header
        const userFullNameEl = document.getElementById('userFullNameDisplay');
        if (userFullNameEl && data.user && data.user.fullName) {
            userFullNameEl.textContent = data.user.fullName;
        }

        // 2. Overview KPIs
        allInventoryRequests = data.inventoryRequests || [];
        allPromoRequests = data.promotionRequests || [];
        allHistoryRecords = data.decisionHistory || [];

        const pendingInvCount = allInventoryRequests.length;
        const pendingPromoCount = allPromoRequests.length;
        const approvedCount = Number(data.overview?.approved || 0);
        const rejectedCount = Number(data.overview?.rejected || 0);

        document.getElementById('statPendingInventory').textContent = pendingInvCount;
        document.getElementById('statPendingPromos').textContent = pendingPromoCount;
        document.getElementById('statApprovedTotal').textContent = approvedCount;
        document.getElementById('statRejectedTotal').textContent = rejectedCount;

        // Update Tab Badges
        document.getElementById('tabBadgeInventory').textContent = pendingInvCount;
        document.getElementById('tabBadgePromos').textContent = pendingPromoCount;

        applyCurrentStreamFilter();

    } catch (error) {
        console.error('Error loading budget approvals:', error);
        showCustomAlert("Error", "Could not load approvals data from database.", "warning");
    }
}

// --------------------------------------------------------------------------
// TAB SWITCHER LOGIC
// --------------------------------------------------------------------------
function switchApprovalStream(streamName) {
    currentStream = streamName;

    // Toggle button classes
    document.getElementById('tabInventoryBtn')?.classList.toggle('active', streamName === 'inventory');
    document.getElementById('tabPromosBtn')?.classList.toggle('active', streamName === 'promos');
    document.getElementById('tabHistoryBtn')?.classList.toggle('active', streamName === 'history');

    // Toggle panels
    document.getElementById('panelInventory').style.display = streamName === 'inventory' ? '' : 'none';
    document.getElementById('panelPromos').style.display = streamName === 'promos' ? '' : 'none';
    document.getElementById('panelHistory').style.display = streamName === 'history' ? '' : 'none';

    applyCurrentStreamFilter();
}

function applyCurrentStreamFilter() {
    const q = document.getElementById('approvalSearchInput')?.value.toLowerCase().trim() || '';

    if (currentStream === 'inventory') {
        filteredInventoryRequests = allInventoryRequests.filter(item => {
            if (!q) return true;
            return (item.name || '').toLowerCase().includes(q) ||
                   (item.supplier || '').toLowerCase().includes(q) ||
                   (item.pr_code || '').toLowerCase().includes(q) ||
                   (item.requester_name || '').toLowerCase().includes(q);
        });
        pageInventory = 1;
        renderInventoryTable();
    } else if (currentStream === 'promos') {
        filteredPromoRequests = allPromoRequests.filter(item => {
            if (!q) return true;
            return (item.code || '').toLowerCase().includes(q) ||
                   (item.pitch_note || item.title || '').toLowerCase().includes(q) ||
                   (item.target_segment || '').toLowerCase().includes(q);
        });
        pagePromos = 1;
        renderPromosTable();
    } else {
        filteredHistoryRecords = allHistoryRecords.filter(item => {
            if (!q) return true;
            return (item.reference || '').toLowerCase().includes(q) ||
                   (item.type || '').toLowerCase().includes(q) ||
                   (item.requester || '').toLowerCase().includes(q);
        });
        pageHistory = 1;
        renderHistoryTable();
    }
}

// --------------------------------------------------------------------------
// RENDER STREAM 1: INVENTORY & RESTOCK REQUESTS
// --------------------------------------------------------------------------
function renderInventoryTable() {
    const tbody = document.getElementById('inventoryApprovalBody');
    const pageInfo = document.getElementById('inventoryPageInfo');
    const prevBtn = document.getElementById('prevInvBtn');
    const nextBtn = document.getElementById('nextInvBtn');

    if (!tbody) return;

    if (filteredInventoryRequests.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="loading-state-text">No pending inventory restock requests awaiting CEO authorization.</td></tr>';
        if (pageInfo) pageInfo.textContent = 'Showing 0 of 0 requests';
        if (prevBtn) prevBtn.disabled = true;
        if (nextBtn) nextBtn.disabled = true;
        renderPaginationNumbers('invPagerNumbers', 1, 1, 'inventory');
        return;
    }

    const totalPages = Math.ceil(filteredInventoryRequests.length / PAGE_SIZE) || 1;
    const startIndex = (pageInventory - 1) * PAGE_SIZE;
    const pageItems = filteredInventoryRequests.slice(startIndex, startIndex + PAGE_SIZE);

    if (pageInfo) {
        const startNum = startIndex + 1;
        const endNum = Math.min(startIndex + PAGE_SIZE, filteredInventoryRequests.length);
        pageInfo.textContent = `Showing ${startNum}-${endNum} of ${filteredInventoryRequests.length} requests`;
    }
    if (prevBtn) prevBtn.disabled = pageInventory <= 1;
    if (nextBtn) nextBtn.disabled = pageInventory >= totalPages;

    renderPaginationNumbers('invPagerNumbers', totalPages, pageInventory, 'inventory');

    tbody.innerHTML = pageItems.map(item => {
        const prCode = item.pr_code || `PR-${item.id}`;
        const amount = Number(item.amount || item.total_price || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const dateFmt = item.expense_date || (item.created_at ? new Date(item.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'Today');

        return `
            <tr>
                <td><strong style="color: var(--brown-soft); font-size: 13px;">${escapeHtml(prCode)}</strong></td>
                <td>
                    <strong>${escapeHtml(item.item_name || item.name)}</strong>
                    <div style="font-size: 11px; color: var(--text-muted);">${escapeHtml(item.notes || 'Emergency Batch Restock')}</div>
                </td>
                <td><span style="font-size: 12px;">${escapeHtml(item.store_name || item.supplier || 'Vendor Store')}</span></td>
                <td><span style="font-size: 12px; color: var(--text-muted);">${escapeHtml(item.requester_name || 'Procurement')}</span></td>
                <td><strong style="color: var(--brown-soft); font-family: var(--font-family-heading); font-size: 14px;">₱${amount}</strong></td>
                <td><span style="font-size: 11.5px; color: var(--text-muted);">${dateFmt}</span></td>
                <td style="text-align: right;">
                    <div class="btn-action-group">
                        <button type="button" class="btn-approve" onclick="openDecisionModal('expense', ${item.id}, 'approve')">
                            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                            <span>Authorize</span>
                        </button>
                        <button type="button" class="btn-reject" onclick="openDecisionModal('expense', ${item.id}, 'reject')">
                            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                            <span>Reject</span>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

// --------------------------------------------------------------------------
// RENDER STREAM 2: PROMOTIONAL CAMPAIGNS & PITCHES
// --------------------------------------------------------------------------
function renderPromosTable() {
    const tbody = document.getElementById('promosApprovalBody');
    const pageInfo = document.getElementById('promosPageInfo');
    const prevBtn = document.getElementById('prevPromoBtn');
    const nextBtn = document.getElementById('nextPromoBtn');

    if (!tbody) return;

    if (filteredPromoRequests.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="loading-state-text">No proposed promotional campaigns awaiting CEO authorization.</td></tr>';
        if (pageInfo) pageInfo.textContent = 'Showing 0 of 0 pitches';
        if (prevBtn) prevBtn.disabled = true;
        if (nextBtn) nextBtn.disabled = true;
        renderPaginationNumbers('promoPagerNumbers', 1, 1, 'promos');
        return;
    }

    const totalPages = Math.ceil(filteredPromoRequests.length / PAGE_SIZE) || 1;
    const startIndex = (pagePromos - 1) * PAGE_SIZE;
    const pageItems = filteredPromoRequests.slice(startIndex, startIndex + PAGE_SIZE);

    if (pageInfo) {
        const startNum = startIndex + 1;
        const endNum = Math.min(startIndex + PAGE_SIZE, filteredPromoRequests.length);
        pageInfo.textContent = `Showing ${startNum}-${endNum} of ${filteredPromoRequests.length} pitches`;
    }
    if (prevBtn) prevBtn.disabled = pagePromos <= 1;
    if (nextBtn) nextBtn.disabled = pagePromos >= totalPages;

    renderPaginationNumbers('promoPagerNumbers', totalPages, pagePromos, 'promos');

    tbody.innerHTML = pageItems.map(item => {
        const discountText = item.discount_type === 'percent' 
            ? `${item.discount_value}% OFF` 
            : `₱${Number(item.discount_value || 0).toFixed(2)} Flat`;
        const capText = item.usage_cap ? `Cap: ${item.usage_cap} claims` : 'No Limit';
        const minSpendText = item.min_spend ? `Min. ₱${Number(item.min_spend).toFixed(2)}` : 'No Min.';

        return `
            <tr>
                <td><strong style="color: var(--accent-pink); font-size: 13px; letter-spacing: 0.5px;">${escapeHtml(item.code)}</strong></td>
                <td>
                    <strong>${escapeHtml(item.title || 'Campaign Promo')}</strong>
                    <div style="font-size: 11px; color: var(--text-muted);">${escapeHtml(item.pitch_note || 'Pitched by Sales Desk')}</div>
                </td>
                <td><span style="font-size: 12px;">${escapeHtml(item.target_segment || 'All Customers')}</span></td>
                <td><strong style="color: var(--brown-soft);">${discountText}</strong></td>
                <td><span style="font-size: 11.5px; color: var(--text-muted);">${minSpendText} • ${capText}</span></td>
                <td><span style="font-size: 12px; color: var(--text-muted);">${escapeHtml(item.pitched_by || 'Sales Officer')}</span></td>
                <td style="text-align: right;">
                    <div class="btn-action-group">
                        <button type="button" class="btn-approve" onclick="openDecisionModal('promotion', ${item.id}, 'approve')">
                            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                            <span>Sanction</span>
                        </button>
                        <button type="button" class="btn-reject" onclick="openDecisionModal('promotion', ${item.id}, 'reject')">
                            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                            <span>Decline</span>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

// --------------------------------------------------------------------------
// RENDER STREAM 3: DECISION HISTORY
// --------------------------------------------------------------------------
function renderHistoryTable() {
    const tbody = document.getElementById('historyApprovalBody');
    const pageInfo = document.getElementById('historyPageInfo');
    const prevBtn = document.getElementById('prevHistBtn');
    const nextBtn = document.getElementById('nextHistBtn');

    if (!tbody) return;

    if (filteredHistoryRecords.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="loading-state-text">No prior decision records available in audit history.</td></tr>';
        if (pageInfo) pageInfo.textContent = 'Showing 0 of 0 records';
        if (prevBtn) prevBtn.disabled = true;
        if (nextBtn) nextBtn.disabled = true;
        renderPaginationNumbers('histPagerNumbers', 1, 1, 'history');
        return;
    }

    const totalPages = Math.ceil(filteredHistoryRecords.length / PAGE_SIZE) || 1;
    const startIndex = (pageHistory - 1) * PAGE_SIZE;
    const pageItems = filteredHistoryRecords.slice(startIndex, startIndex + PAGE_SIZE);

    if (pageInfo) {
        const startNum = startIndex + 1;
        const endNum = Math.min(startIndex + PAGE_SIZE, filteredHistoryRecords.length);
        pageInfo.textContent = `Showing ${startNum}-${endNum} of ${filteredHistoryRecords.length} records`;
    }
    if (prevBtn) prevBtn.disabled = pageHistory <= 1;
    if (nextBtn) nextBtn.disabled = pageHistory >= totalPages;

    renderPaginationNumbers('histPagerNumbers', totalPages, pageHistory, 'history');

    tbody.innerHTML = pageItems.map(item => {
        const isApproved = item.status === 'APPROVED' || item.status === 'ACTIVE';
        const dateFmt = item.decided_at ? new Date(item.decided_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'Recent';

        return `
            <tr>
                <td><span style="font-size: 12px; font-weight: 700; color: var(--text-muted);">${escapeHtml(item.type_label || 'Expense')}</span></td>
                <td><strong>${escapeHtml(item.reference || item.title)}</strong></td>
                <td><strong style="color: var(--brown-soft);">${escapeHtml(item.value_display || '—')}</strong></td>
                <td><span style="font-size: 12px;">${escapeHtml(item.requester || 'Staff')}</span></td>
                <td><span style="font-size: 11.5px; color: var(--text-muted);">${dateFmt}</span></td>
                <td>
                    <span class="badge-status ${isApproved ? 'approved' : 'rejected'}">${isApproved ? 'APPROVED' : 'REJECTED'}</span>
                </td>
                <td style="text-align: right;">
                    <span style="font-size: 11px; font-weight: 700; color: ${isApproved ? '#2E7D32' : '#C9302C'};">
                        ${isApproved ? '✓ Logged to DB' : '✕ Returned'}
                    </span>
                </td>
            </tr>
        `;
    }).join('');
}

// --------------------------------------------------------------------------
// SMART SLIDING PAGINATION CONTROLS
// --------------------------------------------------------------------------
function renderPaginationNumbers(containerId, totalPages, activePage, streamType) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (totalPages <= 1) {
        container.innerHTML = `<button type="button" class="pager-num-btn active" data-page="1">1</button>`;
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
    container.innerHTML = html;

    container.querySelectorAll('.pager-num-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const p = parseInt(e.currentTarget.getAttribute('data-page'), 10);
            if (streamType === 'inventory' && p !== pageInventory) {
                pageInventory = p;
                renderInventoryTable();
            } else if (streamType === 'promos' && p !== pagePromos) {
                pagePromos = p;
                renderPromosTable();
            } else if (streamType === 'history' && p !== pageHistory) {
                pageHistory = p;
                renderHistoryTable();
            }
        });
    });
}

function setupPaginationEventListeners() {
    document.getElementById('prevInvBtn')?.addEventListener('click', () => {
        if (pageInventory > 1) { pageInventory--; renderInventoryTable(); }
    });
    document.getElementById('nextInvBtn')?.addEventListener('click', () => {
        const total = Math.ceil(filteredInventoryRequests.length / PAGE_SIZE) || 1;
        if (pageInventory < total) { pageInventory++; renderInventoryTable(); }
    });

    document.getElementById('prevPromoBtn')?.addEventListener('click', () => {
        if (pagePromos > 1) { pagePromos--; renderPromosTable(); }
    });
    document.getElementById('nextPromoBtn')?.addEventListener('click', () => {
        const total = Math.ceil(filteredPromoRequests.length / PAGE_SIZE) || 1;
        if (pagePromos < total) { pagePromos++; renderPromosTable(); }
    });

    document.getElementById('prevHistBtn')?.addEventListener('click', () => {
        if (pageHistory > 1) { pageHistory--; renderHistoryTable(); }
    });
    document.getElementById('nextHistBtn')?.addEventListener('click', () => {
        const total = Math.ceil(filteredHistoryRecords.length / PAGE_SIZE) || 1;
        if (pageHistory < total) { pageHistory++; renderHistoryTable(); }
    });
}

// --------------------------------------------------------------------------
// DECISION MODAL & EXECUTION
// --------------------------------------------------------------------------
function openDecisionModal(type, id, action) {
    const modal = document.getElementById('decisionModal');
    if (!modal) return;

    let record = null;
    if (type === 'expense') {
        record = allInventoryRequests.find(r => r.id === id);
    } else {
        record = allPromoRequests.find(r => r.id === id);
    }

    if (!record) return;

    activeDecisionTarget = { type, id, action, record };

    const titleEl = document.getElementById('decisionModalTitle');
    const subEl = document.getElementById('decisionModalSub');
    const iconWrap = document.getElementById('decisionIconWrap');
    const summaryBox = document.getElementById('decisionSummaryBox');
    const remarksWrap = document.getElementById('rejectionReasonWrap');
    const remarksInput = document.getElementById('decisionRemarksInput');
    const confirmBtn = document.getElementById('btnConfirmDecisionAction');

    if (remarksInput) remarksInput.value = '';

    if (action === 'approve') {
        titleEl.textContent = type === 'expense' ? 'Authorize Restock Purchase' : 'Sanction Promo Campaign';
        subEl.textContent = 'This request will be officially authorized and released to operations.';
        iconWrap.className = 'dialog-icon-circle approve';
        confirmBtn.className = 'btn-dialog-primary';
        confirmBtn.textContent = 'Authorize Request';
        remarksWrap.style.display = 'none';
    } else {
        titleEl.textContent = type === 'expense' ? 'Decline Restock Request' : 'Decline Promo Pitch';
        subEl.textContent = 'Specify the justification for turning down this proposal.';
        iconWrap.className = 'dialog-icon-circle reject';
        confirmBtn.className = 'btn-dialog-primary reject-btn';
        confirmBtn.textContent = 'Confirm Rejection';
        remarksWrap.style.display = 'flex';
    }

    if (type === 'expense') {
        summaryBox.innerHTML = `
            <div class="d-row"><span>Purchase Request:</span> <strong>${escapeHtml(record.pr_code || `PR-${record.id}`)}</strong></div>
            <div class="d-row"><span>Item:</span> <strong>${escapeHtml(record.item_name || record.name)}</strong></div>
            <div class="d-row"><span>Estimated Amount:</span> <strong style="color: var(--brown-soft);">₱${Number(record.amount || record.total_price || 0).toFixed(2)}</strong></div>
            <div class="d-row"><span>Requester:</span> <strong>${escapeHtml(record.requester_name || 'Procurement')}</strong></div>
        `;
    } else {
        summaryBox.innerHTML = `
            <div class="d-row"><span>Campaign Code:</span> <strong style="color: var(--accent-pink);">${escapeHtml(record.code)}</strong></div>
            <div class="d-row"><span>Pitch Title:</span> <strong>${escapeHtml(record.title || record.pitch_note)}</strong></div>
            <div class="d-row"><span>Discount Scheme:</span> <strong>${record.discount_type === 'percent' ? `${record.discount_value}% OFF` : `₱${record.discount_value}`}</strong></div>
            <div class="d-row"><span>Audience Target:</span> <strong>${escapeHtml(record.target_segment || 'All')}</strong></div>
        `;
    }

    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
}

function closeDecisionModal() {
    const modal = document.getElementById('decisionModal');
    if (modal) {
        modal.classList.remove('open');
        document.body.style.overflow = '';
    }
    activeDecisionTarget = null;
}

async function executeDecisionAction() {
    if (!activeDecisionTarget) return;

    const { type, id, action, record } = activeDecisionTarget;
    const remarks = document.getElementById('decisionRemarksInput')?.value || '';

    if (action === 'reject' && !remarks.trim()) {
        showCustomAlert("Remarks Required", "Please provide a reason for declining this request.", "warning");
        return;
    }

    try {
        const userId = localStorage.getItem('userId') || sessionStorage.getItem('userId');
        const payload = {
            type,
            id,
            action,
            rejection_reason: remarks.trim() || null
        };

        const response = await fetch('/api/ceo/budget-approval/action', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-user-id': userId || ''
            },
            body: JSON.stringify(payload)
        });

        const resData = await response.json();
        if (!response.ok || resData.status !== 'success') {
            throw new Error(resData.message || 'Server rejected authorization update');
        }

        closeDecisionModal();
        showCustomAlert(
            action === 'approve' ? "Authorization Confirmed" : "Request Declined",
            `${type === 'expense' ? 'Purchase Request' : 'Promo Pitch'} has been successfully updated in database.`,
            action === 'approve' ? "success" : "notice"
        );

        // Refresh Queue
        fetchCeoBudgetApprovals();

    } catch (err) {
        console.error('Error executing decision action:', err);
        showCustomAlert("Update Failed", err.message || "Could not complete authorization.", "warning");
    }
}

// --------------------------------------------------------------------------
// PRINT / PDF SUMMARY
// --------------------------------------------------------------------------
function exportApprovalSummaryPDF() {
    window.print();
}

function showCustomAlert(title, message, type = "notice") {
    const modal = document.getElementById('customAlertModal');
    if (!modal) return;
    document.getElementById('alertModalTitle').textContent = title;
    document.getElementById('alertModalMessage').textContent = message;

    const iconWrap = document.getElementById('alertDialogIconWrap');
    if (iconWrap) {
        iconWrap.className = 'dialog-icon-circle ' + (type === 'warning' ? 'reject' : (type === 'success' ? 'approve' : ''));
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

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}