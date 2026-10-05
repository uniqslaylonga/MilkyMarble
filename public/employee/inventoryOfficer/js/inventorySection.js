let activeCategory = 'all';
let allItems = [];
let filteredItems = [];
let currentInvPage = 1;
const INV_PAGE_SIZE = 6;

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
    fetchInventorySectionData();

    // Category Tabs
    document.getElementById('tabCatAll')?.addEventListener('click', function () { filterCategory('all', this); });
    document.getElementById('tabCatIngredients')?.addEventListener('click', function () { filterCategory('ingredients', this); });
    document.getElementById('tabCatPackaging')?.addEventListener('click', function () { filterCategory('packaging', this); });
    document.getElementById('tabCatEquipment')?.addEventListener('click', function () { filterCategory('equipment', this); });

    // Search and Status Filters
    document.getElementById('inventorySearchInput')?.addEventListener('input', applyInventoryFilters);
    document.getElementById('statusFilter')?.addEventListener('change', applyInventoryFilters);

    // Form Handlers
    document.getElementById('addStockForm')?.addEventListener('submit', handleAddStock);
    document.getElementById('adjustStockForm')?.addEventListener('submit', handleAdjustStock);

    // Pagination buttons
    document.getElementById('prevInvBtn')?.addEventListener('click', () => {
        if (currentInvPage > 1) {
            currentInvPage--;
            renderInventoryTable();
        }
    });

    document.getElementById('nextInvBtn')?.addEventListener('click', () => {
        const totalPages = Math.ceil(filteredItems.length / INV_PAGE_SIZE) || 1;
        if (currentInvPage < totalPages) {
            currentInvPage++;
            renderInventoryTable();
        }
    });
});

// The database stores 'raw_material' | 'packaging' | 'equipment'.
function categoryOf(item) {
    const t = String(item.item_type || '').toLowerCase();
    if (t === 'packaging') return 'packaging';
    if (t === 'equipment') return 'equipment';
    return 'ingredients';
}

function categoryTitle(item) {
    const c = categoryOf(item);
    return c === 'packaging' ? 'Packaging' : (c === 'equipment' ? 'Equipment' : 'Ingredients');
}

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

async function fetchInventorySectionData() {
    try {
        let response;
        if (typeof employeeFetch === 'function') {
            response = await employeeFetch('/api/procurement-officer/inventory-section');
        } else {
            const userId = localStorage.getItem('userId') || sessionStorage.getItem('userId');
            const headers = userId ? { 'x-user-id': userId } : {};
            response = await fetch('/api/procurement-officer/inventory-section', { headers });
        }

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.message || 'Server error ' + response.status);
        }

        const data = await response.json();

        // User Profile
        const userFullNameEl = document.getElementById('userFullName');
        if (userFullNameEl) userFullNameEl.textContent = (data.user && data.user.fullName) || 'Inventory Officer';
        const userAvatarEl = document.getElementById('userAvatar');
        if (userAvatarEl && data.user?.avatarSrc) userAvatarEl.src = data.user.avatarSrc;

        allItems = data.items || [];
        applyInventoryFilters();

    } catch (error) {
        console.error('Could not load inventory section data:', error);
        MMSwal.fire({
            icon: 'warning',
            title: 'System Notice',
            text: error.message || 'Failed to load inventory items.'
        });
    }
}

// Category and Search Filtering
function applyInventoryFilters() {
    const q = document.getElementById('inventorySearchInput')?.value.toLowerCase().trim() || '';
    const statusFilter = document.getElementById('statusFilter')?.value || '';

    filteredItems = allItems.filter(item => {
        if (activeCategory !== 'all' && categoryOf(item) !== activeCategory) return false;

        const onHand = parseFloat(item.on_hand || 0);
        const reorder = parseFloat(item.reorder_point || 0);
        const isLow = reorder > 0 && onHand <= reorder;

        if (statusFilter === 'low' && !isLow) return false;
        if (statusFilter === 'normal' && isLow) return false;

        if (q) {
            const name = (item.name || '').toLowerCase();
            const sku = (item.sku_code || '').toLowerCase();
            if (!name.includes(q) && !sku.includes(q)) return false;
        }

        return true;
    });

    // Real badge counts
    document.getElementById('totalCount').textContent = allItems.length;
    document.getElementById('ingCount').textContent = allItems.filter(i => categoryOf(i) === 'ingredients').length;
    document.getElementById('pkgCount').textContent = allItems.filter(i => categoryOf(i) === 'packaging').length;
    document.getElementById('eqpCount').textContent = allItems.filter(i => categoryOf(i) === 'equipment').length;
    document.getElementById('visibleCount').textContent = filteredItems.length;

    currentInvPage = 1;
    renderInventoryTable();
}

function filterCategory(cat, btn) {
    activeCategory = cat;
    document.querySelectorAll('.cat-tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    applyInventoryFilters();
}

// Render Inventory Table with Permanent Numbered Pager (Reserved Column Removed per Punto 2)
function renderInventoryTable() {
    const tbody = document.getElementById('inventoryTableBody');
    const pageInfo = document.getElementById('inventoryPageInfo');
    const prevBtn = document.getElementById('prevInvBtn');
    const nextBtn = document.getElementById('nextInvBtn');

    if (!tbody) return;

    if (filteredItems.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="loading-state-text">No inventory items found matching your criteria.</td></tr>';
        if (pageInfo) pageInfo.textContent = 'Showing 0 of 0 items';
        if (prevBtn) prevBtn.disabled = true;
        if (nextBtn) nextBtn.disabled = true;
        renderInvPagerButtons(1, 1);
        return;
    }

    const totalPages = Math.ceil(filteredItems.length / INV_PAGE_SIZE) || 1;
    const startIndex = (currentInvPage - 1) * INV_PAGE_SIZE;
    const pageItems = filteredItems.slice(startIndex, startIndex + INV_PAGE_SIZE);

    if (pageInfo) {
        const startNum = startIndex + 1;
        const endNum = Math.min(startIndex + INV_PAGE_SIZE, filteredItems.length);
        pageInfo.textContent = `Showing ${startNum}-${endNum} of ${filteredItems.length} items`;
    }
    if (prevBtn) prevBtn.disabled = currentInvPage <= 1;
    if (nextBtn) nextBtn.disabled = currentInvPage >= totalPages;

    renderInvPagerButtons(totalPages, currentInvPage);

    tbody.innerHTML = pageItems.map(item => {
        const unit = item.unit_of_measure || '';
        const onHand = parseFloat(item.on_hand || 0);
        const reorder = parseFloat(item.reorder_point || 0);
        const isLow = reorder > 0 && onHand <= reorder;

        const skuLine = item.sku_code
            ? `<div style="font-size: 11px; color: var(--text-muted);">${escapeHtml(item.sku_code)}</div>`
            : '';

        return `
            <tr>
                <td>
                    <strong style="color: var(--brown-soft); font-size: 13px;">${escapeHtml(item.name)}</strong>
                    ${skuLine}
                </td>
                <td><span style="font-weight: 700; color: var(--text-dark);">${escapeHtml(categoryTitle(item))}</span></td>
                <td>
                    <span class="avail-num ${isLow ? 'low-stock-num' : ''}">${onHand} ${escapeHtml(unit)}</span>
                    ${isLow ? '<span class="low-badge">Low Buffer</span>' : ''}
                </td>
                <td>
                    <span style="font-size: 12px; font-weight: 700; color: var(--text-muted);">
                        ${reorder} ${escapeHtml(unit)}
                    </span>
                </td>
                <td>
                    ${isLow ? `
                        <button type="button" class="btn-restock-trigger" onclick="quickRestockItem(${Number(item.id)})">
                            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5">
                                <circle cx="9" cy="21" r="1"></circle>
                                <circle cx="20" cy="21" r="1"></circle>
                                <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
                            </svg>
                            <span>Pitch Restock</span>
                        </button>
                    ` : `
                        <span style="font-size: 12px; color: var(--text-muted); font-weight: 700;">Adequate</span>
                    `}
                </td>
                <td style="text-align: right;">
                    <button type="button" class="btn-adjust-link" onclick="openAdjustStockById(${Number(item.id)})">
                        Adjust
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

// Numbered Pager
function renderInvPagerButtons(totalPages, activePage) {
    const pagerNumbers = document.getElementById('invPagerNumbers');
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
            if (page && page !== currentInvPage) {
                currentInvPage = page;
                renderInventoryTable();
            }
        });
    });
}

// Quick restock prompt using themed SweetAlert2
async function quickRestockItem(itemId) {
    const item = allItems.find(i => i.id === itemId);
    if (!item) return;

    const { value: amountStr } = await MMSwal.fire({
        title: `Pitch Restock: ${item.name}`,
        input: 'number',
        inputLabel: 'Estimated Total Cost (₱)',
        inputPlaceholder: 'Enter total estimated expense...',
        showCancelButton: true,
        confirmButtonText: 'Submit Restock Pitch',
        cancelButtonText: 'Cancel',
        inputValidator: (val) => {
            if (!val || parseFloat(val) <= 0) {
                return 'Please enter a valid amount greater than 0.';
            }
        }
    });

    if (!amountStr) return;
    const amount = parseFloat(amountStr);

    try {
        const result = await apiPost('/api/procurement-officer/add-request', {
            item_name: `Restock: ${item.name}`,
            store_name: '',
            amount
        });

        const route = result.request && result.request.route;
        let routeText = 'Direct purchase authorized for Procurement';
        if (route === 'finance') routeText = 'Escalated to Finance Officer';
        if (route === 'ceo') routeText = 'Escalated to the CEO';

        MMSwal.fire({
            icon: 'success',
            title: 'Restock Requisition Sent',
            text: `Restock requisition for "${item.name}" (₱${amount.toFixed(2)}) submitted.\n\nRouting: ${routeText}`
        });
    } catch (error) {
        MMSwal.fire({
            icon: 'warning',
            title: 'Requisition Failed',
            text: error.message || 'Could not submit restock request.'
        });
    }
}

// Add New Stock Item Submission
async function handleAddStock(e) {
    e.preventDefault();
    const name = document.getElementById('addName').value.trim();
    const department = document.getElementById('addDepartment').value;
    const quantity = parseFloat(document.getElementById('addQuantity').value);
    const unit = document.getElementById('addUnit').value;
    const reorder_level = parseFloat(document.getElementById('addReorderLevel').value);

    if (!name || isNaN(quantity) || isNaN(reorder_level)) {
        MMSwal.fire({
            icon: 'warning',
            title: 'Incomplete Input',
            text: 'Please fill out the item name, quantity, and reorder threshold.'
        });
        return;
    }

    const submitBtn = e.target.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;

    try {
        await apiPost('/api/procurement-officer/add-stock', { name, department, quantity, unit, reorder_level });
        closeModal('addStockModal');
        e.target.reset();
        await fetchInventorySectionData();

        MMSwal.fire({
            icon: 'success',
            title: 'Stock Registered',
            text: `"${name}" (${quantity} ${unit}) registered into inventory.`
        });
    } catch (error) {
        MMSwal.fire({
            icon: 'warning',
            title: 'Registration Failed',
            text: error.message || 'Could not add the stock item.'
        });
    } finally {
        if (submitBtn) submitBtn.disabled = false;
    }
}

function openAdjustStockById(itemId) {
    const item = allItems.find(i => i.id === itemId);
    if (!item) return;

    document.getElementById('adjustItemId').value = item.id;
    document.getElementById('deleteItemId').value = item.id;
    document.getElementById('adjustItemName').value = item.name || '';
    document.getElementById('adjustItemDept').value = categoryTitle(item);
    document.getElementById('adjustItemQty').value = item.on_hand;
    document.getElementById('adjustItemReorder').value = item.reorder_point;
    if (item.unit_of_measure) document.getElementById('adjustItemUnit').value = item.unit_of_measure;

    openModal('adjustStockModal');
}

// Adjust Stock Submission
async function handleAdjustStock(e) {
    e.preventDefault();
    const item_id = parseInt(document.getElementById('adjustItemId').value, 10);
    const name = document.getElementById('adjustItemName').value.trim();
    const department = document.getElementById('adjustItemDept').value;
    const quantity = parseFloat(document.getElementById('adjustItemQty').value);
    const reorder_level = parseFloat(document.getElementById('adjustItemReorder').value);
    const unit = document.getElementById('adjustItemUnit').value;

    if (!item_id || !name || isNaN(quantity)) {
        MMSwal.fire({
            icon: 'warning',
            title: 'Incomplete Input',
            text: 'Please fill out the item name and on-hand count.'
        });
        return;
    }

    const submitBtn = e.target.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;

    try {
        await apiPost('/api/procurement-officer/adjust-stock', { item_id, name, department, quantity, unit, reorder_level });
        closeModal('adjustStockModal');
        await fetchInventorySectionData();

        MMSwal.fire({
            icon: 'success',
            title: 'Stock Adjusted',
            text: `Updated on-hand count for "${name}" to ${quantity} ${unit}.`
        });
    } catch (error) {
        MMSwal.fire({
            icon: 'warning',
            title: 'Adjustment Failed',
            text: error.message || 'Could not save the adjustment.'
        });
    } finally {
        if (submitBtn) submitBtn.disabled = false;
    }
}

// Delete Stock Item with SweetAlert2 Confirmation
async function handleDeleteFromModal() {
    const item_id = parseInt(document.getElementById('deleteItemId').value, 10);
    const item = allItems.find(i => i.id === item_id);
    if (!item) return;

    const res = await MMSwal.fire({
        title: 'Delete Item from Inventory?',
        html: `Permanently remove <strong>"${escapeHtml(item.name)}"</strong> from central warehouse records?`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Yes, Delete',
        cancelButtonText: 'Cancel'
    });

    if (!res.isConfirmed) return;

    try {
        await apiPost('/api/procurement-officer/delete-stock', { item_id });
        closeModal('adjustStockModal');
        await fetchInventorySectionData();

        MMSwal.fire({
            icon: 'success',
            title: 'Item Deleted',
            text: `"${item.name}" was removed from inventory.`
        });
    } catch (error) {
        MMSwal.fire({
            icon: 'warning',
            title: 'Delete Failed',
            text: error.message || 'Could not remove the item.'
        });
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