let allPlans = [];



document.addEventListener('DOMContentLoaded', () => {

    fetchProductionPlanningData();



    // Real-time table search filtering

    const searchInput = document.getElementById('planSearchInput');

    if (searchInput) {

        searchInput.addEventListener('input', function() {

            const q = this.value.toLowerCase().trim();

            const rows = document.querySelectorAll('#plansTableBody tr');

            rows.forEach(row => {

                const text = row.textContent.toLowerCase();

                row.style.display = (!q || text.includes(q)) ? '' : 'none';

            });

        });

    }



    // Modal background overlay handlers

    const createModalOverlay = document.getElementById('createPlanModalOverlay');

    if (createModalOverlay) {

        createModalOverlay.addEventListener('click', (e) => {

            if (e.target.id === 'createPlanModalOverlay') closeCreateModal();

        });

    }



    const prodModalOverlay = document.getElementById('productionModalOverlay');

    if (prodModalOverlay) {

        prodModalOverlay.addEventListener('click', (e) => {

            if (e.target.id === 'productionModalOverlay') closeModal();

        });

    }



    document.addEventListener('keydown', (e) => {

        if (e.key === 'Escape') {

            closeModal();

            closeCreateModal();

        }

    });



    // Form submission handler

    document.getElementById('createPlanForm')?.addEventListener('submit', handleCreatePlan);

});



async function fetchProductionPlanningData() {

    try {

        // Grab logged-in user ID to fetch accurate profile details

        const userId = localStorage.getItem('userId');

        const headers = userId ? { 'x-user-id': userId } : {};



        const response = await fetch('/api/admin/production-planning', { headers });

        if (!response.ok) throw new Error('Failed to load production planning data');



        const data = await response.json();



        // User profile setup

        const userFullNameEl = document.getElementById('userFullName');

        const userAvatarEl = document.getElementById('userAvatarImg');



        if (userFullNameEl) userFullNameEl.textContent = data.user.fullName;

        if (userAvatarEl && data.user.avatar) {

            userAvatarEl.src = data.user.avatar;

            // Add the same fallback logic for the admin profile image

            userAvatarEl.onerror = function() { this.src = '/customer/images/account.png'; }; 

        }



        // Active Batches Count

        document.getElementById('activeBatchesCount').textContent = Number(data.activeBatchesCount || 0).toLocaleString();



        // Populate Recipe Dropdown

        populateRecipeDropdown(data.recipesList);



        // Populate Supervisor Dropdown

        populateSupervisorDropdown(data.staffList);



        // Render Plans Table

        allPlans = data.plans || [];

        renderPlansTable(allPlans);



    } catch (error) {

        console.error('Error fetching production planning data:', error);

        const tbody = document.getElementById('plansTableBody');

        if (tbody) {

            tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: red; padding: 20px;">Failed to load production schedules.</td></tr>';

        }

    }

}



function renderPlansTable(plans) {

    const tbody = document.getElementById('plansTableBody');

    if (!tbody) return;



    if (!plans || plans.length === 0) {

        tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 20px;">No production schedules found. Click "+ Create Plan" to add one.</td></tr>';

        return;

    }



    tbody.innerHTML = plans.map(plan => {

        const flavorTitle = plan.flavor_name || 'Standard Jelly Batch';

        const batchCode = plan.batch_code || 'PLN-0000';

        const totalCups = Number(plan.total_cups_produced || 0).toLocaleString();

        const totalUnits = `${totalCups} Cups`;

        

        let pickupTime = 'Pending Scheduled Pickup';

        if (plan.cooked_at) {

            const pDate = new Date(plan.cooked_at);

            pickupTime = pDate.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' }) + ' — ' +

                         pDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });

        }



        const flavorEscaped = escapeHtml(flavorTitle);

        const batchEscaped = escapeHtml(batchCode);

        const pickupEscaped = escapeHtml(pickupTime);



        return `

            <tr>

                <td>

                    <div class="cust-name-text">${flavorEscaped}</div>

                    <div class="cust-id-sub">Plan / Batch ID: ${batchEscaped}</div>

                    <div class="target-qty-tag">Target: ${totalUnits}</div>

                </td>

                <td>

                    <div class="schedule-text">Pick Up Date & Time:</div>

                    <div class="schedule-text"><strong>${pickupEscaped}</strong></div>

                </td>

                <td>

                    <span class="status-indicator-box completed">Completed</span>

                </td>

                <td>

                    <button class="view-profile-btn" onclick="openProductionModal(

                        '${batchEscaped}',

                        '${flavorEscaped}',

                        '${totalUnits}',

                        '${pickupEscaped}',

                        'Completed'

                    )">View Plan</button>

                </td>

            </tr>

        `;

    }).join('');

}



function populateRecipeDropdown(recipes) {

    const select = document.getElementById('recipeSelect');

    if (!select) return;



    if (!recipes || recipes.length === 0) {

        // Used to offer two made-up recipes ("Coffee Jelly Standard" id=1,

        // "Buko Pandan Jelly" id=2) as selectable options. Submitting one

        // would send a fabricated recipe_id into a real insert - if no

        // recipe with that id actually existed (or a different one did),

        // the created plan would silently reference the wrong thing.

        select.innerHTML = '<option value="">No recipes available</option>';

        select.disabled = true;

        return;

    }



    select.disabled = false;

    select.innerHTML = recipes.map(r => `

        <option value="${r.id}">

            ${escapeHtml(r.flavor_name)} (Yield: ${r.yield_servings} servings)

        </option>

    `).join('');

}



function populateSupervisorDropdown(staff) {

    const select = document.getElementById('supervisorSelect');

    if (!select) return;



    if (!staff || staff.length === 0) {

        // Same issue as the recipe dropdown - a hardcoded user id=1 could

        // attribute a batch to the wrong person.

        select.innerHTML = '<option value="">No active staff available</option>';

        select.disabled = true;

        return;

    }



    select.disabled = false;

    select.innerHTML = staff.map(s => `

        <option value="${s.id}">${escapeHtml(s.full_name)}</option>

    `).join('');

}



async function handleCreatePlan(e) {

    e.preventDefault();



    const recipe_id = document.getElementById('recipeSelect').value;

    const batch_code = document.getElementById('batchCodeInput').value.trim();

    const total_cups_produced = document.getElementById('totalCupsInput').value;

    const cooked_by = document.getElementById('supervisorSelect').value;



    if (!recipe_id || !total_cups_produced || !cooked_by) {

        alert('Please fill in all required fields. If the recipe or staff dropdown is empty, add a recipe or an active staff member first.');

        return;

    }



    try {

        const response = await fetch('/api/admin/create-plan', {

            method: 'POST',

            headers: { 'Content-Type': 'application/json' },

            body: JSON.stringify({

                recipe_id: parseInt(recipe_id, 10),

                batch_code: batch_code,

                total_cups_produced: parseInt(total_cups_produced, 10),

                cooked_by: parseInt(cooked_by, 10)

            })

        });



        const data = await response.json();

        if (data.status === 'success') {

            closeCreateModal();

            document.getElementById('createPlanForm').reset();

            fetchProductionPlanningData();

        } else {

            alert('Failed to create plan: ' + (data.message || 'Unknown error'));

        }

    } catch (error) {

        console.error('Error creating production plan:', error);

        alert('An error occurred while creating the plan.');

    }

}



function openCreateModal() {

    const modal = document.getElementById('createPlanModalOverlay');

    if (modal) {

        modal.classList.add('open');

        document.body.style.overflow = 'hidden';

    }

}



function closeCreateModal() {

    const modal = document.getElementById('createPlanModalOverlay');

    if (modal) {

        modal.classList.remove('open');

        document.body.style.overflow = '';

    }

}



function openProductionModal(id, prodName, qty, pickupDate, status) {

    document.getElementById('mBatchId').textContent = id;

    document.getElementById('mProdName').textContent = prodName;

    document.getElementById('mTargetQty').textContent = qty;

    document.getElementById('mPickupDate').textContent = pickupDate;

    document.getElementById('mStatus').textContent = status;



    const modal = document.getElementById('productionModalOverlay');

    if (modal) {

        modal.classList.add('open');

        document.body.style.overflow = 'hidden';

    }

}



function closeModal() {

    const modal = document.getElementById('productionModalOverlay');

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