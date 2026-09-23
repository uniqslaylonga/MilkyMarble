document.addEventListener('DOMContentLoaded', () => {
    fetchCustomerRecordData();

    // Real-time table search filtering
    const searchInput = document.getElementById('customerSearchInput');
    if (searchInput) {
        searchInput.addEventListener('input', function() {
            const q = this.value.toLowerCase().trim();
            const rows = document.querySelectorAll('#customerTableBody tr');
            rows.forEach(row => {
                const text = row.textContent.toLowerCase();
                row.style.display = (!q || text.includes(q)) ? '' : 'none';
            });
        });
    }

    // Modal background click handler
    const modalOverlay = document.getElementById('profileModalOverlay');
    if (modalOverlay) {
        modalOverlay.addEventListener('click', (e) => {
            if (e.target.id === 'profileModalOverlay') {
                closeModal();
            }
        });
    }

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeModal();
    });
});

async function fetchCustomerRecordData() {
    try {
        // Grab logged-in user ID to fetch accurate profile details
        const userId = localStorage.getItem('userId');
        const headers = userId ? { 'x-user-id': userId } : {};

        const response = await fetch('/api/admin/customer-records', { headers });
        if (!response.ok) throw new Error('Failed to load customer records');

        const data = await response.json();

        // User profile setup
        const userFullNameEl = document.getElementById('userFullName');
        const userAvatarEl = document.getElementById('userAvatarImg');

        if (userFullNameEl) userFullNameEl.textContent = data.user.fullName;
        if (userAvatarEl && data.user.avatar) userAvatarEl.src = data.user.avatar;

        // Stats Setup
        document.getElementById('totalAccounts').textContent = Number(data.stats.totalAccounts || 0).toLocaleString();
        document.getElementById('corporateCount').textContent = Number(data.stats.corporateCount || 0).toLocaleString();
        document.getElementById('repeatRate').textContent = `${Number(data.stats.repeatRate || 0).toFixed(1)}%`;

        // Render Customers Table
        renderCustomerTable(data.customers);

    } catch (error) {
        console.error('Error fetching customer record data:', error);
        const tbody = document.getElementById('customerTableBody');
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: red; padding: 20px;">Failed to load customer records.</td></tr>';
        }
    }
}

function renderCustomerTable(customers) {
    const tbody = document.getElementById('customerTableBody');
    if (!tbody) return;

    if (!customers || customers.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 20px;">No customer records found.</td></tr>';
        return;
    }

    tbody.innerHTML = customers.map(c => {
        const memberYear = c.member_since ? new Date(c.member_since).getFullYear() : new Date().getFullYear();
        const custCode = `CUST-${memberYear}-${String(c.customer_id).padStart(4, '0')}`;
        const totalSpend = Number(c.total_spend || 0).toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
        const spendDisplay = `₱${totalSpend}`;
        const phoneDisplay = c.phone || 'No Phone Number';
        const avatarImg = (c.avatar && c.avatar !== '//customer/images/account.png') ? c.avatar : '/customer/images/account.png';
        const isActive = parseInt(c.is_active || 1, 10) === 1;

        const fullNameEscaped = escapeHtml(c.full_name);
        const phoneEscaped = escapeHtml(phoneDisplay);
        const emailEscaped = escapeHtml(c.email);
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
                </td>
                <td>
                    <div class="spent-val">${spendDisplay}</div>
                </td>
                <td>
                    <select class="status-dropdown ${isActive ? 'status-active' : 'status-inactive'}"
                        onchange="toggleCustomerStatus(${c.customer_id}, this)">
                        <option value="1" ${isActive ? 'selected' : ''}>Active</option>
                        <option value="0" ${!isActive ? 'selected' : ''}>Inactive</option>
                    </select>
                </td>
                <td>
                    <button class="view-profile-btn" onclick="openModal(
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
            alert('Failed to update customer status: ' + (data.error || 'Unknown error'));
        }
    } catch (error) {
        console.error('Network error updating status:', error);
        alert('Network error updating status.');
    }
}

function openModal(id, name, phone, email, orders, spend, avatar, status) {
    document.getElementById('mCustId').textContent = id;
    document.getElementById('mModalFullName').textContent = name;
    document.getElementById('mPhone').textContent = phone;
    document.getElementById('mEmail').textContent = email;
    document.getElementById('mPastOrders').textContent = orders;
    document.getElementById('mTotalSpend').textContent = spend;
    
    // Set up modal image with fallback
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