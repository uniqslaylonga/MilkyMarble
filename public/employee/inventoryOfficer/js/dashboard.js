let allRequests = [];
let filteredRequests = [];
let currentPrPage = 1;
const PR_PAGE_SIZE = 4;
let activeFilterRoute = 'all';

document.addEventListener('DOMContentLoaded', () => {
    fetchProcurementDashboardData();

    // 1. Live DOA threshold calculation in the modal
    const qtyInput = document.getElementById('requestQty');
    const unitCostInput = document.getElementById('unitCost');
    if (qtyInput && unitCostInput) {
        qtyInput.addEventListener('input', calculateModalThreshold);
        unitCostInput.addEventListener('input', calculateModalThreshold);
    }

    // 2. Add request form
    const addRequestForm = document.getElementById('addRequestForm');
    if (addRequestForm) {
        addRequestForm.addEventListener('submit', handleAddRequestSubmit);
    }

    // 3. Search bar
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
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
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

// POST JSON to the employee API (sends the x-user-id header via employeeFetch).
async function apiPost(url, body) {
    const opts = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    };
    const res = (typeof employeeFetch === 'function') ? await employeeFetch(url, opts) : await fetch(url, opts);
    let data = {};
    try { data = await res.json(); } catch (e) { /* not JSON */ }
    if (!res.ok || data.status === 'error') {
        throw new Error(data.message || ('Server responded with status ' + res.status));
    }
    return data;
}

function routeBadge(route) {
    if (route === 'ceo') return { cls: 'route-ceo', text: '🔴 CEO Clearance' };
    if (route === 'finance') return { cls: 'route-finance', text: '🟠 Finance Approval' };
    return { cls: 'route-procure', text: '🟢 Direct Buy' };
}

// ---------------------------------------------------------------------------
// Load everything from the server
// ---------------------------------------------------------------------------
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

        if (!response.ok) throw new Error(await EmployeeUI.errorMessage(response));

        const data = await response.json();

        // Profile
        const user = data.user || {};
        setText('userName', user.fullName || '');
        const welcome = document.getElementById('welcomeTitle');
        if (welcome) welcome.textContent = user.firstName ? `Glad to have you here, ${user.firstName}!` : 'Glad to have you here!';
        const userAvatarEl = document.getElementById('userAvatar');
        if (userAvatarEl && user.avatarSrc) userAvatarEl.src = user.avatarSrc;

        // KPI cards (all computed on the server)
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

    } catch (error) {
        console.error('Could not load live data from the server:', error);
        if (window.EmployeeUI) { EmployeeUI.showError(error); EmployeeUI.failTables(); }
    }
}

// Live DOA calculation in the Add Request modal
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
            badgeEl.textContent = '🟢 Direct Route: Procurement Officer (Direct Purchase Authorized)';
        } else if (total <= 500) {
            badgeEl.className = 'badge-route route-finance';
            badgeEl.textContent = '🟠 Escalation Route: Requires Financial Officer Clearance';
        } else {
            badgeEl.className = 'badge-route route-ceo';
            badgeEl.textContent = '🔴 Executive Route: Requires CEO Approval (High Capital Expense)';
        }
    }
}

// Filter requests (search + route tabs)
function applyRequestsFilter() {
    const searchVal = document.getElementById('procurementSearchInput')?.value.trim().toLowerCase() || '';

    filteredRequests = allRequests.filter(pr => {
        if (activeFilterRoute !== 'all' && pr.route !== activeFilterRoute) return false;

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

// Render purchase requests table with numbered pager
function renderPurchaseRequests() {
    const tbody = document.getElementById('purchaseRequestsList');
    const pageInfo = document.getElementById('prPageInfo');
    const prevBtn = document.getElementById('prevPrBtn');
    const nextBtn = document.getElementById('nextPrBtn');

    if (!tbody) return;

    if (filteredRequests.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="loading-state-text">No purchase requests to show.</td></tr>';
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
        const canDirectBuy = pr.route === 'procure' && pr.status !== 'PURCHASED';

        return `
            <tr>
                <td>
                    <strong style="color: var(--brown-soft); font-size: 13px;">${escapeHtml(pr.name)}</strong>
                    <div style="font-size: 11px; color: var(--text-muted);">${escapeHtml(pr.pr_code)}</div>
                </td>
                <td>
                    <div style="font-weight: 700; color: var(--text-dark);">${escapeHtml(pr.requester_name) || '—'}</div>
                    <div style="font-size: 11px; color: var(--text-muted);">${escapeHtml(pr.supplier) || '—'}</div>
                </td>
                <td><strong style="color: var(--brown-soft); font-family: var(--font-family-heading); font-size: 13.5px;">₱ ${price}</strong></td>
                <td>
                    <span class="badge-route ${badge.cls}">${badge.text}</span>
                    <div style="font-size: 10px; color: var(--text-muted); margin-top: 2px;">Status: <strong>${escapeHtml(pr.status)}</strong></div>
                </td>
                <td style="text-align: right;">
                    ${canDirectBuy ? `
                        <button type="button" class="btn-buy-instant" onclick="handleDirectBuy(${Number(pr.id)})">
                            <i class="fa-solid fa-check"></i> Buy
                        </button>
                    ` : `
                        <button type="button" class="btn-view-status" onclick="showRouteInfo(${Number(pr.id)})">
                            View Route
                        </button>
                    `}
                </td>
            </tr>
        `;
    }).join('');
}

function showRouteInfo(prId) {
    const pr = allRequests.find(r => r.id === prId);
    if (!pr) return;
    alert(`${pr.pr_code} (₱${formatPeso(pr.total_price)})\nRoute: ${routeBadge(pr.route).text}\nStatus: ${pr.status}`);
}

// Numbered pager: 1, 2, 3...
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

// Direct buy for requests of ₱300 or less - saved on the server
async function handleDirectBuy(prId) {
    const item = allRequests.find(r => r.id === prId);
    if (!item) return;

    if (!confirm(`Mark "${item.name}" (₱${formatPeso(item.total_price)}) as purchased? Requests of ₱300 or less are within your direct-buy authority.`)) return;

    try {
        await apiPost('/api/procurement-officer/mark-purchased', { expense_id: prId });
        await fetchProcurementDashboardData();
    } catch (error) {
        alert('Could not complete the purchase: ' + error.message);
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

// Suppliers (real vendors table)
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
                <div class="vendor-img-placeholder"><i class="fa-solid fa-truck-ramp-box"></i></div>
                <div>
                    <div class="vendor-name">${escapeHtml(vendor.vendor_name)}</div>
                    <div class="vendor-desc">${escapeHtml(vendor.category_desc) || '—'}</div>
                </div>
            </div>
            <span class="status-pill-vendor">${escapeHtml(vendor.status) || '—'}</span>
        </div>
    `).join('');
}

// Warehouse progress bars
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

// "N items deserve attention" callout - names come from the real low-stock list
function renderAttentionCallout(count, items) {
    const n = Number(count) || 0;
    setText('attentionCountBottom', n);

    const detail = document.getElementById('attentionDetail');
    if (!detail) return;

    if (n === 0) {
        detail.textContent = 'All tracked items are above their reorder points.';
        return;
    }

    const names = (items || []).map(i => i.name).filter(Boolean);
    const shown = names.join(', ');
    const more = n > names.length ? ` and ${n - names.length} more` : '';
    detail.textContent = `${shown}${more} ${n === 1 ? 'is' : 'are'} at or below the reorder point.`;
}

// Add a purchase request - saved on the server, then reloaded
async function handleAddRequestSubmit(e) {
    e.preventDefault();

    const itemName = document.getElementById('itemName').value.trim();
    const storeName = document.getElementById('storeName').value.trim();
    const qty = parseFloat(document.getElementById('requestQty').value || 1);
    const unitCost = parseFloat(document.getElementById('unitCost').value || 0);
    const totalCost = qty * unitCost;

    if (!itemName || !(totalCost > 0)) {
        alert('Please enter an item name, a quantity and a unit cost.');
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
        const routeText = route === 'ceo' ? 'Escalated to the CEO' : (route === 'finance' ? 'Endorsed to Finance' : 'Direct buy authorized');
        alert(`Requisition for "${itemName}" (₱${formatPeso(totalCost)}) saved.\nRouting: ${routeText}`);
    } catch (error) {
        alert('Could not save the requisition: ' + error.message);
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