let allRequests = [];
let filteredRequests = [];
let currentPrPage = 1;
const PR_PAGE_SIZE = 4;
let activeFilterRoute = 'all';

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

document.addEventListener('DOMContentLoaded', () => {
    fetchProcurementDashboardData();

    // 1. Live DOA threshold calculation in Add Request modal
    const qtyInput = document.getElementById('requestQty');
    const unitCostInput = document.getElementById('unitCost');
    if (qtyInput && unitCostInput) {
        qtyInput.addEventListener('input', calculateModalThreshold);
        unitCostInput.addEventListener('input', calculateModalThreshold);
    }

    // 2. Add request form submit
    const addRequestForm = document.getElementById('addRequestForm');
    if (addRequestForm) {
        addRequestForm.addEventListener('submit', handleAddRequestSubmit);
    }

    // 3. Search bar filter
    const searchInput = document.getElementById('procurementSearchInput');
    if (searchInput) {
        searchInput.addEventListener('input', applyRequestsFilter);
    }

    // 4. Route filter tabs
    const tabButtons = document.querySelectorAll('.order-filter-tabs .tab-btn');
    tabButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            tabButtons.forEach(b => b.classList.remove('active'));
            e.currentTarget.classList.add('active');
            activeFilterRoute = e.currentTarget.getAttribute('data-filter') || 'all';
            applyRequestsFilter();
        });
    });

    // 5. Pagination buttons
    const prevBtn = document.getElementById('prevPrBtn');
    const nextBtn = document.getElementById('nextPrBtn');

    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            if (currentPrPage > 1) {
                currentPrPage--;
                renderPurchaseRequests();
            }
        });
    }

    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            const totalPages = Math.ceil(filteredRequests.length / PR_PAGE_SIZE) || 1;
            if (currentPrPage < totalPages) {
                currentPrPage++;
                renderPurchaseRequests();
            }
        });
    }

    // 6. Delivery Receiving Inspection & Variance calculation
    const usableInput = document.getElementById('usableReceivedUnits');
    if (usableInput) {
        usableInput.addEventListener('input', updateDeliveryVarianceCalculation);
    }

    const receiveDeliveryForm = document.getElementById('receiveDeliveryForm');
    if (receiveDeliveryForm) {
        receiveDeliveryForm.addEventListener('submit', handleReceiveDeliverySubmit);
    }
});

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

function pad2(n) {
    return String(Number(n) || 0).padStart(2, '0');
}

function formatPeso(n) {
    return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// POST helper with user header forwarding
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

// Clean badge definitions adhering to Zero-Emoji Rule
function routeBadge(route) {
    if (route === 'ceo') return { cls: 'route-ceo', dotCls: 'dot-ceo', text: 'CEO Clearance' };
    if (route === 'finance') return { cls: 'route-finance', dotCls: 'dot-finance', text: 'Finance Endorsement' };
    return { cls: 'route-procure', dotCls: 'dot-procure', text: 'Direct Buy' };
}

// Fetch all live dashboard metrics
async function fetchProcurementDashboardData() {
    try {
        let response;
        if (typeof employeeFetch === 'function') {
            response = await employeeFetch('/api/procurement-officer/dashboard');
        } else {
            const userId = localStorage.getItem('userId') || sessionStorage.getItem('userId');
            const headers = userId ? { 'x-user-id': userId } : {};
            response = await fetch('/api/procurement-officer/dashboard', { headers });
        }

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.message || 'Server error ' + response.status);
        }

        const data = await response.json();

        // Profile header
        const user = data.user || {};
        setText('userName', user.fullName || 'Procurement Officer');
        const welcome = document.getElementById('welcomeTitle');
        if (welcome) welcome.textContent = user.firstName ? `Glad to have you here, ${user.firstName}!` : 'Glad to have you here!';
        const userAvatarEl = document.getElementById('userAvatar');
        if (userAvatarEl && user.avatarSrc) userAvatarEl.src = user.avatarSrc;

        // KPI Cards
        const m = data.metrics || {};
        setText('directBuyCount', pad2(m.directBuyCount));
        setText('escalatedCount', pad2(m.escalatedCount));
        setText('itemsMonitored', pad2(m.itemsMonitored));
        setText('attentionCount', pad2(data.attentionCount));

        allRequests = data.purchaseRequests || [];
        applyRequestsFilter();
        renderVendorsList(data.vendorsList, data.vendorStats);
        renderInventoryStats(data.inventoryCategory);
        renderAttentionCallout(data.attentionCount, data.lowStockItems);

        // Populate Hybrid Supplier datalist (Punto 3)
        populateSupplierDatalist(data.vendorsList);

    } catch (error) {
        console.error('Could not load procurement dashboard data:', error);
        MMSwal.fire({
            icon: 'warning',
            title: 'System Notice',
            text: error.message || 'Could not load procurement data from server.'
        });
    }
}

// Punto 3: Populate Supplier Datalist for Hybrid Selection
function populateSupplierDatalist(vendors) {
    const datalist = document.getElementById('vendorDatalist');
    if (!datalist) return;

    if (!vendors || vendors.length === 0) {
        datalist.innerHTML = `
            <option value="Puregold Monumento"></option>
            <option value="Ever Supermarket Caloocan"></option>
            <option value="Public Market / Talipapa"></option>
        `;
        return;
    }

    datalist.innerHTML = vendors.map(v => `<option value="${escapeHtml(v.vendor_name)}"></option>`).join('');
}

// Live DOA threshold calculation in Add Request Modal
function calculateModalThreshold() {
    const qty = parseFloat(document.getElementById('requestQty')?.value || 1);
    const unitCost = parseFloat(document.getElementById('unitCost')?.value || 0);
    const total = qty * unitCost;

    const totalEl = document.getElementById('previewTotalCost');
    const badgeEl = document.getElementById('routingBadge');

    if (totalEl) {
        totalEl.textContent = '₱' + formatPeso(total);
    }

    if (badgeEl) {
        if (total <= 300) {
            badgeEl.className = 'badge-route route-procure';
            badgeEl.innerHTML = '<span class="badge-dot dot-procure"></span> Direct Route: Procurement Officer (Direct Purchase Authorized)';
        } else if (total <= 500) {
            badgeEl.className = 'badge-route route-finance';
            badgeEl.innerHTML = '<span class="badge-dot dot-finance"></span> Escalation Route: Requires Finance Officer Endorsement';
        } else {
            badgeEl.className = 'badge-route route-ceo';
            badgeEl.innerHTML = '<span class="badge-dot dot-ceo"></span> Executive Route: Requires CEO Approval (Major Capital)';
        }
    }
}

// Filter requests by search string & DOA tabs
function applyRequestsFilter() {
    const searchVal = document.getElementById('procurementSearchInput')?.value.trim().toLowerCase() || '';

    filteredRequests = allRequests.filter(pr => {
        if (activeFilterRoute === 'escalated') {
            if (pr.route === 'procure') return false;
        } else if (activeFilterRoute !== 'all' && pr.route !== activeFilterRoute) {
            return false;
        }

        if (searchVal) {
            const code = (pr.pr_code || '').toLowerCase();
            const name = (pr.name || '').toLowerCase();
            const who = (pr.requester_name || '').toLowerCase();
            const supp = (pr.supplier || '').toLowerCase();
            if (!code.includes(searchVal) && !name.includes(searchVal) && !who.includes(searchVal) && !supp.includes(searchVal)) {
                return false;
            }
        }
        return true;
    });

    currentPrPage = 1;
    renderPurchaseRequests();
}

// Render purchase requests table (With Punto 1 Receiving Flow)
function renderPurchaseRequests() {
    const tbody = document.getElementById('purchaseRequestsList');
    const pageInfo = document.getElementById('prPageInfo');
    const prevBtn = document.getElementById('prevPrBtn');
    const nextBtn = document.getElementById('nextPrBtn');

    if (!tbody) return;

    if (filteredRequests.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="loading-state-text">No purchase requests found under this filter criteria.</td></tr>';
        if (pageInfo) pageInfo.textContent = 'Showing 0 of 0 requests';
        if (prevBtn) prevBtn.disabled = true;
        if (nextBtn) nextBtn.disabled = true;
        renderPrPagerButtons(1, 1);
        return;
    }

    const totalPages = Math.ceil(filteredRequests.length / PR_PAGE_SIZE) || 1;
    const startIndex = (currentPrPage - 1) * PR_PAGE_SIZE;
    const pageItems = filteredRequests.slice(startIndex, startIndex + PR_PAGE_SIZE);

    if (pageInfo) {
        const startNum = startIndex + 1;
        const endNum = Math.min(startIndex + PR_PAGE_SIZE, filteredRequests.length);
        pageInfo.textContent = `Showing ${startNum}-${endNum} of ${filteredRequests.length} requests`;
    }
    if (prevBtn) prevBtn.disabled = currentPrPage <= 1;
    if (nextBtn) nextBtn.disabled = currentPrPage >= totalPages;

    renderPrPagerButtons(totalPages, currentPrPage);

    tbody.innerHTML = pageItems.map(pr => {
        const price = formatPeso(pr.total_price);
        const badge = routeBadge(pr.route);
        const statusUpper = String(pr.status || '').toUpperCase();

        const canDirectBuy = pr.route === 'procure' && statusUpper !== 'PURCHASED' && statusUpper !== 'RECEIVED';
        const isReadyToReceive = statusUpper === 'PURCHASED' || statusUpper === 'APPROVED';

        let actionButtonHtml = '';
        if (canDirectBuy) {
            actionButtonHtml = `
                <button type="button" class="btn-buy-instant" onclick="handleDirectBuy(${Number(pr.id)})">
                    Buy Instant
                </button>
            `;
        } else if (isReadyToReceive && statusUpper !== 'RECEIVED') {
            actionButtonHtml = `
                <button type="button" class="btn-receive-audit" onclick="openReceiveDeliveryModal(${Number(pr.id)})">
                    Receive &amp; Audit
                </button>
            `;
        } else {
            actionButtonHtml = `
                <button type="button" class="btn-view-status" onclick="showRouteInfo(${Number(pr.id)})">
                    View Route
                </button>
            `;
        }

        return `
            <tr>
                <td>
                    <strong style="color: var(--brown-soft); font-size: 13px;">${escapeHtml(pr.name)}</strong>
                    <div style="font-size: 11px; color: var(--text-muted);">${escapeHtml(pr.pr_code)}</div>
                </td>
                <td>
                    <div style="font-weight: 700; color: var(--text-dark);">${escapeHtml(pr.requester_name) || '—'}</div>
                    <div style="font-size: 11px; color: var(--text-muted);">${escapeHtml(pr.supplier) || 'Local Store'}</div>
                </td>
                <td><strong style="color: var(--brown-soft); font-family: var(--font-family-heading); font-size: 13.5px;">₱${price}</strong></td>
                <td>
                    <span class="badge-route ${badge.cls}"><span class="badge-dot ${badge.dotCls}"></span> ${badge.text}</span>
                    <div style="font-size: 10.5px; color: var(--text-muted); margin-top: 2px;">Status: <strong>${escapeHtml(pr.status)}</strong></div>
                </td>
                <td style="text-align: right;">
                    ${actionButtonHtml}
                </td>
            </tr>
        `;
    }).join('');
}

// Punto 1: Open Delivery Receiving Inspection Dialog
function openReceiveDeliveryModal(prId) {
    const pr = allRequests.find(r => r.id === prId);
    if (!pr) return;

    document.getElementById('receivePrId').value = pr.id;
    document.getElementById('receiveItemRawName').value = pr.name;

    // Parse expected quantity from string if available (e.g., "Condensed Milk (10x)")
    let expectedQty = 1;
    const match = pr.name.match(/\(([0-9.]+)x\)/i);
    if (match) {
        expectedQty = parseFloat(match[1]);
    }

    document.getElementById('expectedUnitsCount').value = expectedQty;
    document.getElementById('usableReceivedUnits').value = expectedQty;
    document.getElementById('receiveManifestDisplay').textContent = `${pr.pr_code} — ${pr.name} (Supplier: ${pr.supplier || 'Local Store'})`;

    updateDeliveryVarianceCalculation();
    openModal('receiveDeliveryModal');
}

// Punto 1: Live Delivery Variance Calculation
function updateDeliveryVarianceCalculation() {
    const expected = parseFloat(document.getElementById('expectedUnitsCount')?.value || 0);
    const usable = parseFloat(document.getElementById('usableReceivedUnits')?.value || 0);
    const variance = expected - usable;

    const varianceTextEl = document.getElementById('calculatedVarianceText');
    const explanationEl = document.getElementById('varianceExplanation');
    const noticeBox = document.getElementById('varianceNoticeBox');

    if (!varianceTextEl || !explanationEl) return;

    if (variance === 0) {
        varianceTextEl.className = 'variance-ok';
        varianceTextEl.textContent = '0 discrepancy (100% matched)';
        explanationEl.textContent = 'All expected items accounted for. Full quantity will be entered into stock.';
        if (noticeBox) noticeBox.style.borderLeftColor = '#2E7D32';
    } else if (variance > 0) {
        varianceTextEl.className = 'variance-shortage';
        varianceTextEl.textContent = `Shortage: -${variance} unit(s) missing or damaged`;
        explanationEl.textContent = `Audit Alert: Only the ${usable} usable units will be added to inventory. ${variance} unit(s) recorded as delivery loss for accounting.`;
        if (noticeBox) noticeBox.style.borderLeftColor = '#C9302C';
    } else {
        varianceTextEl.className = 'variance-excess';
        varianceTextEl.textContent = `Surplus: +${Math.abs(variance)} extra units`;
        explanationEl.textContent = 'Extra stock received. Will be credited to on-hand inventory.';
        if (noticeBox) noticeBox.style.borderLeftColor = '#EAA342';
    }
}

// Punto 1: Handle Receiving & Stock Inflow Submission
async function handleReceiveDeliverySubmit(e) {
    e.preventDefault();

    const prId = document.getElementById('receivePrId').value;
    const itemName = document.getElementById('receiveItemRawName').value.replace(/\s*\([0-9.]+x\)/i, '').trim();
    const expectedQty = parseFloat(document.getElementById('expectedUnitsCount').value || 0);
    const usableQty = parseFloat(document.getElementById('usableReceivedUnits').value || 0);
    const department = document.getElementById('destinationCategory').value;
    const unit = document.getElementById('destinationUnit').value;
    const notes = document.getElementById('receivingAuditNotes').value.trim();

    const variance = expectedQty - usableQty;

    const submitBtn = e.target.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;

    try {
        // 1. Add ONLY usable units to inventory_items
        if (usableQty > 0) {
            await apiPost('/api/procurement-officer/add-stock', {
                name: itemName,
                department: department === 'packaging' ? 'Packaging' : (department === 'equipment' ? 'Equipment' : 'Ingredients'),
                quantity: usableQty,
                unit: unit,
                reorder_level: 10
            });
        }

        // 2. Mark expense as received with inspection audit notes
        const auditLogNote = `Physical Receiving Audit: Expected ${expectedQty}, Received Usable: ${usableQty}, Variance: ${variance}. Notes: ${notes || 'Standard acceptance.'}`;
        await apiPost('/api/procurement-officer/mark-purchased', {
            expense_id: prId,
            status: 'RECEIVED',
            audit_note: auditLogNote
        });

        closeModal('receiveDeliveryModal');
        e.target.reset();
        await fetchProcurementDashboardData();

        MMSwal.fire({
            icon: 'success',
            title: 'Stock Verified & Inflowed',
            html: `
                <div style="text-align: left; font-size: 13px; line-height: 1.6;">
                    <strong>Item:</strong> ${escapeHtml(itemName)}<br>
                    <strong>Added to Warehouse:</strong> +${usableQty} ${unit}<br>
                    <strong>Discrepancy / Loss:</strong> ${variance} unit(s)<br>
                    <small style="color:var(--text-muted); display:block; margin-top:8px;">Inventory count and audit trail successfully updated.</small>
                </div>
            `
        });

    } catch (error) {
        MMSwal.fire({
            icon: 'warning',
            title: 'Receiving Failed',
            text: error.message || 'Could not verify delivery.'
        });
    } finally {
        if (submitBtn) submitBtn.disabled = false;
    }
}

// Themed Route Inspector Dialog
function showRouteInfo(prId) {
    const pr = allRequests.find(r => r.id === prId);
    if (!pr) return;

    const b = routeBadge(pr.route);
    let routingNote = 'Authorized for instant petty cash purchase by the Procurement Officer.';
    if (pr.route === 'finance') routingNote = 'Escalated to the Finance Officer dashboard for fund allocation clearance.';
    if (pr.route === 'ceo') routingNote = 'High-capital requisition escalated directly to the CEO for executive approval.';

    MMSwal.fire({
        title: pr.pr_code || 'Requisition Details',
        html: `
            <div style="text-align: left; font-size: 13px; line-height: 1.6; color: var(--text-dark);">
                <div style="margin-bottom: 8px;"><strong>Item:</strong> ${escapeHtml(pr.name)}</div>
                <div style="margin-bottom: 8px;"><strong>Total Amount:</strong> ₱${formatPeso(pr.total_price)}</div>
                <div style="margin-bottom: 8px;"><strong>DOA Tier:</strong> <span class="badge-route ${b.cls}"><span class="badge-dot ${b.dotCls}"></span> ${b.text}</span></div>
                <div style="margin-bottom: 8px;"><strong>Status:</strong> ${escapeHtml(pr.status)}</div>
                <div style="background: var(--bg-main); padding: 10px 12px; border-radius: 10px; margin-top: 10px; border-left: 3px solid var(--accent-pink);">
                    ${routingNote}
                </div>
            </div>
        `,
        confirmButtonText: 'Close'
    });
}

// Numbered pager rendering
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
            if (page && page !== currentPrPage) {
                currentPrPage = page;
                renderPurchaseRequests();
            }
        });
    });
}

// Direct Buy for requests ≤ ₱300 with SweetAlert2 confirmation
async function handleDirectBuy(prId) {
    const item = allRequests.find(r => r.id === prId);
    if (!item) return;

    const res = await MMSwal.fire({
        title: 'Authorize Direct Buy?',
        html: `Mark <strong>"${escapeHtml(item.name)}"</strong> (₱${formatPeso(item.total_price)}) as purchased?<br><br><small style="color:var(--text-muted);">Requisitions of ₱300 or less fall within your direct purchase authority.</small>`,
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: 'Confirm Purchase',
        cancelButtonText: 'Cancel'
    });

    if (!res.isConfirmed) return;

    try {
        await apiPost('/api/procurement-officer/mark-purchased', { expense_id: prId });
        await fetchProcurementDashboardData();
        MMSwal.fire({
            icon: 'success',
            title: 'Purchase Recorded',
            text: `"${item.name}" marked as purchased. You may now inspect and receive items once delivered.`
        });
    } catch (error) {
        MMSwal.fire({
            icon: 'warning',
            title: 'Purchase Failed',
            text: error.message || 'Could not complete purchase action.'
        });
    }
}

function filterRequestsByRoute(route) {
    const tabButtons = document.querySelectorAll('.order-filter-tabs .tab-btn');
    tabButtons.forEach(b => {
        if (b.getAttribute('data-filter') === route) b.classList.add('active');
        else b.classList.remove('active');
    });
    activeFilterRoute = route;
    applyRequestsFilter();
}

// Suppliers list rendering
function renderVendorsList(vendors, stats) {
    const container = document.getElementById('vendorList');
    if (!container) return;

    const s = stats || {};
    setText('totalVendorsCount', s.totalVendorsCount != null ? s.totalVendorsCount : (vendors || []).length);
    setText('activeVendorsPercent', s.activeVendorsPercent != null ? `${s.activeVendorsPercent}%` : '—');

    if (!vendors || vendors.length === 0) {
        container.innerHTML = '<p class="loading-state-text">No suppliers in the directory yet.</p>';
        return;
    }

    container.innerHTML = vendors.map(vendor => `
        <div class="vendor-item">
            <div class="vendor-leading">
                <div class="vendor-img-placeholder">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M1 3h15v13H1z"></path>
                        <path d="M16 8h4l3 3v5h-7V8z"></path>
                        <circle cx="5.5" cy="18.5" r="2.5"></circle>
                        <circle cx="18.5" cy="18.5" r="2.5"></circle>
                    </svg>
                </div>
                <div>
                    <div class="vendor-name">${escapeHtml(vendor.vendor_name)}</div>
                    <div class="vendor-desc">${escapeHtml(vendor.category_desc) || 'Verified Supplier'}</div>
                </div>
            </div>
            <span class="status-pill-vendor">${escapeHtml(vendor.status) || 'Active'}</span>
        </div>
    `).join('');
}

// Warehouse category units
function renderInventoryStats(category) {
    const c = category || {};
    const totalUnits = c.totalAvailableUnits || 0;
    const ingUnits = c.ingUnits || 0;
    const pkgUnits = c.pkgUnits || 0;
    const eqpUnits = c.eqpUnits || 0;

    setText('totalAvailableUnits', totalUnits.toLocaleString());
    setText('ingUnits', ingUnits.toLocaleString());
    setText('pkgUnits', pkgUnits.toLocaleString());
    setText('eqpUnits', eqpUnits.toLocaleString());

    const width = (n) => totalUnits > 0 ? `${Math.min(100, (n / totalUnits) * 100)}%` : '0%';
    const ing = document.getElementById('ingFill');
    const pkg = document.getElementById('pkgFill');
    const eqp = document.getElementById('eqpFill');
    if (ing) ing.style.width = width(ingUnits);
    if (pkg) pkg.style.width = width(pkgUnits);
    if (eqp) eqp.style.width = width(eqpUnits);
}

// Low stock attention callout (Punto 2: Direct safety buffer monitoring)
function renderAttentionCallout(count, items) {
    const n = Number(count) || 0;
    setText('attentionCountBottom', n);

    const detail = document.getElementById('attentionDetail');
    if (!detail) return;

    if (n === 0) {
        detail.textContent = 'All tracked materials and packaging are above safety reorder thresholds.';
        return;
    }

    const names = (items || []).map(i => i.name).filter(Boolean);
    const shown = names.join(', ');
    const more = n > names.length ? ` and ${n - names.length} more items` : '';
    detail.textContent = `${shown}${more} ${n === 1 ? 'is' : 'are'} at or below safety stock points.`;
}

// Submit purchase request (Punto 3: Hybrid supplier name captured)
async function handleAddRequestSubmit(e) {
    e.preventDefault();

    const itemName = document.getElementById('itemName').value.trim();
    const storeName = document.getElementById('storeName').value.trim();
    const qty = parseFloat(document.getElementById('requestQty').value || 1);
    const unitCost = parseFloat(document.getElementById('unitCost').value || 0);
    const totalCost = qty * unitCost;

    if (!itemName || !(totalCost > 0)) {
        MMSwal.fire({
            icon: 'warning',
            title: 'Incomplete Input',
            text: 'Please enter a valid item name, quantity, and unit cost.'
        });
        return;
    }

    const submitBtn = e.target.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;

    try {
        const result = await apiPost('/api/procurement-officer/add-request', {
            item_name: qty > 1 ? `${itemName} (${qty}x)` : itemName,
            store_name: storeName,
            amount: totalCost
        });

        closeModal('addRequestModal');
        e.target.reset();
        calculateModalThreshold();
        await fetchProcurementDashboardData();

        const route = result.request && result.request.route;
        let routeText = 'Direct purchase authorized for Procurement';
        if (route === 'finance') routeText = 'Escalated to Finance Officer';
        if (route === 'ceo') routeText = 'Escalated to the CEO';

        MMSwal.fire({
            icon: 'success',
            title: 'Requisition Submitted',
            text: `Requisition for "${itemName}" (₱${formatPeso(totalCost)}) saved.\n\nRouting: ${routeText}`
        });
    } catch (error) {
        MMSwal.fire({
            icon: 'warning',
            title: 'Submission Failed',
            text: error.message || 'Could not save purchase request.'
        });
    } finally {
        if (submitBtn) submitBtn.disabled = false;
    }
}

function openModal(id) {
    const modal = document.getElementById(id);
    if (modal) {
        modal.classList.add('open');
        document.body.style.overflow = 'hidden';
    }
}

function closeModal(id) {
    const modal = document.getElementById(id);
    if (modal) {
        modal.classList.remove('open');
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