let allCampaigns = [];
let filteredCampaigns = [];
let activeStatusTab = 'all';
let currentPromoPage = 1;
const PROMO_PAGE_SIZE = 6;

document.addEventListener('DOMContentLoaded', () => {
    const discountTypeSelect = document.getElementById('inputDiscountType');
    const discountValueLabel = document.getElementById('discountValueLabel');
    if (discountTypeSelect && discountValueLabel) {
        discountTypeSelect.addEventListener('change', (e) => {
            discountValueLabel.textContent = e.target.value === 'percent' 
                ? 'Discount Value * (%)' 
                : 'Discount Value * (₱ Fixed)';
        });
    }

    const tabBtns = document.querySelectorAll('.promo-status-tabs .tab-btn');
    tabBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            tabBtns.forEach(b => b.classList.remove('active'));
            e.currentTarget.classList.add('active');
            activeStatusTab = e.currentTarget.getAttribute('data-status') || 'all';
            applyPromoFilters();
        });
    });

    const dateFilter = document.getElementById('promoDateFilter');
    const customDate = document.getElementById('promoCustomDate');

    if (dateFilter) {
        dateFilter.addEventListener('change', (e) => {
            if (e.target.value === 'custom') {
                customDate.style.display = 'inline-block';
                if (!customDate.value) {
                    customDate.value = SalesCommon.localDate(new Date());
                }
            } else {
                customDate.style.display = 'none';
            }
            applyPromoFilters();
        });
    }

    if (customDate) customDate.addEventListener('change', applyPromoFilters);

    const prevBtn = document.getElementById('prevPromoBtn');
    const nextBtn = document.getElementById('nextPromoBtn');

    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            if (currentPromoPage > 1) {
                currentPromoPage--;
                renderCampaignGrid();
            }
        });
    }

    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            const totalPages = Math.ceil(filteredCampaigns.length / PROMO_PAGE_SIZE) || 1;
            if (currentPromoPage < totalPages) {
                currentPromoPage++;
                renderCampaignGrid();
            }
        });
    }

    const closeBtn = document.getElementById('modalCloseBtn');
    const cancelBtn = document.getElementById('modalCancelBtn');
    const modalOverlay = document.getElementById('promoModalOverlay');
    const pitchForm = document.getElementById('createPromoForm');

    if (closeBtn) closeBtn.addEventListener('click', closePromoModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closePromoModal);
    if (modalOverlay) {
        modalOverlay.addEventListener('click', (e) => {
            if (e.target === modalOverlay) closePromoModal();
        });
    }

    if (pitchForm) pitchForm.addEventListener('submit', handlePitchFormSubmit);

    fetchPromotionsData();
});

// Load campaigns list
async function fetchPromotionsData() {
    try {
        const userId = localStorage.getItem('userId') || sessionStorage.getItem('userId');
        const headers = userId ? { 'x-user-id': userId } : {};

        const response = await fetch('/api/sales-officer/promotions', { headers });
        if (!response.ok) throw new Error(await SalesCommon.errorMessage(response));

        const data = await response.json();

        if (data.user) {
            const userNameEl = document.getElementById('userName');
            const userAvatarEl = document.getElementById('userAvatar');
            if (userNameEl) userNameEl.textContent = data.user.fullName || 'Sales Officer';
            if (userAvatarEl && data.user.avatarSrc) userAvatarEl.src = data.user.avatarSrc;
        }

        allCampaigns = data.campaigns || [];
        updateMetricsAndTabs();
        applyPromoFilters();

    } catch (error) {
        console.error('Could not load promotions from server:', error);
        SalesCommon.showError(error);
        SalesCommon.failTables();
    }
}

function updateMetricsAndTabs() {
    const totalCount = allCampaigns.length;
    const activeCount = allCampaigns.filter(c => c.status === 'ACTIVE').length;
    const pendingCount = allCampaigns.filter(c => c.status === 'PENDING_APPROVAL').length;
    const archivedCount = allCampaigns.filter(c => c.status === 'REJECTED' || c.status === 'EXPIRED').length;

    document.getElementById('totalPromosCount').textContent = totalCount.toString();
    document.getElementById('activePromosCount').textContent = activeCount.toString();

    document.getElementById('countAllBadge').textContent = totalCount.toString();
    document.getElementById('countPendingBadge').textContent = pendingCount.toString();
    document.getElementById('countActiveBadge').textContent = activeCount.toString();
    document.getElementById('countArchivedBadge').textContent = archivedCount.toString();
}

// Filter logic by status and date
function applyPromoFilters() {
    const dateFilterVal = document.getElementById('promoDateFilter')?.value || 'all';
    const customDateVal = document.getElementById('promoCustomDate')?.value;

    filteredCampaigns = allCampaigns.filter(c => {
        if (activeStatusTab === 'pending' && c.status !== 'PENDING_APPROVAL') return false;
        if (activeStatusTab === 'active' && c.status !== 'ACTIVE') return false;
        if (activeStatusTab === 'archived' && (c.status !== 'REJECTED' && c.status !== 'EXPIRED')) return false;

        if (dateFilterVal === 'current' && c.status !== 'ACTIVE') return false;
        if (dateFilterVal === 'month' && c.created_at) {
            const date = new Date(c.created_at);
            const now = new Date();
            if (date.getMonth() !== now.getMonth() || date.getFullYear() !== now.getFullYear()) return false;
        }
        if (dateFilterVal === 'custom' && c.created_at) {
            const dateStr = SalesCommon.localDate(c.created_at);
            if (dateStr !== customDateVal) return false;
        }

        return true;
    });

    currentPromoPage = 1;
    renderCampaignGrid();
}

// Render cards and pagination
function renderCampaignGrid() {
    const grid = document.getElementById('campaignGrid');
    const pageInfo = document.getElementById('promoPageInfo');
    const prevBtn = document.getElementById('prevPromoBtn');
    const nextBtn = document.getElementById('nextPromoBtn');

    if (!grid) return;

    if (filteredCampaigns.length === 0) {
        grid.innerHTML = '<p class="loading-state-text">No campaigns found under this filter criteria.</p>';
        if (pageInfo) pageInfo.textContent = 'Showing 0 of 0 campaigns';
        if (prevBtn) prevBtn.disabled = true;
        if (nextBtn) nextBtn.disabled = true;
        renderPromoPagerButtons(1, 1);
        return;
    }

    const totalPages = Math.ceil(filteredCampaigns.length / PROMO_PAGE_SIZE) || 1;
    const startIndex = (currentPromoPage - 1) * PROMO_PAGE_SIZE;
    const pageItems = filteredCampaigns.slice(startIndex, startIndex + PROMO_PAGE_SIZE);

    if (pageInfo) {
        const startNum = startIndex + 1;
        const endNum = Math.min(startIndex + PROMO_PAGE_SIZE, filteredCampaigns.length);
        pageInfo.textContent = `Showing ${startNum}-${endNum} of ${filteredCampaigns.length} campaigns`;
    }
    if (prevBtn) prevBtn.disabled = currentPromoPage <= 1;
    if (nextBtn) nextBtn.disabled = currentPromoPage >= totalPages;

    renderPromoPagerButtons(totalPages, currentPromoPage);

    grid.innerHTML = pageItems.map(c => {
        const isPercent = c.discount_type === 'percent';
        const discountDisplay = isPercent ? `${c.discount_value}% OFF` : `₱${Number(c.discount_value).toFixed(2)} OFF`;
        const minSpendText = c.min_spend ? `Min. Spend: ₱${Number(c.min_spend).toLocaleString()}` : 'No minimum spend';
        const usageText = c.usage_cap ? `${c.usage_count || 0} / ${c.usage_cap} redemptions` : `${c.usage_count || 0} redemptions (Unlimited)`;

        let segmentLabel = 'General Public';
        let segmentClass = 'segment-all';
        if (c.target_segment === 'member') {
            segmentLabel = 'Members Only';
            segmentClass = 'segment-member';
        }

        let statusClass = 'pending';
        let statusLabel = 'Pending CEO Approval';
        if (c.status === 'ACTIVE') {
            statusClass = 'active';
            statusLabel = 'Active in Checkout';
        } else if (c.status === 'REJECTED') {
            statusClass = 'rejected';
            statusLabel = 'Rejected by CEO';
        }

        return `
            <div class="campaign-card">
                <div class="card-top-row">
                    <span class="promo-code-title">${escapeHtml(c.code)}</span>
                    <span class="segment-pill ${segmentClass}">${segmentLabel}</span>
                </div>

                <div class="discount-highlight-box">
                    <span class="discount-val-text">${discountDisplay}</span>
                    <span class="min-spend-sub">${minSpendText}</span>
                </div>

                <div class="promo-meta-details">
                    <div><strong>Usage:</strong> ${usageText}</div>
                    ${c.pitch_note ? `<div><strong>Rationale:</strong> ${escapeHtml(c.pitch_note)}</div>` : ''}
                    ${c.rejection_reason ? `<div style="color: #c9302c;"><strong>CEO Feedback:</strong> ${escapeHtml(c.rejection_reason)}</div>` : ''}
                </div>

                <div class="card-footer-row">
                    <span class="status-pill ${statusClass}">
                        <span class="status-dot"></span>
                        ${statusLabel}
                    </span>
                </div>
            </div>
        `;
    }).join('');
}

// Smart sliding pagination
function renderPromoPagerButtons(totalPages, activePage) {
    const pagerNumbers = document.getElementById('promoPagerNumbers');
    if (!pagerNumbers) return;

    if (totalPages <= 1) {
        pagerNumbers.innerHTML = `<button type="button" class="pager-num-btn active" data-page="1">1</button>`;
        return;
    }

    const pages = [];
    if (totalPages <= 7) {
        for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
        if (activePage <= 4) {
            pages.push(1, 2, 3, 4, 5, '...', totalPages);
        } else if (activePage >= totalPages - 3) {
            pages.push(1, '...', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages);
        } else {
            pages.push(1, '...', activePage - 1, activePage, activePage + 1, '...', totalPages);
        }
    }

    let html = '';
    pages.forEach(p => {
        if (p === '...') {
            html += `<span class="pager-ellipsis">&hellip;</span>`;
        } else {
            const isActive = p === activePage ? 'active' : '';
            html += `<button type="button" class="pager-num-btn ${isActive}" data-page="${p}">${p}</button>`;
        }
    });
    pagerNumbers.innerHTML = html;

    pagerNumbers.querySelectorAll('.pager-num-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const page = parseInt(e.currentTarget.getAttribute('data-page'), 10);
            if (page && page !== currentPromoPage) {
                currentPromoPage = page;
                renderCampaignGrid();
            }
        });
    });
}

// Submit proposal to CEO
async function handlePitchFormSubmit(e) {
    e.preventDefault();

    const form = e.target;
    const code = form.code.value.trim().toUpperCase();
    const targetSegment = form.target_segment.value;
    const discountType = form.discount_type.value;
    const discountValue = parseFloat(form.discount_value.value);
    const minSpend = form.min_spend.value ? parseFloat(form.min_spend.value) : null;
    const usageCap = form.usage_cap.value ? parseInt(form.usage_cap.value, 10) : null;
    const pitchNote = form.pitch_note.value.trim();

    const payload = {
        code,
        target_segment: targetSegment,
        discount_type: discountType,
        discount_value: discountValue,
        min_spend: minSpend,
        usage_cap: usageCap,
        pitch_note: pitchNote
    };

    try {
        const userId = localStorage.getItem('userId') || sessionStorage.getItem('userId');
        const response = await fetch('/api/sales-officer/promotions/pitch', {
            method: 'POST',
            headers: Object.assign({ 'Content-Type': 'application/json' }, userId ? { 'x-user-id': userId } : {}),
            body: JSON.stringify(payload)
        });
        if (!response.ok) throw new Error(await SalesCommon.errorMessage(response));
    } catch (err) {
        console.error('Pitch submission failed:', err);
        alert('Could not submit the promotion: ' + (err.message || 'unknown error'));
        return;
    }

    closePromoModal();
    form.reset();
    await fetchPromotionsData();
    alert(`Promotion proposal for "${code}" submitted. It is now waiting for CEO approval.`);
}

function openPromoModal() {
    const modal = document.getElementById('promoModalOverlay');
    if (modal) {
        modal.classList.add('open');
        document.body.style.overflow = 'hidden';
    }
}

function closePromoModal() {
    const modal = document.getElementById('promoModalOverlay');
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