let allCustomers = [];
let filteredCustomers = [];
let currentPage = 1;
const PAGE_SIZE = 6;

let acquisitionMetrics = {
    today: 0,
    week: 0,
    month: 0,
    last3Months: 0,
    last6Months: 0
};

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

document.addEventListener('DOMContentLoaded', async () => {
    bindEventListeners();
    await loadCustomerData();
});

function bindEventListeners() {
    const sortSelect = document.getElementById('customerSortSelect');
    if (sortSelect) sortSelect.addEventListener('change', applyFiltersAndSort);

    const dateFilter = document.getElementById('customerDateFilter');
    const customDateInput = document.getElementById('customerCustomDate');
    if (dateFilter) {
        dateFilter.addEventListener('change', (e) => {
            if (e.target.value === 'custom') {
                customDateInput.style.display = 'inline-block';
                if (!customDateInput.value) customDateInput.value = SalesCommon.localDate(new Date());
            } else {
                customDateInput.style.display = 'none';
            }
            applyFiltersAndSort();
        });
    }

    if (customDateInput) customDateInput.addEventListener('change', applyFiltersAndSort);

    const acqSelect = document.getElementById('acquisitionPeriodSelect');
    if (acqSelect) acqSelect.addEventListener('change', updateAcquisitionPanel);

    const prevBtn = document.getElementById('prevCustomerBtn');
    const nextBtn = document.getElementById('nextCustomerBtn');

    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            if (currentPage > 1) {
                currentPage--;
                renderTable();
            }
        });
    }

    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            const totalPages = Math.ceil(filteredCustomers.length / PAGE_SIZE) || 1;
            if (currentPage < totalPages) {
                currentPage++;
                renderTable();
            }
        });
    }

    const modalClose = document.getElementById('modalCloseBtn');
    const modalOverlay = document.getElementById('profileModalOverlay');
    if (modalClose) modalClose.addEventListener('click', closeProfileModal);
    if (modalOverlay) {
        modalOverlay.addEventListener('click', (e) => {
            if (e.target === modalOverlay) closeProfileModal();
        });
    }
}

async function loadCustomerData() {
    try {
        const userId = localStorage.getItem('userId') || sessionStorage.getItem('userId');
        const headers = {};
        if (userId) headers['x-user-id'] = userId;

        const response = await fetch('/api/sales-officer/customer-records', { headers });
        if (!response.ok) throw new Error(await SalesCommon.errorMessage(response));

        const data = await response.json();

        // Topbar Employee Header
        if (data.user) {
            const userNameEl = document.getElementById('userName');
            const userAvatarEl = document.getElementById('userAvatar');
            if (userNameEl) userNameEl.textContent = data.user.fullName || 'Sales Officer';
            if (userAvatarEl && data.user.avatarSrc) userAvatarEl.src = data.user.avatarSrc;
        }

        // Snapshot KPIs
        if (data.metrics) {
            document.getElementById('totalRegistered').textContent = Number(data.metrics.totalRegistered || 0).toLocaleString();
            document.getElementById('totalRegisteredGrowth').textContent = data.metrics.registeredGrowth || '+0% vs last month';
            document.getElementById('todayNewAccounts').textContent = Number(data.metrics.todaySignups || 0).toLocaleString();
            document.getElementById('activeBuyersToday').textContent = Number(data.metrics.activeToday || 0).toLocaleString();
            document.getElementById('repeatRate').textContent = data.metrics.repeatRate || '0%';

            if (data.metrics.acquisition) {
                acquisitionMetrics = {
                    today: data.metrics.acquisition.today || 0,
                    week: data.metrics.acquisition.week || 0,
                    month: data.metrics.acquisition.month || 0,
                    last3Months: data.metrics.acquisition.last3Months || 0,
                    last6Months: data.metrics.acquisition.last6Months || 0
                };
                updateAcquisitionPanel();
            }
        }

        allCustomers = data.customers || [];
        applyFiltersAndSort();

    } catch (err) {
        console.error('Customer data loading error:', err);
        MMSwal.fire({
            icon: 'warning',
            title: 'Registry Sync Error',
            text: 'Unable to connect to customer registry. Please refresh.'
        });
    }
}

function updateAcquisitionPanel() {
    const selected = document.getElementById('acquisitionPeriodSelect')?.value || 'week';
    const countEl = document.getElementById('periodSignupsCount');
    const footerEl = document.getElementById('periodSignupsFooter');
    const avgEl = document.getElementById('dailyAvgAcquisition');
    const paceEl = document.getElementById('acquisitionPaceText');
    const paceDescEl = document.getElementById('acquisitionPaceDesc');

    const daysMap = { today: 1, week: 7, month: 30, last3Months: 90, last6Months: 180 };
    const labelMap = {
        today: "Registered today",
        week: "Registered this week",
        month: "Registered this month",
        last3Months: "Past 90 days total",
        last6Months: "Past 180 days total"
    };

    const count = acquisitionMetrics[selected] || 0;
    const days = daysMap[selected] || 7;
    const dailyAvg = (count / days).toFixed(1);

    if (countEl) countEl.textContent = count.toLocaleString();
    if (footerEl) footerEl.textContent = labelMap[selected] || 'Registered';
    if (avgEl) avgEl.textContent = dailyAvg;

    if (paceEl && paceDescEl) {
        if (dailyAvg >= 3.0) {
            paceEl.textContent = 'High Velocity';
            paceEl.className = 'growth-stat-number status-pace-good';
            paceDescEl.textContent = 'Rapid expansion across customer base';
        } else if (dailyAvg >= 1.0) {
            paceEl.textContent = 'Steady';
            paceEl.className = 'growth-stat-number status-pace-good';
            paceDescEl.textContent = 'Consistent daily sign-ups';
        } else {
            paceEl.textContent = 'Moderate';
            paceEl.className = 'growth-stat-number status-pace-warning';
            paceDescEl.textContent = 'Recommend launching promo campaigns';
        }
    }
}

function applyFiltersAndSort() {
    const sortVal = document.getElementById('customerSortSelect')?.value || 'orders_desc';
    const filterVal = document.getElementById('customerDateFilter')?.value || 'all';
    const customDate = document.getElementById('customerCustomDate')?.value;

    const now = new Date();
    const todayStr = SalesCommon.localDate(now);
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    filteredCustomers = allCustomers.filter(c => {
        if (filterVal === 'all') return true;
        if (!c.last_order_at) return false;
        const lastDate = new Date(c.last_order_at);
        const lastDateStr = SalesCommon.localDate(c.last_order_at);

        if (filterVal === 'today') return lastDateStr === todayStr;
        if (filterVal === 'week') return lastDate >= weekAgo;
        if (filterVal === 'month') return lastDate >= startOfMonth;
        if (filterVal === 'custom') return lastDateStr === customDate;
        return true;
    });

    filteredCustomers.sort((a, b) => {
        if (sortVal === 'name_asc') return (a.full_name || '').localeCompare(b.full_name || '');
        if (sortVal === 'orders_desc') return (b.total_orders || 0) - (a.total_orders || 0);
        if (sortVal === 'spent_desc') return (b.total_spent || 0) - (a.total_spent || 0);
        if (sortVal === 'recent') {
            const dA = a.last_order_at ? new Date(a.last_order_at).getTime() : 0;
            const dB = b.last_order_at ? new Date(b.last_order_at).getTime() : 0;
            return dB - dA;
        }
        return 0;
    });

    currentPage = 1;
    renderTable();
}

function renderTable() {
    const tbody = document.getElementById('customerTableBody');
    const pageInfo = document.getElementById('customerPageInfo');
    const prevBtn = document.getElementById('prevCustomerBtn');
    const nextBtn = document.getElementById('nextCustomerBtn');

    if (!tbody) return;

    if (filteredCustomers.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="loading-state-text">No registered members matched the filter criteria.</td></tr>`;
        if (pageInfo) pageInfo.textContent = 'Showing 0 of 0 members';
        if (prevBtn) prevBtn.disabled = true;
        if (nextBtn) nextBtn.disabled = true;
        renderPagination(1, 1);
        return;
    }

    const totalPages = Math.ceil(filteredCustomers.length / PAGE_SIZE) || 1;
    const startIndex = (currentPage - 1) * PAGE_SIZE;
    const items = filteredCustomers.slice(startIndex, startIndex + PAGE_SIZE);

    if (pageInfo) {
        pageInfo.textContent = `Showing ${startIndex + 1}-${Math.min(startIndex + PAGE_SIZE, filteredCustomers.length)} of ${filteredCustomers.length} members`;
    }
    if (prevBtn) prevBtn.disabled = currentPage <= 1;
    if (nextBtn) nextBtn.disabled = currentPage >= totalPages;

    renderPagination(totalPages, currentPage);

    tbody.innerHTML = items.map(c => {
        const orderCount = c.total_orders || 0;
        const totalSpent = Number(c.total_spent || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const isRepeat = orderCount > 1;
        const loyaltyClass = isRepeat ? 'badge-repeat' : 'badge-new';
        const loyaltyText = isRepeat ? 'Repeat Member' : 'New Member';
        const ratingsCount = c.total_ratings_count || (c.ratings ? c.ratings.length : 0);

        return `
            <tr>
                <td>
                    <div class="member-cell">
                        <div class="user-avatar-sm">
                            <img src="${c.avatar || '/customer/images/account.png'}" alt="Avatar" class="avatar-sm-img" onerror="this.src='/customer/images/account.png'">
                        </div>
                        <div class="member-details">
                            <strong class="member-name">${escapeHtml(c.full_name || 'Customer')}</strong>
                            <div class="member-badge-row">
                                <span class="loyalty-pill ${loyaltyClass}">${loyaltyText}</span>
                                <span class="reviews-pill">${ratingsCount} Reviews</span>
                            </div>
                        </div>
                    </div>
                </td>
                <td>
                    <div class="contact-cell">
                        <span class="contact-email">${escapeHtml(c.email || 'No email')}</span>
                        <span class="contact-phone">${escapeHtml(c.phone || 'No phone')}</span>
                    </div>
                </td>
                <td><strong class="stat-number-cell">${orderCount}</strong></td>
                <td><strong class="stat-number-cell">₱${totalSpent}</strong></td>
                <td><span class="pay-method-tag">${escapeHtml(c.preferred_payment || 'Counter Cash')}</span></td>
                <td style="text-align: center;">
                    <button type="button" class="btn-view-profile" onclick="viewCustomerProfile(${c.id})">
                        <svg class="action-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                            <circle cx="12" cy="12" r="3" />
                        </svg>
                        <span>View Profile</span>
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

function renderPagination(totalPages, activePage) {
    const pagerWrap = document.getElementById('customerPagerNumbers');
    if (!pagerWrap) return;

    if (totalPages <= 1) {
        pagerWrap.innerHTML = `<button type="button" class="pager-num-btn active">1</button>`;
        return;
    }

    let html = '';
    for (let i = 1; i <= totalPages; i++) {
        const isActive = i === activePage ? 'active' : '';
        html += `<button type="button" class="pager-num-btn ${isActive}" data-page="${i}">${i}</button>`;
    }
    pagerWrap.innerHTML = html;

    pagerWrap.querySelectorAll('.pager-num-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const page = parseInt(e.currentTarget.getAttribute('data-page'), 10);
            if (page && page !== currentPage) {
                currentPage = page;
                renderTable();
            }
        });
    });
}

// Modal View Profile Logic (Updated with Lifetime Ratings & Review History)
function viewCustomerProfile(customerId) {
    const customer = allCustomers.find(c => c.id === customerId);
    if (!customer) return;

    const overlay = document.getElementById('profileModalOverlay');
    const avatar = document.getElementById('modalAvatar');
    const name = document.getElementById('modalName');
    const sub = document.getElementById('modalSub');
    const callBtn = document.getElementById('modalCallBtn');
    const smsBtn = document.getElementById('modalSmsBtn');
    const address = document.getElementById('modalAddress');
    const paymentBox = document.getElementById('modalPaymentBox');
    const ratingsCountEl = document.getElementById('modalRatingsCount');
    const ratingsListEl = document.getElementById('modalRatingsList');
    const historyList = document.getElementById('modalHistoryList');

    if (avatar) avatar.src = customer.avatar || '/customer/images/account.png';
    if (name) name.textContent = customer.full_name || 'Customer';
    if (sub) sub.textContent = `${customer.email || 'No email'} • ${customer.phone || 'No phone'}`;

    if (callBtn) callBtn.href = customer.phone ? `tel:${customer.phone}` : 'javascript:void(0)';
    if (smsBtn) smsBtn.href = customer.phone ? `sms:${customer.phone}` : 'javascript:void(0)';
    if (address) address.textContent = customer.address || 'Counter Pick-Up Customer (Official Store Pickup)';

    if (paymentBox) {
        paymentBox.innerHTML = `<span class="method-pill">${escapeHtml(customer.preferred_payment || 'Cash on Pick-Up')}</span>`;
    }

    // Populate Lifetime Ratings & Reviews History
    const userRatings = customer.ratings || [];
    if (ratingsCountEl) ratingsCountEl.textContent = `${userRatings.length} Reviews`;

    if (ratingsListEl) {
        if (userRatings.length === 0) {
            ratingsListEl.innerHTML = `<div class="no-reviews-box">No customer reviews submitted yet.</div>`;
        } else {
            ratingsListEl.innerHTML = userRatings.map(r => {
                const score = parseInt(r.score, 10) || 5;
                const starIcons = [1, 2, 3, 4, 5].map(idx => `
                    <svg class="review-star-svg ${idx <= score ? 'filled' : 'empty'}" viewBox="0 0 24 24">
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                    </svg>
                `).join('');

                const tagsHtml = (r.tags && r.tags.length > 0)
                    ? `<div class="review-tags-wrap">${r.tags.map(t => `<span class="review-tag-pill">${escapeHtml(t)}</span>`).join('')}</div>`
                    : '';

                const commentHtml = r.comment
                    ? `<p class="review-comment-text">"${escapeHtml(r.comment)}"</p>`
                    : '<p class="review-comment-text" style="color:var(--text-muted); font-style:normal;">Rating submitted without comments.</p>';

                return `
                    <div class="customer-review-card">
                        <div class="review-card-head">
                            <span class="review-drink-name">${escapeHtml(r.product || 'Marble Drink')}</span>
                            <span class="review-date-text">${r.date || 'Recent'}</span>
                        </div>
                        <div class="review-stars-group">
                            ${starIcons}
                        </div>
                        ${tagsHtml}
                        ${commentHtml}
                    </div>
                `;
            }).join('');
        }
    }

    // Populate Recent Pre-Orders
    const orders = customer.recent_orders || [];
    if (historyList) {
        if (orders.length === 0) {
            historyList.innerHTML = `<div class="no-reviews-box">No orders recorded for this account.</div>`;
        } else {
            historyList.innerHTML = orders.map(ord => {
                const dateStr = ord.placed_at ? new Date(ord.placed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Recent';
                const amt = Number(ord.total_amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                return `
                    <div class="history-item">
                        <div>
                            <strong style="color:var(--brown-soft);">${escapeHtml(ord.order_number || 'MM-ORD')}</strong>
                            <div style="font-size:11px;color:var(--text-muted);">${dateStr} • ${ord.item_count || 1} Item(s)</div>
                        </div>
                        <strong style="color:var(--brown-soft);">₱${amt}</strong>
                    </div>
                `;
            }).join('');
        }
    }

    if (overlay) overlay.classList.add('open');
}

function closeProfileModal() {
    const overlay = document.getElementById('profileModalOverlay');
    if (overlay) overlay.classList.remove('open');
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