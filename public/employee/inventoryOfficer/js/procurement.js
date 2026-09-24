let currentTab = 'requests';
let allVendors = [];
let allRequests = [];
let filteredRequests = [];
let filteredVendors = [];

// Pagination states
let currentReqPage = 1;
const REQ_PAGE_SIZE = 5;
let currentVenPage = 1;
const VEN_PAGE_SIZE = 5;

// Global SweetAlert2 Configuration matching Master SOP Section 2.E
const MMSwal = Swal.mixin({
    customClass: {
        popup: 'mm-swal-popup',
        title: 'mm-swal-title',
        confirmButton: 'mm-swal-confirm',
        cancelButton: 'mm-swal-cancel'
    },
    buttonsStyling: false
});

// POST JSON to the employee API with user header forwarding
async function apiPost(url, body) {
    const userId = localStorage.getItem('userId') || sessionStorage.getItem('userId');
    const headers = { 'Content-Type': 'application/json' };
    if (userId) headers['x-user-id'] = userId;

    const opts = {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
    };
    const res = (typeof employeeFetch === 'function') ? await employeeFetch(url, opts) : await fetch(url, opts);
    let data = {};
    try { data = await res.json(); } catch (e) {}
    if (!res.ok || data.status === 'error') {
        throw new Error(data.message || ('Server responded with status ' + res.status));
    }
    return data;
}

function formatPeso(n) {
    return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Clean badge definitions adhering to Zero-Emoji Rule
function routeBadge(route) {
    if (route === 'ceo') return { cls: 'route-ceo', dotCls: 'dot-ceo', text: 'CEO Clearance' };
    if (route === 'finance') return { cls: 'route-finance', dotCls: 'dot-finance', text: 'Finance Approval' };
    return { cls: 'route-procure', dotCls: 'dot-procure', text: 'Direct Buy' };
}

document.addEventListener('DOMContentLoaded', () => {
    fetchProcurementData();

    // Tab buttons
    document.getElementById('tabBtnRequests')?.addEventListener('click', () => switchTab('requests'));
    document.getElementById('tabBtnVendors')?.addEventListener('click', () => switchTab('vendors'));

    // Search and filter listeners
    document.getElementById('procurementSearchInput')?.addEventListener('input', applyCurrentFilters);
    document.getElementById('statusFilter')?.addEventListener('change', applyCurrentFilters);

    // Live DOA routing determination on Amount input in Modal
    const reqAmountInput = document.getElementById('reqAmount');
    if (reqAmountInput) {
        reqAmountInput.addEventListener('input', calculateModalThreshold);
    }

    // Form handlers
    document.getElementById('addRequestForm')?.addEventListener('submit', handleAddRequest);
    document.getElementById('addVendorForm')?.addEventListener('submit', handleAddVendor);
    document.getElementById('editVendorForm')?.addEventListener('submit', handleEditVendor);

    // Requests Pagination buttons
    document.getElementById('prevPrBtn')?.addEventListener('click', () => {
        if (currentReqPage > 1) {
            currentReqPage--;
            renderRequestsTable();
        }
    });
    document.getElementById('nextPrBtn')?.addEventListener('click', () => {
        const totalPages = Math.ceil(filteredRequests.length / REQ_PAGE_SIZE) || 1;
        if (currentReqPage < totalPages) {
            currentReqPage++;
            renderRequestsTable();
        }
    });

    // Vendors Pagination buttons
    document.getElementById('prevVenBtn')?.addEventListener('click', () => {
        if (currentVenPage > 1) {
            currentVenPage--;
            renderVendorsTable();
        }
    });
    document.getElementById('nextVenBtn')?.addEventListener('click', () => {
        const totalPages = Math.ceil(filteredVendors.length / VEN_PAGE_SIZE) || 1;
        if (currentVenPage < totalPages) {
            currentVenPage++;
            renderVendorsTable();
        }
    });
});

async function fetchProcurementData() {
    try {
        let response;
        if (typeof employeeFetch === 'function') {
            response = await employeeFetch('/api/procurement-officer/purchasing-vendor');
        } else {
            const userId = localStorage.getItem('userId') || sessionStorage.getItem('userId');
            const headers = userId ? { 'x-user-id': userId } : {};
            response = await fetch('/api/procurement-officer/purchasing-vendor', { headers });
        }

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.message || 'Server error ' + response.status);
        }

        const data = await response.json();

        // User profile
        const userFullNameEl = document.getElementById('userFullName');
        if (userFullNameEl) userFullNameEl.textContent = (data.user && data.user.fullName) || 'Procurement Officer';
        const userAvatarEl = document.getElementById('userAvatar');
        if (userAvatarEl && data.user?.avatarSrc) userAvatarEl.src = data.user.avatarSrc;

        allRequests = data.requests || [];
        allVendors = data.vendors || [];

        applyCurrentFilters();
        populateVendorDropdowns(allVendors);

    } catch (error) {
        console.error('Could not load procurement data from server:', error);
        MMSwal.fire({
            icon: 'warning',
            title: 'System Notice',
            text: error.message || 'Could not load procurement directory.'
        });
    }
}

// Live DOA Calculation in Add Request Modal
function calculateModalThreshold() {
    const amount = parseFloat(document.getElementById('reqAmount')?.value || 0);
    const displayEl = document.getElementById('previewCostDisplay');
    const badgeEl = document.getElementById('routingBadgePreview');

    if (displayEl) {
        displayEl.textContent = '₱' + formatPeso(amount);
    }

    if (badgeEl) {
        if (amount <= 300) {
            badgeEl.className = 'badge-route route-procure';
            badgeEl.innerHTML = '<span class="badge-dot dot-procure"></span> Direct Route: Procurement Officer (Direct Buy Authorized)';
        } else if (amount > 300 && amount <= 500) {
            badgeEl.className = 'badge-route route-finance';
            badgeEl.innerHTML = '<span class="badge-dot dot-finance"></span> Escalation Route: Requires Financial Officer Clearance';
        } else {
            badgeEl.className = 'badge-route route-ceo';
            badgeEl.innerHTML = '<span class="badge-dot dot-ceo"></span> Executive Route: Requires CEO Approval (High Capital Expense)';
        }
    }
}

// Unified Filter
function applyCurrentFilters() {
    const q = document.getElementById('procurementSearchInput')?.value.toLowerCase().trim() || '';
    const statusFilter = document.getElementById('statusFilter')?.value || '';

    // Purchase requests
    filteredRequests = allRequests.filter(req => {
        if (statusFilter && req.status !== statusFilter) return false;
        if (q) {
            const name = (req.name || '').toLowerCase();
            const code = (req.pr_code || '').toLowerCase();
            const who = (req.requester_name || '').toLowerCase();
            const supp = (req.vendor_name || '').toLowerCase();
            if (!name.includes(q) && !code.includes(q) && !who.includes(q) && !supp.includes(q)) return false;
        }
        return true;
    });

    // Vendors
    filteredVendors = allVendors.filter(v => {
        if (q) {
            const vName = (v.vendor_name || '').toLowerCase();
            const cat = (v.category_desc || '').toLowerCase();
            const mail = (v.contact_email || '').toLowerCase();
            if (!vName.includes(q) && !cat.includes(q) && !mail.includes(q)) return false;
        }
        return true;
    });

    document.getElementById('requestsCount').textContent = allRequests.length;
    document.getElementById('vendorsCount').textContent = allVendors.length;

    currentReqPage = 1;
    currentVenPage = 1;

    renderRequestsTable();
    renderVendorsTable();
}

// Render Requests Table with Permanent Pager
function renderRequestsTable() {
    const tbody = document.getElementById('requestsTableBody');
    const pageInfo = document.getElementById('prPageInfo');
    const prevBtn = document.getElementById('prevPrBtn');
    const nextBtn = document.getElementById('nextPrBtn');

    if (!tbody) return;

    if (filteredRequests.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="loading-state-text">No purchase requests recorded for this filter.</td></tr>';
        if (pageInfo) pageInfo.textContent = 'Showing 0 of 0 requests';
        if (prevBtn) prevBtn.disabled = true;
        if (nextBtn) nextBtn.disabled = true;
        renderPrPagerButtons(1, 1);
        return;
    }

    const totalPages = Math.ceil(filteredRequests.length / REQ_PAGE_SIZE) || 1;
    const startIndex = (currentReqPage - 1) * REQ_PAGE_SIZE;
    const pageItems = filteredRequests.slice(startIndex, startIndex + REQ_PAGE_SIZE);

    if (pageInfo) {
        const startNum = startIndex + 1;
        const endNum = Math.min(startIndex + REQ_PAGE_SIZE, filteredRequests.length);
        pageInfo.textContent = `Showing ${startNum}-${endNum} of ${filteredRequests.length} requests`;
    }
    if (prevBtn) prevBtn.disabled = currentReqPage <= 1;
    if (nextBtn) nextBtn.disabled = currentReqPage >= totalPages;

    renderPrPagerButtons(totalPages, currentReqPage);

    tbody.innerHTML = pageItems.map(req => {
        const badge = routeBadge(req.route);
        const price = formatPeso(req.total_price);
        const canDirectBuy = req.route === 'procure' && req.status !== 'PURCHASED';

        return `
            <tr>
                <td>
                    <strong style="color: var(--brown-soft); font-size: 13px;">${escapeHtml(req.name)}</strong>
                    <div style="font-size: 11px; color: var(--text-muted);">${escapeHtml(req.pr_code)}</div>
                </td>
                <td><span style="font-weight: 700;">${escapeHtml(req.requester_name) || '—'}</span></td>
                <td><span style="font-weight: 700;">${escapeHtml(req.vendor_name) || '—'}</span></td>
                <td><strong style="color: var(--brown-soft); font-family: var(--font-family-heading); font-size: 13.5px;">₱${price}</strong></td>
                <td>
                    <span class="badge-route ${badge.cls}"><span class="badge-dot ${badge.dotCls}"></span> ${badge.text}</span>
                    <div style="font-size: 10.5px; color: var(--text-muted); margin-top: 2px;">Status: <strong>${escapeHtml(req.status)}</strong></div>
                </td>
                <td style="text-align: right;">
                    ${canDirectBuy ? `
                        <button type="button" class="btn-buy-instant" onclick="executeDirectBuy(${Number(req.id)})">
                            Buy Instant
                        </button>
                    ` : `
                        <button type="button" class="btn-view-status" onclick="showRequestStatus(${Number(req.id)})">
                            View Status
                        </button>
                    `}
                </td>
            </tr>
        `;
    }).join('');
}

// Requests Numbered Pager
function renderPrPagerButtons(totalPages, activePage) {
    const pagerNumbers = document.getElementById('prPagerNumbers');
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
            if (page && page !== currentReqPage) {
                currentReqPage = page;
                renderRequestsTable();
            }
        });
    });
}

// Render Vendors Table with Permanent Pager
function renderVendorsTable() {
    const tbody = document.getElementById('vendorsTableBody');
    const pageInfo = document.getElementById('venPageInfo');
    const prevBtn = document.getElementById('prevVenBtn');
    const nextBtn = document.getElementById('nextVenBtn');

    if (!tbody) return;

    if (filteredVendors.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="loading-state-text">No partner vendors recorded.</td></tr>';
        if (pageInfo) pageInfo.textContent = 'Showing 0 of 0 vendors';
        if (prevBtn) prevBtn.disabled = true;
        if (nextBtn) nextBtn.disabled = true;
        renderVenPagerButtons(1, 1);
        return;
    }

    const totalPages = Math.ceil(filteredVendors.length / VEN_PAGE_SIZE) || 1;
    const startIndex = (currentVenPage - 1) * VEN_PAGE_SIZE;
    const pageItems = filteredVendors.slice(startIndex, startIndex + VEN_PAGE_SIZE);

    if (pageInfo) {
        const startNum = startIndex + 1;
        const endNum = Math.min(startIndex + VEN_PAGE_SIZE, filteredVendors.length);
        pageInfo.textContent = `Showing ${startNum}-${endNum} of ${filteredVendors.length} vendors`;
    }
    if (prevBtn) prevBtn.disabled = currentVenPage <= 1;
    if (nextBtn) nextBtn.disabled = currentVenPage >= totalPages;

    renderVenPagerButtons(totalPages, currentVenPage);

    tbody.innerHTML = pageItems.map(v => {
        const vCode = 'VEN-' + String(v.id).padStart(3, '0');
        const totalSpent = Number(v.total_spent || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const vStatus = v.status || 'Active';
        const vClass = vStatus.toLowerCase() === 'active' ? '' : (vStatus.toLowerCase() === 'review' ? 'review' : 'closed');

        return `
            <tr>
                <td>
                    <strong style="color: var(--brown-soft); font-size: 13px;">${escapeHtml(v.vendor_name)}</strong>
                    <div style="font-size: 11px; color: var(--text-muted);">${vCode}</div>
                </td>
                <td><span style="font-size: 12px; color: var(--text-dark);">${escapeHtml(v.category_desc) || '—'}</span></td>
                <td><span style="font-size: 11.5px; color: var(--text-muted);">${escapeHtml(v.contact_email) || '—'}</span></td>
                <td><span class="status-pill-vendor ${vClass}">${escapeHtml(vStatus)}</span></td>
                <td><strong style="color: var(--brown-soft);">₱${totalSpent}</strong></td>
                <td style="text-align: right;">
                    <button type="button" class="btn-view-status" onclick="openEditVendor(${v.id})">
                        Edit
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

// Vendors Numbered Pager
function renderVenPagerButtons(totalPages, activePage) {
    const pagerNumbers = document.getElementById('venPagerNumbers');
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
            if (page && page !== currentVenPage) {
                currentVenPage = page;
                renderVendorsTable();
            }
        });
    });
}

// Direct Buy Action for ≤ ₱300 with SweetAlert2 confirmation
async function executeDirectBuy(reqId) {
    const req = allRequests.find(r => r.id === reqId);
    if (!req) return;

    const res = await MMSwal.fire({
        title: 'Authorize Direct Buy?',
        html: `Mark <strong>"${escapeHtml(req.name)}"</strong> (₱${formatPeso(req.total_price)}) as purchased?<br><br><small style="color:var(--text-muted);">Requisitions of ₱300 or less fall within your direct purchase authority.</small>`,
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: 'Confirm Purchase',
        cancelButtonText: 'Cancel'
    });

    if (!res.isConfirmed) return;

    try {
        await apiPost('/api/procurement-officer/mark-purchased', { expense_id: reqId });
        await fetchProcurementData();
        MMSwal.fire({
            icon: 'success',
            title: 'Purchase Recorded',
            text: `"${req.name}" marked as purchased successfully.`
        });
    } catch (error) {
        MMSwal.fire({
            icon: 'warning',
            title: 'Purchase Failed',
            text: error.message || 'Could not complete purchase action.'
        });
    }
}

// Themed Route Inspector Dialog
function showRequestStatus(reqId) {
    const req = allRequests.find(r => r.id === reqId);
    if (!req) return;

    const b = routeBadge(req.route);
    let routingNote = 'Authorized for instant petty cash purchase by the Procurement Officer.';
    if (req.route === 'finance') routingNote = 'Escalated to the Finance Officer dashboard for fund allocation clearance.';
    if (req.route === 'ceo') routingNote = 'High-capital requisition escalated directly to the CEO for executive approval.';

    MMSwal.fire({
        title: req.pr_code || 'Requisition Details',
        html: `
            <div style="text-align: left; font-size: 13px; line-height: 1.6; color: var(--text-dark);">
                <div style="margin-bottom: 8px;"><strong>Item:</strong> ${escapeHtml(req.name)}</div>
                <div style="margin-bottom: 8px;"><strong>Total Amount:</strong> ₱${formatPeso(req.total_price)}</div>
                <div style="margin-bottom: 8px;"><strong>DOA Tier:</strong> <span class="badge-route ${b.cls}"><span class="badge-dot ${b.dotCls}"></span> ${b.text}</span></div>
                <div style="margin-bottom: 8px;"><strong>Status:</strong> ${escapeHtml(req.status)}</div>
                <div style="background: var(--bg-main); padding: 10px 12px; border-radius: 10px; margin-top: 10px; border-left: 3px solid var(--accent-pink);">
                    ${routingNote}
                </div>
            </div>
        `,
        confirmButtonText: 'Close'
    });
}

function populateVendorDropdowns(vendors) {
    const select = document.getElementById('reqVendorName');
    if (!select) return;

    select.innerHTML = '<option value="">-- Choose Partner Vendor --</option>' + 
        vendors.map(v => `<option value="${escapeHtml(v.vendor_name)}">${escapeHtml(v.vendor_name)}</option>`).join('');
}

function switchTab(tab) {
    currentTab = tab;
    const reqBtn = document.getElementById('tabBtnRequests');
    const venBtn = document.getElementById('tabBtnVendors');
    const reqView = document.getElementById('requestsTableView');
    const venView = document.getElementById('vendorsTableView');
    const addVenBtn = document.getElementById('btnAddVendorTrigger');
    const doaLegend = document.getElementById('doaLegendRow');

    if (tab === 'requests') {
        reqBtn?.classList.add('active');
        venBtn?.classList.remove('active');
        reqView?.classList.add('active');
        venView?.classList.remove('active');
        addVenBtn?.classList.remove('show');
        if (doaLegend) doaLegend.style.display = 'flex';
    } else {
        venBtn?.classList.add('active');
        reqBtn?.classList.remove('active');
        venView?.classList.add('active');
        reqView?.classList.remove('active');
        addVenBtn?.classList.add('show');
        if (doaLegend) doaLegend.style.display = 'none';
    }
    applyCurrentFilters();
}

async function handleAddRequest(e) {
    e.preventDefault();
    const item_name = document.getElementById('reqItemName').value.trim();
    const amount = parseFloat(document.getElementById('reqAmount').value);
    const vendor_name = document.getElementById('reqVendorName').value;
    const qty = parseInt(document.getElementById('reqQty').value || 1, 10);

    if (!item_name || isNaN(amount) || amount <= 0) {
        MMSwal.fire({
            icon: 'warning',
            title: 'Incomplete Input',
            text: 'Please fill out all required fields.'
        });
        return;
    }

    const submitBtn = e.target.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;

    try {
        const result = await apiPost('/api/procurement-officer/add-request', {
            item_name: qty > 1 ? `${item_name} (${qty}x)` : item_name,
            store_name: vendor_name,
            amount
        });

        closeModal('addRequestModal');
        e.target.reset();
        calculateModalThreshold();
        await fetchProcurementData();

        const route = result.request && result.request.route;
        let routeText = 'Direct purchase authorized for Procurement';
        if (route === 'finance') routeText = 'Escalated to Finance Officer';
        if (route === 'ceo') routeText = 'Escalated to the CEO';

        MMSwal.fire({
            icon: 'success',
            title: 'Requisition Submitted',
            text: `Requisition for "${item_name}" (₱${formatPeso(amount)}) saved.\n\nRouting: ${routeText}`
        });
    } catch (error) {
        MMSwal.fire({
            icon: 'warning',
            title: 'Submission Failed',
            text: error.message || 'Could not save the requisition.'
        });
    } finally {
        if (submitBtn) submitBtn.disabled = false;
    }
}

async function handleAddVendor(e) {
    e.preventDefault();
    const vendor_name = document.getElementById('addVendorName').value.trim();
    const category = document.getElementById('addVendorCategory').value.trim();
    const contact = document.getElementById('addVendorContact').value.trim();
    const status = document.getElementById('addVendorStatus').value;

    const submitBtn = e.target.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;

    try {
        await apiPost('/api/procurement-officer/add-vendor', { vendor_name, category, contact, status });
        closeModal('addVendorModal');
        e.target.reset();
        await fetchProcurementData();
        MMSwal.fire({
            icon: 'success',
            title: 'Vendor Registered',
            text: `Vendor "${vendor_name}" has been registered successfully.`
        });
    } catch (error) {
        MMSwal.fire({
            icon: 'warning',
            title: 'Registration Failed',
            text: error.message || 'Could not save the vendor.'
        });
    } finally {
        if (submitBtn) submitBtn.disabled = false;
    }
}

function openEditVendor(vendorId) {
    const v = allVendors.find(item => String(item.id) === String(vendorId));
    if (!v) return;

    document.getElementById('editVendorId').value = v.id;
    document.getElementById('editVendorName').value = v.vendor_name || '';
    document.getElementById('editVendorCategory').value = v.category_desc || '';
    document.getElementById('editVendorContact').value = v.contact_email || '';
    document.getElementById('editVendorStatus').value = v.status || 'Active';
    openModal('editVendorModal');
}

async function handleEditVendor(e) {
    e.preventDefault();
    const vendor_id = parseInt(document.getElementById('editVendorId').value, 10);
    const vendor_name = document.getElementById('editVendorName').value.trim();
    const category = document.getElementById('editVendorCategory').value.trim();
    const contact = document.getElementById('editVendorContact').value.trim();
    const status = document.getElementById('editVendorStatus').value;

    const submitBtn = e.target.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;

    try {
        await apiPost('/api/procurement-officer/edit-vendor', { vendor_id, vendor_name, category, contact, status });
        closeModal('editVendorModal');
        await fetchProcurementData();
        MMSwal.fire({
            icon: 'success',
            title: 'Vendor Updated',
            text: `Vendor "${vendor_name}" updated successfully.`
        });
    } catch (error) {
        MMSwal.fire({
            icon: 'warning',
            title: 'Update Failed',
            text: error.message || 'Could not update the vendor.'
        });
    } finally {
        if (submitBtn) submitBtn.disabled = false;
    }
}

function openModal(id) {
    const m = document.getElementById(id);
    if (m) {
        m.classList.add('open');
        document.body.style.overflow = 'hidden';
    }
}

function closeModal(id) {
    const m = document.getElementById(id);
    if (m) {
        m.classList.remove('open');
        document.body.style.overflow = '';
    }
}

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}