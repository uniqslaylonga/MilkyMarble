let currentSettingsTab = 'controls'; // 'controls' o 'logs'

// 1. Store Controls State
const WEEKDAY_LABELS = [
  { day: 0, label: 'Sunday' },
  { day: 1, label: 'Monday' },
  { day: 2, label: 'Tuesday' },
  { day: 3, label: 'Wednesday' },
  { day: 4, label: 'Thursday' },
  { day: 5, label: 'Friday' },
  { day: 6, label: 'Saturday' }
];

let currentPickupDays = [2, 4]; // Default: Tuesday & Thursday
let currentCupQuota = 60;
let isEmergencyLocked = false;

// 2. Activity Logs State (Consolidated from activityLogs.js)
let currentLogPage = 1;
const LOG_PAGE_LIMIT = 10;
let searchDebounceTimer = null;
let allLogsData = [];
let totalLogEvents = 0;

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
    loadAdminProfile();
    loadStoreSettings();

    // Emergency Toggle Text Listener
    document.getElementById('emergencyLockToggle')?.addEventListener('change', (e) => {
        const textEl = document.getElementById('lockStatusText');
        if (textEl) {
            textEl.textContent = e.target.checked 
                ? 'Store Checkout Suspended (Locked)' 
                : 'Store Accepting Orders (Unlocked)';
            textEl.style.color = e.target.checked ? '#C9302C' : 'var(--brown-soft)';
        }
    });

    // Activity Logs Event Listeners
    document.getElementById('refreshLogsBtn')?.addEventListener('click', () => {
        currentLogPage = 1;
        fetchActivityLogs();
    });

    document.getElementById('categoryFilter')?.addEventListener('change', () => {
        currentLogPage = 1;
        fetchActivityLogs();
    });

    document.getElementById('dateFromFilter')?.addEventListener('change', () => {
        currentLogPage = 1;
        fetchActivityLogs();
    });

    document.getElementById('dateToFilter')?.addEventListener('change', () => {
        currentLogPage = 1;
        fetchActivityLogs();
    });

    document.getElementById('logSearchInput')?.addEventListener('input', () => {
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(() => {
            currentLogPage = 1;
            fetchActivityLogs();
        }, 350);
    });

    document.getElementById('clearFiltersBtn')?.addEventListener('click', () => {
        document.getElementById('categoryFilter').value = 'all';
        document.getElementById('dateFromFilter').value = '';
        document.getElementById('dateToFilter').value = '';
        document.getElementById('logSearchInput').value = '';
        currentLogPage = 1;
        fetchActivityLogs();
    });

    document.getElementById('prevPageBtn')?.addEventListener('click', () => {
        if (currentLogPage > 1) {
            currentLogPage -= 1;
            fetchActivityLogs();
        }
    });

    document.getElementById('nextPageBtn')?.addEventListener('click', () => {
        currentLogPage += 1;
        fetchActivityLogs();
    });
});

// Workspace Tab Switcher (Controls vs Logs)
function switchSettingsTab(tab) {
    currentSettingsTab = tab;
    const btnControls = document.getElementById('tabBtnControls');
    const btnLogs = document.getElementById('tabBtnLogs');
    const viewControls = document.getElementById('storeControlsView');
    const viewLogs = document.getElementById('activityLogsView');

    if (tab === 'controls') {
        btnControls?.classList.add('active');
        btnLogs?.classList.remove('active');
        if (viewControls) viewControls.style.display = 'block';
        if (viewLogs) viewLogs.style.display = 'none';
    } else {
        btnLogs?.classList.add('active');
        btnControls?.classList.remove('active');
        if (viewControls) viewControls.style.display = 'none';
        if (viewLogs) viewLogs.style.display = 'block';

        // Load logs on first switch
        fetchActivityLogs();
    }
}

// Admin Profile Header
async function loadAdminProfile() {
    try {
        const userId = localStorage.getItem('userId') || sessionStorage.getItem('userId');
        const headers = userId ? { 'x-user-id': userId } : {};
        const res = await fetch('/api/admin/dashboard', { headers });
        if (!res.ok) return;
        const data = await res.json();

        const nameEl = document.getElementById('userFullName');
        const avatarEl = document.getElementById('userAvatarImg');
        if (nameEl && data.user?.fullName) nameEl.textContent = data.user.fullName;
        if (avatarEl && data.user?.avatar) avatarEl.src = data.user.avatar;
    } catch (err) {
        // Silent non-critical fallback
    }
}

// --------------------------------------------------------------------------
// 1. STORE CONTROLS & CAPACITY QUOTA ENGINE
// --------------------------------------------------------------------------
async function loadStoreSettings() {
    try {
        const res = await fetch('/api/admin/settings/pickup-days');
        const data = await res.json();

        if (data.status === 'success') {
            if (Array.isArray(data.days)) currentPickupDays = data.days;
            if (data.cupQuota) {
                currentCupQuota = data.cupQuota;
                document.getElementById('maxCupQuotaInput').value = currentCupQuota;
            }
            if (data.emergencyLocked !== undefined) {
                isEmergencyLocked = Boolean(data.emergencyLocked);
                const lockToggle = document.getElementById('emergencyLockToggle');
                if (lockToggle) lockToggle.checked = isEmergencyLocked;
            }
        }
    } catch (err) {
        console.warn('Using default store settings fallback:', err);
    }

    renderPickupDaysGrid();
}

function renderPickupDaysGrid() {
    const grid = document.getElementById('pickupDaysGrid');
    if (!grid) return;

    grid.innerHTML = WEEKDAY_LABELS.map(({ day, label }) => {
        const isActive = currentPickupDays.includes(day);
        return `
            <label class="pickup-day-toggle ${isActive ? 'active' : ''}" data-day="${day}">
                <input type="checkbox" value="${day}" ${isActive ? 'checked' : ''} onchange="onDayToggle(this)">
                <span class="pickup-day-label">${label}</span>
            </label>
        `;
    }).join('');
}

window.onDayToggle = function(checkbox) {
    const wrapper = checkbox.closest('.pickup-day-toggle');
    if (wrapper) wrapper.classList.toggle('active', checkbox.checked);
};

// Save All Store Settings with SweetAlert2
async function handleSaveStoreSettings(e) {
    e.preventDefault();

    const grid = document.getElementById('pickupDaysGrid');
    const selectedDays = Array.from(grid.querySelectorAll('input[type="checkbox"]:checked'))
        .map(cb => parseInt(cb.value, 10));

    if (selectedDays.length === 0) {
        MMSwal.fire({
            icon: 'warning',
            title: 'Schedule Incomplete',
            text: 'Please select at least one active pick-up release day.'
        });
        return;
    }

    const quotaVal = parseInt(document.getElementById('maxCupQuotaInput')?.value, 10);
    const startTime = document.getElementById('claimStartTime')?.value || '10:00';
    const endTime = document.getElementById('claimEndTime')?.value || '15:00';
    const emergencyLocked = document.getElementById('emergencyLockToggle')?.checked || false;

    const saveBtn = document.getElementById('saveAllSettingsBtn');
    if (saveBtn) saveBtn.disabled = true;

    try {
        const payload = {
            days: selectedDays,
            cupQuota: quotaVal,
            claimWindow: `${startTime} – ${endTime}`,
            emergencyLocked: emergencyLocked
        };

        const res = await fetch('/api/admin/settings/pickup-days', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (data.status === 'success') {
            currentPickupDays = selectedDays;
            currentCupQuota = quotaVal;

            MMSwal.fire({
                icon: 'success',
                title: 'Configuration Saved',
                html: `
                    <div style="text-align: left; font-size: 13px; line-height: 1.6;">
                        <strong>Active Claim Days:</strong> ${selectedDays.map(d => WEEKDAY_LABELS.find(w => w.day === d)?.label).join(', ')}<br>
                        <strong>Release Cup Quota:</strong> ${quotaVal} cups / date limit<br>
                        <strong>Claim Hours:</strong> ${startTime} to ${endTime}<br>
                        <strong>Store State:</strong> ${emergencyLocked ? 'Suspended (Maintenance)' : 'Active (Accepting Orders)'}
                    </div>
                `
            });
        } else {
            throw new Error(data.message || 'Could not persist settings');
        }
    } catch (err) {
        MMSwal.fire({
            icon: 'warning',
            title: 'Update Error',
            text: err.message || 'Failed to communicate with store settings service.'
        });
    } finally {
        if (saveBtn) saveBtn.disabled = false;
    }
}

// --------------------------------------------------------------------------
// 2. SECURITY & ACTIVITY LOGS (CONSOLIDATED)
// --------------------------------------------------------------------------
async function fetchActivityLogs() {
    const tbody = document.getElementById('logTableBody');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="5" class="loading-state-text">Compiling activity audit trail...</td></tr>';

    try {
        const userId = localStorage.getItem('userId') || sessionStorage.getItem('userId');
        const headers = userId ? { 'x-user-id': userId } : {};

        const params = new URLSearchParams();
        params.set('page', currentLogPage);
        params.set('limit', LOG_PAGE_LIMIT);

        const category = document.getElementById('categoryFilter')?.value;
        if (category && category !== 'all') params.set('category', category);

        const dateFrom = document.getElementById('dateFromFilter')?.value;
        if (dateFrom) params.set('date_from', dateFrom);

        const dateTo = document.getElementById('dateToFilter')?.value;
        if (dateTo) params.set('date_to', dateTo);

        const q = document.getElementById('logSearchInput')?.value.trim();
        if (q) params.set('q', q);

        const response = await fetch(`/api/admin/activity-logs?${params.toString()}`, { headers });
        if (!response.ok) throw new Error('Failed to load activity logs.');

        const data = await response.json();
        if (data.status !== 'success') throw new Error(data.message || 'Server error.');

        allLogsData = data.logs || [];
        totalLogEvents = data.pagination?.total || allLogsData.length;

        renderLogTable(allLogsData);
        renderLogPagination(data.pagination);

    } catch (error) {
        console.error('Error loading activity logs:', error);
        tbody.innerHTML = `<tr><td colspan="5" class="loading-state-text" style="color:#C9302C;">${escapeHtml(error.message)}</td></tr>`;
    }
}

function renderLogTable(logs) {
    const tbody = document.getElementById('logTableBody');
    if (!tbody) return;

    if (!logs.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="loading-state-text">No activity events found matching the selected filters.</td></tr>';
        return;
    }

    tbody.innerHTML = logs.map(log => `
        <tr>
            <td class="log-timestamp">${formatTimestamp(log.createdAt || log.created_at)}</td>
            <td>
                <div class="log-actor">
                    <span class="log-actor-name">${escapeHtml(log.actorName || log.actor_name || 'System')}</span>
                    <span class="log-actor-role">${escapeHtml(log.actorRole || log.actor_role || 'Admin')}</span>
                </div>
            </td>
            <td>${categoryBadge(log.category)}</td>
            <td class="log-desc">${escapeHtml(log.description || '')}</td>
            <td class="log-target">${escapeHtml(log.targetLabel || log.target_label || 'Master System')}</td>
        </tr>
    `).join('');
}

function renderLogPagination(pagination) {
    if (!pagination) return;
    const { page, total, totalPages, limit } = pagination;

    setText('statTotalEvents', Number(total || 0).toLocaleString());
    setText('statTotalEventsBadge', Number(total || 0).toLocaleString());

    const startIdx = total === 0 ? 0 : (page - 1) * limit + 1;
    const endIdx = Math.min(page * limit, total);
    setText('statShowingRange', `${startIdx}–${endIdx}`);
    setText('statPageInfo', `${page} / ${totalPages || 1}`);

    const pageInfo = document.getElementById('logPageInfo');
    if (pageInfo) pageInfo.textContent = `Showing ${startIdx}-${endIdx} of ${total} events`;

    const prevBtn = document.getElementById('prevPageBtn');
    const nextBtn = document.getElementById('nextPageBtn');
    if (prevBtn) prevBtn.disabled = page <= 1;
    if (nextBtn) nextBtn.disabled = page >= totalPages;

    renderLogPagerButtons(totalPages || 1, page);
}

function renderLogPagerButtons(totalPages, activePage) {
    const pagerNumbers = document.getElementById('logPagerNumbers');
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
            if (page && page !== currentLogPage) {
                currentLogPage = page;
                fetchActivityLogs();
            }
        });
    });
}

const CATEGORY_LABELS = {
    employee: 'Employee',
    customer: 'Customer',
    production: 'Production',
    settings: 'Settings & Quota',
    auth: 'Login & Security'
};

function categoryBadge(category) {
    const key = (category || 'other').toLowerCase();
    const cls = CATEGORY_LABELS[key] ? `cat-${key}` : 'cat-other';
    const label = CATEGORY_LABELS[key] || (category || 'Other');
    return `<span class="cat-badge ${cls}">${escapeHtml(label)}</span>`;
}

function formatTimestamp(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('en-US', {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
}

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}