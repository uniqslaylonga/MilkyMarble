let adminChartInstance = null;
let cachedDashboardData = null;

document.addEventListener('DOMContentLoaded', () => {
    Chart.defaults.font.family = "'Urbanist', sans-serif";
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
        if (!response.ok) throw new Error('Failed to load admin dashboard data');

        const data = await response.json();
        cachedDashboardData = data;

        // 1. Admin Profile Header & Welcome Banner Name
        const userFullNameEl = document.getElementById('userFullName');
        const greetingNameEl = document.getElementById('adminGreetingName');

        if (data.user && data.user.fullName) {
            if (userFullNameEl) userFullNameEl.textContent = data.user.fullName;
            if (greetingNameEl) greetingNameEl.textContent = data.user.fullName.split(' ')[0];
        } else {
            if (userFullNameEl) userFullNameEl.textContent = 'Angeline J. Ang';
            if (greetingNameEl) greetingNameEl.textContent = 'Angeline';
        }

        // 2. Overview KPIs
        document.getElementById('statCustomers').textContent = Number(data.stats?.totalCustomers || 0).toLocaleString();
        document.getElementById('statBatches').textContent = Number(data.stats?.totalBatches || 0).toLocaleString();
        document.getElementById('statActiveStaff').textContent = Number(data.stats?.totalActiveStaff || 0).toLocaleString();
        document.getElementById('statTotalStaffFooter').textContent = `${Number(data.stats?.totalStaff || 0).toLocaleString()} total staff registered`;

        // 3. Render Operations Chart
        initAdminOperationsChart();

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
    document.getElementById('statCustomers').textContent = '—';
    document.getElementById('statBatches').textContent = '—';
    document.getElementById('statActiveStaff').textContent = '—';
    document.getElementById('statTotalStaffFooter').textContent = 'Unable to load';

    const errorMsg = '<div class="loading-state-text" style="color:#c0392b;">Could not load data. Please refresh.</div>';
    const custEl = document.getElementById('recentCustomersList');
    if (custEl) custEl.innerHTML = errorMsg;
    const logsEl = document.getElementById('productionLogsList');
    if (logsEl) logsEl.innerHTML = errorMsg;
    const staffEl = document.getElementById('staffList');
    if (staffEl) staffEl.innerHTML = errorMsg;
}

// --------------------------------------------------------------------------
// OPERATIONS & ADOPTION VELOCITY CHART (CHART.JS)
// --------------------------------------------------------------------------
function initAdminOperationsChart() {
    const ctx = document.getElementById('adminOperationsChart')?.getContext('2d');
    if (!ctx) return;

    if (adminChartInstance) adminChartInstance.destroy();

    adminChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['Week -3', 'Week -2', 'Week -1', 'Active Week'],
            datasets: [
                {
                    label: 'New Customer Sign-ups',
                    data: [8, 14, 19, 31],
                    backgroundColor: '#F69299',
                    borderRadius: 6,
                    barThickness: 16
                },
                {
                    label: 'Production Batches Logged',
                    data: [1, 2, 3, 4],
                    backgroundColor: '#7C4F38',
                    borderRadius: 6,
                    barThickness: 16
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
            <svg class="user-avatar-svg" viewBox="0 0 36 36" fill="none">
                <circle cx="18" cy="18" r="18" fill="#F69299" />
                <circle cx="18" cy="14" r="5.5" fill="#FFFFFF" />
                <path d="M8.5 28.5C8.5 23.8 12.8 21.5 18 21.5C23.2 21.5 27.5 23.8 27.5 28.5" fill="#FFFFFF" />
            </svg>
            ${hasPhoto ? `<img src="${escapeHtml(avatarUrl)}" alt="" class="esc-avatar-photo" onerror="this.remove()">` : ''}
        </div>
    `;
}

function renderRecentCustomers(customers) {
    const container = document.getElementById('recentCustomersList');
    if (!container) return;

    if (!customers || customers.length === 0) {
        container.innerHTML = '<div class="loading-state-text">No customer records found.</div>';
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
                        <div class="esc-sub">${custCode} • ${escapeHtml(c.email || 'No email')}</div>
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
        container.innerHTML = '<div class="loading-state-text">No production logs logged.</div>';
        return;
    }

    container.innerHTML = logs.map(log => `
        <div class="entity-summary-card">
            <div class="esc-left">
                <div>
                    <div class="esc-title">${escapeHtml(log.flavor_name)}</div>
                    <div class="esc-sub">${escapeHtml(log.batch_code)} • ${Number(log.total_cups_produced || 0).toLocaleString()} cups</div>
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
        container.innerHTML = '<div class="loading-state-text">No staff records found.</div>';
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
                        <div class="esc-sub">${escapeHtml(staff.username)}</div>
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
        (s.username || '').toLowerCase().includes(query)
    );

    renderRecentCustomers(filteredCust);
    renderProductionLogs(filteredLogs);
    renderStaffList(filteredStaff);
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