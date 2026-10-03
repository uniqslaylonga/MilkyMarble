let adminChartInstance = null;
let cachedDashboardData = null;

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
    if (typeof Chart !== 'undefined') {
        Chart.defaults.font.family = "'Urbanist', sans-serif";
    }
    fetchAdminDashboardData();
    
    // Quick search filter for activity feeds
    document.getElementById('adminSearchInput')?.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase().trim();
        filterActivityFeeds(query);
    });
});

async function fetchAdminDashboardData() {
    try {
        const userId = localStorage.getItem('userId') || sessionStorage.getItem('userId');
        const headers = userId ? { 'x-user-id': userId } : {};

        const response = await fetch('/api/admin/dashboard', { headers });
        if (!response.ok) throw new Error('Failed to retrieve administrator overview');

        const data = await response.json();
        cachedDashboardData = data;

        // 1. Admin Profile Header & Welcome Greeting
        const userFullNameEl = document.getElementById('userFullName');
        const greetingNameEl = document.getElementById('adminGreetingName');
        const userAvatarEl = document.getElementById('userAvatar');

        const fullName = data.user?.fullName || 'Angeline J. Ang';
        if (userFullNameEl) userFullNameEl.textContent = fullName;
        if (greetingNameEl) greetingNameEl.textContent = fullName.split(' ')[0];
        if (userAvatarEl && data.user?.avatarSrc) userAvatarEl.src = data.user.avatarSrc;

        // 2. Overview KPIs
        const totalCustomers = Number(data.stats?.totalCustomers ?? 0);
        const totalBatches = Number(data.stats?.totalBatches ?? 0);
        const activeStaff = Number(data.stats?.totalActiveStaff ?? 0);
        const totalStaff = Number(data.stats?.totalStaff ?? 0);

        setText('statCustomers', totalCustomers.toLocaleString());
        setText('statBatches', totalBatches.toLocaleString());
        setText('statActiveStaff', activeStaff.toLocaleString());
        setText('statTotalStaffFooter', `${totalStaff} total staff registered`);

        // 3. Render Operations Chart
        initAdminOperationsChart(data.weeklyOperations || null);

        // 4. Render Triple Feeds
        renderRecentCustomers(data.recentCustomers || []);
        renderProductionLogs(data.productionLogs || []);
        renderStaffList(data.staffList || []);

    } catch (error) {
        console.error('Error loading admin dashboard:', error);
        showAdminDashboardError();
    }
}

function showAdminDashboardError() {
    setText('statCustomers', '—');
    setText('statBatches', '—');
    setText('statActiveStaff', '—');
    setText('statTotalStaffFooter', 'Unable to retrieve');

    const errorMsg = '<div class="loading-state-text" style="color:#C9302C;">Could not load data feed. Please refresh.</div>';
    const custEl = document.getElementById('recentCustomersList');
    if (custEl) custEl.innerHTML = errorMsg;
    const logsEl = document.getElementById('productionLogsList');
    if (logsEl) logsEl.innerHTML = errorMsg;
    const staffEl = document.getElementById('staffList');
    if (staffEl) staffEl.innerHTML = errorMsg;
}

// Operations Velocity Bar Chart (Adoption & Production Batches)
function initAdminOperationsChart(chartPayload) {
    const ctx = document.getElementById('adminOperationsChart')?.getContext('2d');
    if (!ctx) return;

    if (adminChartInstance) adminChartInstance.destroy();

    const labels = chartPayload?.labels || ['Week -3', 'Week -2', 'Week -1', 'Active Week'];
    const signupsData = chartPayload?.signups ?? [0, 0, 0, 0];
    const batchesData = chartPayload?.batches ?? [0, 0, 0, 0];

    adminChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                {
                    label: 'New Customer Sign-ups',
                    data: signupsData,
                    backgroundColor: '#F69299',
                    borderRadius: 6,
                    barThickness: 20
                },
                {
                    label: 'Production Batches Logged',
                    data: batchesData,
                    backgroundColor: '#7C4F38',
                    borderRadius: 6,
                    barThickness: 20
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { boxWidth: 12, font: { size: 11, weight: 700 }, color: '#7C4F38' }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: 'rgba(246, 146, 153, 0.15)' },
                    ticks: { font: { size: 10 }, color: '#7C4F38' }
                },
                x: {
                    grid: { display: false },
                    ticks: { font: { size: 11, weight: 700 }, color: '#7C4F38' }
                }
            }
        }
    });
}

function renderAvatar(avatarUrl) {
    const hasPhoto = !!(avatarUrl && typeof avatarUrl === 'string' && !avatarUrl.includes('account.png'));
    return `
        <div class="esc-avatar-sm">
            <img src="${hasPhoto ? escapeHtml(avatarUrl) : '/customer/images/account.png'}" alt="Avatar" class="esc-avatar-photo" onerror="this.src='/customer/images/account.png';">
        </div>
    `;
}

function renderRecentCustomers(customers) {
    const container = document.getElementById('recentCustomersList');
    if (!container) return;

    if (!customers || customers.length === 0) {
        container.innerHTML = '<div class="loading-state-text">No customer accounts registered yet.</div>';
        return;
    }

    container.innerHTML = customers.map(c => {
        const custCode = 'CUST-' + String(c.id).padStart(4, '0');

        return `
            <div class="entity-summary-card">
                <div class="esc-left">
                    ${renderAvatar(c.avatar)}
                    <div>
                        <div class="esc-title">${escapeHtml(c.full_name)}</div>
                        <div class="esc-sub">${custCode} &bull; ${escapeHtml(c.email || 'No email on file')}</div>
                    </div>
                </div>
                <div class="esc-right">
                    <span class="type-pill">Customer</span>
                </div>
            </div>
        `;
    }).join('');
}

function renderProductionLogs(logs) {
    const container = document.getElementById('productionLogsList');
    if (!container) return;

    if (!logs || logs.length === 0) {
        container.innerHTML = '<div class="loading-state-text">No recent macro batches logged.</div>';
        return;
    }

    container.innerHTML = logs.map(log => `
        <div class="entity-summary-card">
            <div class="esc-left">
                <div class="batch-icon-sq">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M2 20h20M5 20V8l7-5 7 5v12M9 20v-6h6v6" />
                    </svg>
                </div>
                <div>
                    <div class="esc-title">${escapeHtml(log.flavor_name)}</div>
                    <div class="esc-sub">${escapeHtml(log.batch_code)} &bull; ${Number(log.total_cups_produced || 0).toLocaleString()} cups</div>
                </div>
            </div>
            <div class="esc-right">
                <span class="status-indicator-box completed">Completed</span>
                <span class="esc-meta">Sup: ${escapeHtml(log.supervisor || 'Staff')}</span>
            </div>
        </div>
    `).join('');
}

function renderStaffList(staffList) {
    const container = document.getElementById('staffList');
    if (!container) return;

    if (!staffList || staffList.length === 0) {
        container.innerHTML = '<div class="loading-state-text">No staff accounts registered.</div>';
        return;
    }

    container.innerHTML = staffList.map(staff => {
        const isActive = staff.is_active === true || parseInt(staff.is_active || 0, 10) === 1;

        return `
            <div class="entity-summary-card">
                <div class="esc-left">
                    ${renderAvatar(staff.avatar)}
                    <div>
                        <div class="esc-title">${escapeHtml(staff.full_name)}</div>
                        <div class="esc-sub">${escapeHtml(staff.username || staff.email)}</div>
                    </div>
                </div>
                <div class="esc-right">
                    <span class="status-indicator-box ${isActive ? 'active' : 'inactive'}">
                        ${isActive ? 'Active' : 'Inactive'}
                    </span>
                    <span class="esc-meta">${escapeHtml(staff.role_name || staff.department || 'Staff')}</span>
                </div>
            </div>
        `;
    }).join('');
}

function filterActivityFeeds(query) {
    if (!cachedDashboardData) return;

    if (!query) {
        renderRecentCustomers(cachedDashboardData.recentCustomers);
        renderProductionLogs(cachedDashboardData.productionLogs);
        renderStaffList(cachedDashboardData.staffList);
        return;
    }

    const filteredCust = (cachedDashboardData.recentCustomers || []).filter(c => 
        (c.full_name || '').toLowerCase().includes(query) || 
        (c.email || '').toLowerCase().includes(query)
    );

    const filteredLogs = (cachedDashboardData.productionLogs || []).filter(l => 
        (l.flavor_name || '').toLowerCase().includes(query) || 
        (l.batch_code || '').toLowerCase().includes(query)
    );

    const filteredStaff = (cachedDashboardData.staffList || []).filter(s => 
        (s.full_name || '').toLowerCase().includes(query) || 
        (s.username || '').toLowerCase().includes(query) ||
        (s.role_name || '').toLowerCase().includes(query)
    );

    renderRecentCustomers(filteredCust);
    renderProductionLogs(filteredLogs);
    renderStaffList(filteredStaff);
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