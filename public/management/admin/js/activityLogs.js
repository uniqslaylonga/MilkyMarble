let currentPage = 1;
const PAGE_LIMIT = 25;
let searchDebounceTimer = null;

document.addEventListener('DOMContentLoaded', () => {
    fetchActivityLogs();

    document.getElementById('refreshLogsBtn')?.addEventListener('click', () => fetchActivityLogs());

    document.getElementById('categoryFilter')?.addEventListener('change', () => {
        currentPage = 1;
        fetchActivityLogs();
    });

    document.getElementById('dateFromFilter')?.addEventListener('change', () => {
        currentPage = 1;
        fetchActivityLogs();
    });

    document.getElementById('dateToFilter')?.addEventListener('change', () => {
        currentPage = 1;
        fetchActivityLogs();
    });

    document.getElementById('logSearchInput')?.addEventListener('input', () => {
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(() => {
            currentPage = 1;
            fetchActivityLogs();
        }, 350);
    });

    document.getElementById('clearFiltersBtn')?.addEventListener('click', () => {
        document.getElementById('categoryFilter').value = 'all';
        document.getElementById('dateFromFilter').value = '';
        document.getElementById('dateToFilter').value = '';
        document.getElementById('logSearchInput').value = '';
        currentPage = 1;
        fetchActivityLogs();
    });

    document.getElementById('prevPageBtn')?.addEventListener('click', () => {
        if (currentPage > 1) {
            currentPage -= 1;
            fetchActivityLogs();
        }
    });

    document.getElementById('nextPageBtn')?.addEventListener('click', () => {
        currentPage += 1;
        fetchActivityLogs();
    });

    loadAdminProfile();
});

// Reuses the same admin dashboard endpoint just to populate the topbar
// name/avatar consistently with the rest of the admin section.
async function loadAdminProfile() {
    try {
        const userId = localStorage.getItem('userId') || sessionStorage.getItem('userId');
        const headers = userId ? { 'x-user-id': userId } : {};
        const response = await fetch('/api/admin/dashboard', { headers });
        if (!response.ok) return;
        const data = await response.json();
        const nameEl = document.getElementById('userFullName');
        const avatarEl = document.getElementById('userAvatarImg');
        if (nameEl && data.user?.fullName) nameEl.textContent = data.user.fullName;
        if (avatarEl && data.user?.avatar) avatarEl.src = data.user.avatar;
    } catch (e) {
        // Non-critical — the page still works without the profile header.
    }
}

async function fetchActivityLogs() {
    const tbody = document.getElementById('logTableBody');
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 24px;">Loading activity logs...</td></tr>';

    try {
        const userId = localStorage.getItem('userId') || sessionStorage.getItem('userId');
        const headers = userId ? { 'x-user-id': userId } : {};

        const params = new URLSearchParams();
        params.set('page', currentPage);
        params.set('limit', PAGE_LIMIT);

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
        if (data.status !== 'success') throw new Error(data.message || 'Failed to load activity logs.');

        renderLogTable(data.logs || []);
        renderPagination(data.pagination);
    } catch (error) {
        console.error('Error fetching activity logs:', error);
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding: 24px; color:#c5221f;">${escapeHtml(error.message)}</td></tr>`;
    }
}

function renderLogTable(logs) {
    const tbody = document.getElementById('logTableBody');

    if (!logs.length) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 24px;">No activity found for the selected filters.</td></tr>';
        return;
    }

    tbody.innerHTML = logs.map(log => `
        <tr>
            <td class="log-timestamp">${formatTimestamp(log.createdAt)}</td>
            <td>
                <div class="log-actor">
                    <span class="log-actor-name">${escapeHtml(log.actorName || 'System')}</span>
                    <span class="log-actor-role">${escapeHtml(log.actorRole || log.actorType || '')}</span>
                </div>
            </td>
            <td>${categoryBadge(log.category)}</td>
            <td class="log-desc">${escapeHtml(log.description || '')}</td>
            <td class="log-target">${escapeHtml(log.targetLabel || log.targetType || '—')}</td>
        </tr>
    `).join('');
}

function renderPagination(pagination) {
    if (!pagination) return;
    const { page, total, totalPages, limit } = pagination;

    document.getElementById('statTotalEvents').textContent = Number(total || 0).toLocaleString();

    const startIdx = total === 0 ? 0 : (page - 1) * limit + 1;
    const endIdx = Math.min(page * limit, total);
    document.getElementById('statShowingRange').textContent = `${startIdx}–${endIdx}`;
    document.getElementById('statPageInfo').textContent = `${page} / ${totalPages}`;
    document.getElementById('paginationLabel').textContent = `Page ${page} of ${totalPages}`;

    document.getElementById('prevPageBtn').disabled = page <= 1;
    document.getElementById('nextPageBtn').disabled = page >= totalPages;
}

const CATEGORY_LABELS = {
    employee: 'Employee',
    customer: 'Customer',
    production: 'Production',
    settings: 'Settings',
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
    return d.toLocaleString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
}

function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}
