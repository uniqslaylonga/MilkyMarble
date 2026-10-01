let allCustomers = [];
let filteredCustomers = [];
let currentCustPage = 1;
const CUST_PAGE_SIZE = 5;

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
    fetchCustomerRecordData();

    // Real-time search filter
    document.getElementById('customerSearchInput')?.addEventListener('input', applyCustomerFilters);

    // Modal background click handler
    document.getElementById('profileModalOverlay')?.addEventListener('click', (e) => {
        if (e.target.id === 'profileModalOverlay') closeModal();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeModal();
    });

    // Pagination buttons
    document.getElementById('prevCustBtn')?.addEventListener('click', () => {
        if (currentCustPage > 1) {
            currentCustPage--;
            renderCustomerTable();
        }
    });

    document.getElementById('nextCustBtn')?.addEventListener('click', () => {
        const totalPages = Math.ceil(filteredCustomers.length / CUST_PAGE_SIZE) || 1;
        if (currentCustPage < totalPages) {
            currentCustPage++;
            renderCustomerTable();
        }
    });
});

async function fetchCustomerRecordData() {
    try {
        const userId = localStorage.getItem('userId') || sessionStorage.getItem('userId');
        const headers = userId ? { 'x-user-id': userId } : {};

        const response = await fetch('/api/admin/customer-records', { headers });
        if (!response.ok) throw new Error('Failed to retrieve customer records');

        const data = await response.json();

        // User profile setup
        const userFullNameEl = document.getElementById('userFullName');
        const userAvatarEl = document.getElementById('userAvatarImg');

        if (userFullNameEl) userFullNameEl.textContent = data.user?.fullName || 'Angeline J. Ang';
        if (userAvatarEl && data.user?.avatar) {
            userAvatarEl.src = data.user.avatar;
            userAvatarEl.onerror = function() { this.src = '/customer/images/account.png'; };
        }

        // Stats Setup
        document.getElementById('totalAccounts').textContent = Number(data.stats?.totalAccounts || 0).toLocaleString();
        document.getElementById('corporateCount').textContent = Number(data.stats?.corporateCount || 0).toLocaleString();
        document.getElementById('repeatRate').textContent = `${Number(data.stats?.repeatRate || 0).toFixed(1)}%`;

        allCustomers = data.customers || [];
        applyCustomerFilters();

    } catch (error) {
        console.error('Error fetching customer record data:', error);
        MMSwal.fire({
            icon: 'warning',
            title: 'System Notice',
            text: error.message || 'Could not load customer accounts from server.'
        });
    }
}

function applyCustomerFilters() {
    const q = document.getElementById('customerSearchInput')?.value.toLowerCase().trim() || '';

    filteredCustomers = allCustomers.filter(c => {
        if (q) {
            const memberYear = c.member_since ? new Date(c.member_since).getFullYear() : new Date().getFullYear();
            const custCode = `cust-${memberYear}-${String(c.customer_id).padStart(4, '0')}`.toLowerCase();
            const name = (c.full_name || '').toLowerCase();
            const email = (c.email || '').toLowerCase();
            const phone = (c.phone || '').toLowerCase();

            if (!name.includes(q) && !email.includes(q) && !custCode.includes(q) && !phone.includes(q)) {
                return false;
            }
        }
        return true;
    });

    const countEl = document.getElementById('visibleCustomerCount');
    if (countEl) countEl.textContent = filteredCustomers.length;

    currentCustPage = 1;
    renderCustomerTable();
}

function renderCustomerTable() {
    const tbody = document.getElementById('customerTableBody');
    const pageInfo = document.getElementById('custPageInfo');
    const prevBtn = document.getElementById('prevCustBtn');
    const nextBtn = document.getElementById('nextCustBtn');

    if (!tbody) return;

    if (filteredCustomers.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="loading-state-text">No customer records found matching your search.</td></tr>';
        if (pageInfo) pageInfo.textContent = 'Showing 0 of 0 customers';
        if (prevBtn) prevBtn.disabled = true;
        if (nextBtn) nextBtn.disabled = true;
        renderCustPagerButtons(1, 1);
        return;
    }

    const totalPages = Math.ceil(filteredCustomers.length / CUST_PAGE_SIZE) || 1;
    const startIndex = (currentCustPage - 1) * CUST_PAGE_SIZE;
    const pageItems = filteredCustomers.slice(startIndex, startIndex + CUST_PAGE_SIZE);

    if (pageInfo) {
        const startNum = startIndex + 1;
        const endNum = Math.min(startIndex + CUST_PAGE_SIZE, filteredCustomers.length);
        pageInfo.textContent = `Showing ${startNum}-${endNum} of ${filteredCustomers.length} customers`;
    }
    if (prevBtn) prevBtn.disabled = currentCustPage <= 1;
    if (nextBtn) nextBtn.disabled = currentCustPage >= totalPages;

    renderCustPagerButtons(totalPages, currentCustPage);

    tbody.innerHTML = pageItems.map(c => {
        const memberYear = c.member_since ? new Date(c.member_since).getFullYear() : new Date().getFullYear();
        const custCode = `CUST-${memberYear}-${String(c.customer_id).padStart(4, '0')}`;
        const totalSpend = Number(c.total_spend || 0).toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
        const spendDisplay = `₱${totalSpend}`;
        const phoneDisplay = c.phone || 'No Phone Number';
        const avatarImg = (c.avatar && c.avatar !== '/customer/images/account.png') ? c.avatar : '/customer/images/account.png';
        const isActive = parseInt(c.is_active || 1, 10) === 1;

        const fullNameEscaped = escapeHtml(c.full_name);
        const phoneEscaped = escapeHtml(phoneDisplay);
        const emailEscaped = escapeHtml(c.email || 'No email on file');
        const avatarEscaped = escapeHtml(avatarImg);
        const statusLabel = isActive ? 'Active' : 'Inactive';

        return `
            <tr>
                <td>
                    <div class="cust-cell">
                        <div class="cust-avatar-sm">
                            <img src="${avatarEscaped}" alt="${fullNameEscaped}" class="cust-avatar-img" onerror="this.onerror=null; this.src='/customer/images/account.png';">
                        </div>
                        <div>
                            <div class="cust-name-text">${fullNameEscaped}</div>
                            <div class="cust-id-sub">${escapeHtml(custCode)}</div>
                        </div>
                    </div>
                </td>
                <td>
                    <div class="contact-text">${emailEscaped}</div>
                    <div class="phone-sub">${phoneEscaped}</div>
                </td>
                <td>
                    <strong class="spent-val">${spendDisplay}</strong>
                    <div class="orders-sub">${Number(c.total_orders || 0)} orders completed</div>
                </td>
                <td>
                    <select class="status-dropdown ${isActive ? 'status-active' : 'status-inactive'}"
                        onchange="toggleCustomerStatus(${c.customer_id}, this)">
                        <option value="1" ${isActive ? 'selected' : ''}>Active</option>
                        <option value="0" ${!isActive ? 'selected' : ''}>Inactive</option>
                    </select>
                </td>
                <td style="text-align: right;">
                    <button type="button" class="view-profile-btn" onclick="openModal(
                        '${escapeHtml(custCode)}', 
                        '${fullNameEscaped}', 
                        '${phoneEscaped}', 
                        '${emailEscaped}', 
                        '${c.total_orders || 0} orders', 
                        '${spendDisplay}', 
                        '${avatarEscaped}',
                        '${statusLabel}'
                    )">View Profile</button>
                </td>
            </tr>
        `;
    }).join('');
}

function renderCustPagerButtons(totalPages, activePage) {
    const pagerNumbers = document.getElementById('custPagerNumbers');
    if (!pagerNumbers) return;

    const maxVisiblePages = 5;
    const firstVisiblePage = Math.floor((activePage - 1) / maxVisiblePages) * maxVisiblePages + 1;
    const lastVisiblePage = Math.min(firstVisiblePage + maxVisiblePages - 1, totalPages);

    let html = '';
    for (let i = firstVisiblePage; i <= lastVisiblePage; i++) {
        const isActive = i === activePage ? 'active' : '';
        html += `<button type="button" class="pager-num-btn ${isActive}" data-page="${i}">${i}</button>`;
    }
    pagerNumbers.innerHTML = html;

    pagerNumbers.querySelectorAll('.pager-num-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const page = parseInt(e.currentTarget.getAttribute('data-page'), 10);
            if (page && page !== currentCustPage) {
                currentCustPage = page;
                renderCustomerTable();
            }
        });
    });
}

async function toggleCustomerStatus(custId, selectElement) {
    const isActive = selectElement.value;
    selectElement.className = 'status-dropdown ' + (isActive === '1' ? 'status-active' : 'status-inactive');

    try {
        const response = await fetch('/api/admin/customer-records/status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: custId, is_active: parseInt(isActive, 10) })
        });

        const data = await response.json();
        if (!data.success) {
            MMSwal.fire({
                icon: 'warning',
                title: 'Status Update Failed',
                text: data.error || 'Could not update customer status.'
            });
        }
    } catch (error) {
        console.error('Network error updating status:', error);
        MMSwal.fire({
            icon: 'warning',
            title: 'Network Error',
            text: 'Failed to update customer status on server.'
        });
    }
}

function openModal(id, name, phone, email, orders, spend, avatar, status) {
    document.getElementById('mCustId').textContent = id;
    document.getElementById('mModalFullName').textContent = name;
    document.getElementById('mPhone').textContent = phone;
    document.getElementById('mEmail').textContent = email;
    document.getElementById('mPastOrders').textContent = orders;
    document.getElementById('mTotalSpend').textContent = spend;
    
    const modalImg = document.getElementById('mAvatarImg');
    modalImg.src = avatar || '/customer/images/account.png';
    modalImg.onerror = function() { this.src = '/customer/images/account.png'; };
    
    document.getElementById('mStatus').textContent = status || 'Active';

    const modal = document.getElementById('profileModalOverlay');
    if (modal) {
        modal.classList.add('open');
        document.body.style.overflow = 'hidden';
    }
}

function closeModal() {
    const modal = document.getElementById('profileModalOverlay');
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