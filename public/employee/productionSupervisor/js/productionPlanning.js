let allPlans = [];
let filteredPlans = [];
let currentPlanPage = 1;
const PLANS_PAGE_SIZE = 5;
let todayPlansCount = 0;
let tomorrowPlansCount = 0;
let supervisorFullName = 'Production Supervisor';

document.addEventListener('DOMContentLoaded', () => {
    fetchProductionPlanningData();

    // Default due date to today
    const addDueDateInput = document.getElementById('addDueDate');
    if (addDueDateInput) {
        addDueDateInput.value = new Date().toISOString().split('T')[0];
    }

    // View switchers
    const btnBoard = document.getElementById('btnViewBoard');
    const btnList = document.getElementById('btnViewList');

    if (btnBoard) btnBoard.addEventListener('click', () => switchPlanView('board'));
    if (btnList) btnList.addEventListener('click', () => switchPlanView('list'));

    // Recipe auto-fill & Smart Unit Suggestion (grams vs pcs)
    const recipeSelect = document.getElementById('recipeSelect');
    if (recipeSelect) {
        recipeSelect.addEventListener('change', function() {
            const val = this.value;
            if (val) {
                document.getElementById('addOpInput').value = `${val} Cooking Run`;
                const unitSelect = document.getElementById('addBatchUnit');
                const qtyInput = document.getElementById('addBatchQty');

                if (val.includes('Tapioca')) {
                    if (unitSelect) unitSelect.value = 'grams';
                    if (qtyInput && !qtyInput.value) qtyInput.value = 300;
                } else {
                    if (unitSelect) unitSelect.value = 'pcs';
                    if (qtyInput && !qtyInput.value) qtyInput.value = 2;
                }
            }
        });
    }

    // Form Submissions
    document.getElementById('addPlanForm')?.addEventListener('submit', handleAddPlan);
    document.getElementById('editPlanForm')?.addEventListener('submit', handleEditPlan);
    document.getElementById('pitchRestockForm')?.addEventListener('submit', handlePitchRestockSubmit);

    // Live calculation listeners for Pitch modal
    const pitchQtyEl = document.getElementById('pitchQty');
    const pitchUnitPriceEl = document.getElementById('pitchUnitPrice');
    if (pitchQtyEl) pitchQtyEl.addEventListener('input', calculatePitchTotal);
    if (pitchUnitPriceEl) pitchUnitPriceEl.addEventListener('input', calculatePitchTotal);

    // Timeline Filter
    document.getElementById('timeRangeFilter')?.addEventListener('change', filterByTimeRange);

    // Pagination buttons
    const prevBtn = document.getElementById('prevPlanBtn');
    const nextBtn = document.getElementById('nextPlanBtn');

    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            if (currentPlanPage > 1) {
                currentPlanPage--;
                renderListTable();
            }
        });
    }

    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            const totalPages = Math.ceil(filteredPlans.length / PLANS_PAGE_SIZE) || 1;
            if (currentPlanPage < totalPages) {
                currentPlanPage++;
                renderListTable();
            }
        });
    }
});

async function fetchProductionPlanningData() {
    try {
        let response;
        if (typeof employeeFetch === 'function') {
            response = await employeeFetch('/api/production-supervisor/production-planning');
        } else {
            const userId = localStorage.getItem('userId') || sessionStorage.getItem('userId');
            const headers = userId ? { 'x-user-id': userId } : {};
            response = await fetch('/api/production-supervisor/production-planning', { headers });
        }

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.message || 'Server error ' + response.status);
        }

        const data = await response.json();

        if (data.user && data.user.fullName) {
            supervisorFullName = data.user.fullName;
            const userFullNameEl = document.getElementById('userFullName');
            const userAvatarEl = document.getElementById('userAvatar');
            if (userFullNameEl) userFullNameEl.textContent = data.user.fullName;
            if (userAvatarEl && data.user.avatarSrc) userAvatarEl.src = data.user.avatarSrc;
        }

        allPlans = data.allPlans || [];
        filteredPlans = [...allPlans];
        todayPlansCount = (data.todayPlans || []).length;
        tomorrowPlansCount = (data.tomorrowPlans || []).length;

        const dateRangeEl = document.getElementById('dateRangeText');
        if (dateRangeEl && data.dateRangeText) dateRangeEl.textContent = data.dateRangeText;

        renderAllViews();

    } catch (error) {
        console.error('Could not load production planning data:', error);
        showCustomSwal('Error Loading Plans', error.message || 'Could not fetch scheduled runs.', 'warning');
    }
}

function renderAllViews() {
    renderKanbanBoard();
    renderListTable();
    updateKpiBadges();
}

function renderKanbanBoard() {
    const scheduledContainer = document.getElementById('scheduledPlansList');
    const inProgressContainer = document.getElementById('inProgressPlansList');
    const readyContainer = document.getElementById('readyPlansList');

    const scheduled = filteredPlans.filter(p => p.status === 'PLANNED');
    const inProgress = filteredPlans.filter(p => p.status === 'IN PROGRESS');
    const ready = filteredPlans.filter(p => p.status === 'COMPLETED');

    document.getElementById('scheduledCount').textContent = scheduled.length;
    document.getElementById('inProgressCount').textContent = inProgress.length;
    document.getElementById('readyCount').textContent = ready.length;

    renderColumnCards(scheduledContainer, scheduled, 'scheduled');
    renderColumnCards(inProgressContainer, inProgress, 'inProgress');
    renderColumnCards(readyContainer, ready, 'ready');
}

function renderColumnCards(container, plans, stageType) {
    if (!container) return;

    if (!plans || plans.length === 0) {
        container.innerHTML = `<div class="loading-state-text">No batches in this stage.</div>`;
        return;
    }

    container.innerHTML = plans.map(plan => {
        let cardClass = '';
        let nextBtnLabel = 'Advance Run';
        let nextStatus = 'IN PROGRESS';

        if (stageType === 'inProgress') {
            cardClass = 'active-stage';
            nextBtnLabel = 'Mark in Warmer';
            nextStatus = 'COMPLETED';
        } else if (stageType === 'ready') {
            cardClass = 'ready-stage';
            nextBtnLabel = 'Reset Stage';
            nextStatus = 'IN PROGRESS';
        }

        return `
            <div class="plan-card ${cardClass}">
                <div class="card-top">
                    <span class="card-time">
                        <svg class="inline-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="10"></circle>
                            <polyline points="12 6 12 12 16 14"></polyline>
                        </svg>
                        <span>${escapeHtml(plan.schedule_time)}</span>
                    </span>
                    <span class="status-pill badge-${stageType === 'ready' ? 'complete' : (stageType === 'inProgress' ? 'progress' : 'planned')}">
                        ${escapeHtml(plan.status)}
                    </span>
                </div>
                <div class="card-title">${escapeHtml(plan.operation)}</div>
                <div><span class="card-yield-info">Yield: <strong>${escapeHtml(plan.yield_volume || 'Standard')}</strong></span></div>
                <div class="card-bottom">
                    <button type="button" class="btn-stage-advance" onclick="advanceBatchStage(${plan.id}, '${nextStatus}')">
                        ${nextBtnLabel}
                    </button>
                    <button class="btn-edit-plan" onclick="openEditPlanByData('${plan.id}')" title="Edit Run">
                        <svg class="action-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
                        </svg>
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

function renderListTable() {
    const tbody = document.getElementById('allPlansTableBody');
    const pageInfo = document.getElementById('planPageInfo');
    const prevBtn = document.getElementById('prevPlanBtn');
    const nextBtn = document.getElementById('nextPlanBtn');

    if (!tbody) return;

    if (filteredPlans.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="loading-state-text">No scheduled batch cooking runs found.</td></tr>';
        if (pageInfo) pageInfo.textContent = 'Showing 0 of 0 plans';
        if (prevBtn) prevBtn.disabled = true;
        if (nextBtn) nextBtn.disabled = true;
        renderPlanPagerButtons(1, 1);
        return;
    }

    const totalPages = Math.ceil(filteredPlans.length / PLANS_PAGE_SIZE) || 1;
    const startIndex = (currentPlanPage - 1) * PLANS_PAGE_SIZE;
    const pageItems = filteredPlans.slice(startIndex, startIndex + PLANS_PAGE_SIZE);

    if (pageInfo) {
        const startNum = startIndex + 1;
        const endNum = Math.min(startIndex + PLANS_PAGE_SIZE, filteredPlans.length);
        pageInfo.textContent = `Showing ${startNum}-${endNum} of ${filteredPlans.length} plans`;
    }
    if (prevBtn) prevBtn.disabled = currentPlanPage <= 1;
    if (nextBtn) nextBtn.disabled = currentPlanPage >= totalPages;

    renderPlanPagerButtons(totalPages, currentPlanPage);

    tbody.innerHTML = pageItems.map(p => {
        const status = String(p.status || '').toUpperCase();
        let badgeClass = 'badge-planned';
        if (status === 'IN PROGRESS') badgeClass = 'badge-progress';
        else if (status === 'COMPLETED') badgeClass = 'badge-complete';

        return `
            <tr>
                <td><strong>${escapeHtml(p.order_code || 'BATCH-RUN')}</strong></td>
                <td>
                    <div style="font-weight: 700; color: var(--text-dark);">${escapeHtml(p.operation)}</div>
                    <div style="font-size: 11px; color: var(--text-muted);">${escapeHtml(p.holding_note || '')}</div>
                </td>
                <td><strong style="color: var(--brown-soft);">${escapeHtml(p.yield_volume || 'N/A')}</strong></td>
                <td><span style="font-size: 11.5px; font-weight: 700; color: var(--text-muted);">${formatDate(p.due_date)} · ${escapeHtml(p.schedule_time || '07:30 AM')}</span></td>
                <td><span class="status-pill ${badgeClass}">${escapeHtml(status)}</span></td>
                <td style="text-align: right;">
                    <button class="btn-edit-plan" onclick="openEditPlanByData('${p.id}')" title="Edit Run">
                        <svg class="action-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
                        </svg>
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

function renderPlanPagerButtons(totalPages, activePage) {
    const pagerNumbers = document.getElementById('planPagerNumbers');
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
            if (page && page !== currentPlanPage) {
                currentPlanPage = page;
                renderListTable();
            }
        });
    });
}

function updateKpiBadges() {
    const totalEl = document.getElementById('totalRunsCount');
    if (totalEl) totalEl.textContent = `${allPlans.length} Runs`;
    const todayEl = document.getElementById('todayRunsCount');
    if (todayEl) todayEl.textContent = `${todayPlansCount} Runs`;
    const tomorrowEl = document.getElementById('tomorrowRunsCount');
    if (tomorrowEl) tomorrowEl.textContent = `${tomorrowPlansCount} Runs`;
    const inProgEl = document.getElementById('inProgressCountKpi');
    if (inProgEl) inProgEl.textContent = allPlans.filter(p => p.status === 'IN PROGRESS').length;
}

async function advanceBatchStage(planId, newStatus) {
    const plan = allPlans.find(p => p.id === planId);
    if (!plan) return;

    try {
        await apiPost('/api/production-supervisor/edit-plan', {
            plan_id: plan.id,
            operation: plan.operation,
            due_date: plan.due_date,
            schedule_time: plan.schedule_time,
            status: newStatus
        });
        plan.status = newStatus;
        renderAllViews();
        showCustomSwal('Stage Updated', `Batch run set to ${newStatus}.`, 'success');
    } catch (error) {
        showCustomSwal('Update Failed', error.message || 'Could not update batch stage.', 'warning');
    }
}

async function apiPost(url, body) {
    const opts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
    const res = (typeof employeeFetch === 'function') ? await employeeFetch(url, opts) : await fetch(url, opts);
    let data = {};
    try { data = await res.json(); } catch (e) {}
    if (!res.ok || data.status === 'error') {
        throw new Error(data.message || ('Server responded with status ' + res.status));
    }
    return data;
}

function switchPlanView(view) {
    const boardArea = document.getElementById('boardViewArea');
    const listArea = document.getElementById('listViewArea');
    const btnBoard = document.getElementById('btnViewBoard');
    const btnList = document.getElementById('btnViewList');

    if (view === 'board') {
        boardArea.style.display = 'grid';
        listArea.style.display = 'none';
        btnBoard.classList.add('active');
        btnList.classList.remove('active');
    } else {
        boardArea.style.display = 'none';
        listArea.style.display = 'flex';
        btnList.classList.add('active');
        btnBoard.classList.remove('active');
    }
}

function filterByTimeRange() {
    const filter = document.getElementById('timeRangeFilter')?.value;
    if (filter === 'tue_run') {
        filteredPlans = allPlans.filter(p => p.due_date && new Date(p.due_date).getDay() === 2);
    } else if (filter === 'thu_run') {
        filteredPlans = allPlans.filter(p => p.due_date && new Date(p.due_date).getDay() === 4);
    } else {
        filteredPlans = [...allPlans];
    }
    currentPlanPage = 1;
    renderAllViews();
}

// Submits batch cooking run & checks for stock validation / Pitch Restock trigger
async function handleAddPlan(e) {
    e.preventDefault();

    const recipePreset = document.getElementById('recipeSelect')?.value || '';
    const operation = document.getElementById('addOpInput').value.trim();
    const batchQty = parseFloat(document.getElementById('addBatchQty')?.value || 0);
    const batchUnit = document.getElementById('addBatchUnit')?.value || 'grams';
    const customYield = document.getElementById('addYieldInput')?.value.trim();
    const due_date = document.getElementById('addDueDate').value;
    const schedule_time = document.getElementById('addScheduleTime').value;
    const status = document.getElementById('addStatus').value;

    if (!operation || !due_date || !schedule_time || !batchQty) {
        showCustomSwal('Incomplete Information', 'Please fill out the recipe name, quantity to cook, date, and time.', 'warning');
        return;
    }

    const yieldSummary = customYield || `${batchQty} ${batchUnit}`;
    const fullOperation = `${operation} (${batchQty} ${batchUnit})`;
    const submitBtn = e.target.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;

    try {
        const payload = {
            recipe_name: recipePreset || operation,
            raw_qty: batchQty,
            raw_unit: batchUnit,
            yield_volume: yieldSummary,
            operation: fullOperation,
            due_date,
            schedule_time,
            status
        };

        const res = await (typeof employeeFetch === 'function' 
            ? employeeFetch('/api/production-supervisor/add-plan', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            })
            : fetch('/api/production-supervisor/add-plan', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'x-user-id': localStorage.getItem('userId') || sessionStorage.getItem('userId') || ''
                },
                body: JSON.stringify(payload)
            }));

        const result = await res.json().catch(() => ({}));

        // English Out-of-Stock Alert + Modal Trigger
        if (!res.ok || result.status === 'insufficient_stock') {
            if (result.status === 'insufficient_stock') {
                const pitchConfirm = await Swal.fire({
                    title: 'Out of Stock!',
                    html: `
                        <p style="font-size: 13.5px; color: var(--text-dark); margin-bottom: 8px;">
                            Cannot schedule cooking run for <b>${escapeHtml(result.itemName)}</b> because only <b>${result.currentStock} ${result.unit}</b> remains in inventory (Required: <b>${result.requiredStock} ${result.unit}</b>).
                        </p>
                        <p style="font-size: 12px; font-weight: 700; color: var(--brown-soft);">
                            You must pitch a restock requisition before scheduling this batch.
                        </p>
                    `,
                    icon: 'warning',
                    showCancelButton: true,
                    confirmButtonText: 'Pitch Restock Now',
                    cancelButtonText: 'Cancel Schedule',
                    customClass: {
                        popup: 'mm-swal-popup',
                        title: 'mm-swal-title',
                        actions: 'mm-swal-actions',
                        confirmButton: 'mm-swal-confirm',
                        cancelButton: 'mm-swal-cancel'
                    },
                    buttonsStyling: false
                });

                if (pitchConfirm.isConfirmed) {
                    closeModal('addPlanModal');
                    // Bubuksan ang Pitch Ingredient Restock modal on-screen
                    openPitchRestockModal(result.itemName, result.requiredStock, result.unit);
                }
                return;
            }
            throw new Error(result.message || 'Server rejected batch schedule.');
        }

        closeModal('addPlanModal');
        e.target.reset();
        await fetchProductionPlanningData();
        showCustomSwal('Batch Scheduled', `Batch cooking plan for "${operation}" scheduled successfully and inventory updated.`, 'success');

    } catch (error) {
        console.error('Scheduling failed:', error);
        showCustomSwal('Scheduling Blocked', error.message || 'Could not save the batch plan.', 'warning');
    } finally {
        if (submitBtn) submitBtn.disabled = false;
    }
}

// Opens the Pitch Ingredient Restock Modal directly on screen with pre-filled details
function openPitchRestockModal(itemName, requiredQty, unit) {
    const nameInput = document.getElementById('pitchItemName');
    const qtyInput = document.getElementById('pitchQty');
    const unitPriceInput = document.getElementById('pitchUnitPrice');
    const rationaleInput = document.getElementById('pitchRationale');

    if (nameInput) nameInput.value = itemName || '';
    if (qtyInput) qtyInput.value = requiredQty || 2;
    if (unitPriceInput) unitPriceInput.value = 130;
    if (rationaleInput) {
        rationaleInput.value = `Running low on ${itemName} (${requiredQty} ${unit} needed for scheduled batch run).`;
    }

    calculatePitchTotal();
    openModal('pitchRestockModal');
}

// Live Cost & Route Calculation for Pitch Modal
function calculatePitchTotal() {
    const qty = parseFloat(document.getElementById('pitchQty')?.value || 0);
    const unitPrice = parseFloat(document.getElementById('pitchUnitPrice')?.value || 0);
    const total = qty * unitPrice;

    const displayEl = document.getElementById('pitchCostDisplay');
    const badgeEl = document.getElementById('pitchRouteBadge');

    if (displayEl) {
        displayEl.textContent = `₱${total.toFixed(2)}`;
    }

    if (badgeEl) {
        if (total > 500) {
          badgeEl.textContent = '🔴 Escalated Route: CEO Clearance Required';
          badgeEl.style.background = 'rgba(201, 48, 44, 0.12)';
          badgeEl.style.color = '#C9302C';
        } else if (total > 300) {
          badgeEl.textContent = '🟠 Routing: Finance Officer Approval Required';
          badgeEl.style.background = 'rgba(234, 163, 66, 0.2)';
          badgeEl.style.color = '#B26A00';
        } else {
          badgeEl.textContent = '🟢 Direct Route: Procurement Officer (Direct Purchase Authorized)';
          badgeEl.style.background = 'rgba(46, 125, 50, 0.12)';
          badgeEl.style.color = '#2E7D32';
        }
    }
}

// Handle Pitch Requisition Form Submission
async function handlePitchRestockSubmit(e) {
    e.preventDefault();

    const item_name = document.getElementById('pitchItemName').value.trim();
    const quantity = parseFloat(document.getElementById('pitchQty').value);
    const unit_price = parseFloat(document.getElementById('pitchUnitPrice').value);
    const rationale = document.getElementById('pitchRationale').value.trim();

    if (!item_name || isNaN(quantity) || isNaN(unit_price)) {
        showCustomSwal('Incomplete Information', 'Please provide item name, quantity, and unit price.', 'warning');
        return;
    }

    const submitBtn = document.getElementById('btnSubmitPitch');
    if (submitBtn) submitBtn.disabled = true;

    try {
        const payload = {
            item_name,
            quantity,
            unit_price,
            rationale
        };

        await apiPost('/api/production-supervisor/pitch-restock', payload);
        closeModal('pitchRestockModal');
        e.target.reset();
        showCustomSwal('Pitch Submitted', `Restock requisition for "${item_name}" transmitted successfully to Procurement.`, 'success');
    } catch (err) {
        console.error('Pitch submission failed:', err);
        showCustomSwal('Submission Failed', err.message || 'Could not transmit restock pitch.', 'warning');
    } finally {
        if (submitBtn) submitBtn.disabled = false;
    }
}

function openEditPlanByData(planId) {
    const plan = allPlans.find(p => String(p.id) === String(planId));
    if (!plan) return;

    document.getElementById('editPlanId').value = plan.id;
    document.getElementById('editProductName').value = plan.operation || '';
    document.getElementById('editYieldInput').value = plan.yield_volume || '';
    document.getElementById('editDueDate').value = plan.due_date ? plan.due_date.split('T')[0] : new Date().toISOString().split('T')[0];
    document.getElementById('editScheduleTime').value = plan.schedule_time || '07:30';
    document.getElementById('editStatus').value = plan.status || 'PLANNED';
    openModal('editPlanModal');
}

async function handleEditPlan(e) {
    e.preventDefault();

    const planId = parseInt(document.getElementById('editPlanId').value, 10);
    const plan = allPlans.find(p => p.id === planId);
    if (!plan) return;

    const operation = document.getElementById('editProductName').value.trim();
    const yield_volume = document.getElementById('editYieldInput').value.trim();
    const due_date = document.getElementById('editDueDate').value;
    const schedule_time = document.getElementById('editScheduleTime').value;
    const status = document.getElementById('editStatus').value;

    try {
        await apiPost('/api/production-supervisor/edit-plan', {
            plan_id: planId,
            operation: yield_volume ? `${operation} (${yield_volume})` : operation,
            due_date,
            schedule_time,
            status
        });
        closeModal('editPlanModal');
        await fetchProductionPlanningData();
        showCustomSwal('Run Updated', `Batch run "${operation}" updated successfully.`, 'success');
    } catch (error) {
        showCustomSwal('Update Failed', error.message || 'Could not update batch run.', 'warning');
    }
}

// Corporate Kitchen Batch & BOM Schedule PDF Export Engine
async function exportBatchScheduleToPDF() {
    const renderWrapper = document.getElementById('corporatePdfRenderWrapper');
    if (!renderWrapper) return;

    showCustomSwal('Compiling Production Report', 'Generating official kitchen batch manifest, BOM conversion tables, and supervisor clearance sheet...', 'info');

    const todayFormatted = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: '2-digit' });
    const coverageText = document.getElementById('dateRangeText')?.textContent || 'Current Production Cycle';

    // 1. Meta Details
    document.getElementById('pdfMetaDate').textContent = `Date: ${todayFormatted}`;
    document.getElementById('pdfMetaPeriod').textContent = `Coverage: ${coverageText}`;
    document.getElementById('pdfSignSupervisor').textContent = supervisorFullName;

    // 2. Batch Runs Table
    const batchTableBody = document.getElementById('pdfBatchTableBody');
    if (allPlans.length > 0) {
        batchTableBody.innerHTML = allPlans.map(p => `
            <tr>
                <td><strong>${escapeHtml(p.order_code || 'BATCH-RUN')}</strong></td>
                <td><strong>${escapeHtml(p.operation)}</strong></td>
                <td>${escapeHtml(p.yield_volume || 'Standard Batch')}</td>
                <td>${escapeHtml(p.schedule_time || '07:30 AM')}</td>
                <td>${formatDate(p.due_date)}</td>
                <td><strong>${escapeHtml(p.status || 'PLANNED')}</strong></td>
            </tr>
        `).join('');
    } else {
        batchTableBody.innerHTML = `<tr><td colspan="6" style="text-align:center;">No scheduled cooking runs recorded for this cycle.</td></tr>`;
    }

    // 3. Stage Summary Table
    const scheduledCount = allPlans.filter(p => p.status === 'PLANNED').length;
    const inProgressCount = allPlans.filter(p => p.status === 'IN PROGRESS').length;
    const readyCount = allPlans.filter(p => p.status === 'COMPLETED').length;

    document.getElementById('pdfStageSummaryBody').innerHTML = `
        <tr>
            <td><strong>1. Scheduled Morning Preparation</strong></td>
            <td><strong>${scheduledCount} Run(s)</strong></td>
            <td>07:00 AM – 08:30 AM</td>
        </tr>
        <tr>
            <td><strong>2. Active Boiling &amp; Steeping (In Progress)</strong></td>
            <td><strong>${inProgressCount} Run(s)</strong></td>
            <td>Pre-release Window</td>
        </tr>
        <tr>
            <td><strong>3. Ready in Chiller / Holding Warmer</strong></td>
            <td><strong>${readyCount} Run(s)</strong></td>
            <td>10:00 AM – 03:00 PM Release Window</td>
        </tr>
    `;

    renderWrapper.style.display = 'block';

    const opt = {
        margin: [10, 10, 10, 10],
        filename: `Milky_Marble_Kitchen_Batch_Schedule_${new Date().toISOString().slice(0, 10)}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, logging: false },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };

    try {
        await html2pdf().set(opt).from(renderWrapper).save();
        renderWrapper.style.display = 'none';
        showCustomSwal('PDF Export Complete', 'Official Kitchen Batch & BOM Schedule has been exported successfully.', 'success');
    } catch (err) {
        renderWrapper.style.display = 'none';
        console.error('Kitchen PDF export failed:', err);
        showCustomSwal('Export Failed', 'Error generating PDF report: ' + err.message, 'warning');
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

function formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit' });
}

function showCustomSwal(title, text, icon = 'info') {
    if (typeof Swal !== 'undefined') {
        Swal.fire({
            title: title,
            text: text,
            icon: icon,
            customClass: {
                popup: 'mm-swal-popup',
                title: 'mm-swal-title',
                confirmButton: 'mm-swal-confirm'
            },
            buttonsStyling: false
        });
    } else {
        alert(title + '\n' + text);
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