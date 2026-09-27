let currentEmpData = null;
let allEmployees = [];
let filteredEmployees = [];
let currentEmpPage = 1;
const EMP_PAGE_SIZE = 5;

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
    fetchEmployeeRecordData();
    populateRoleSelect();

    // Real-time search filter
    document.getElementById('employeeSearchInput')?.addEventListener('input', applyEmployeeFilters);

    // Modal background overlays
    document.getElementById('employeeModalOverlay')?.addEventListener('click', (e) => {
        if (e.target.id === 'employeeModalOverlay') closeModal();
    });

    document.getElementById('addEmployeeModalOverlay')?.addEventListener('click', (e) => {
        if (e.target.id === 'addEmployeeModalOverlay') closeAddModal();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeModal();
            closeAddModal();
        }
    });

    // Form Handlers
    document.getElementById('addEmployeeForm')?.addEventListener('submit', handleAddEmployee);
    document.getElementById('editProfileForm')?.addEventListener('submit', handleEditEmployee);

    // Pagination buttons
    document.getElementById('prevEmpBtn')?.addEventListener('click', () => {
        if (currentEmpPage > 1) {
            currentEmpPage--;
            renderEmployeeTable();
        }
    });

    document.getElementById('nextEmpBtn')?.addEventListener('click', () => {
        const totalPages = Math.ceil(filteredEmployees.length / EMP_PAGE_SIZE) || 1;
        if (currentEmpPage < totalPages) {
            currentEmpPage++;
            renderEmployeeTable();
        }
    });
});

async function fetchEmployeeRecordData() {
    try {
        const userId = localStorage.getItem('userId') || sessionStorage.getItem('userId');
        const headers = userId ? { 'x-user-id': userId } : {};

        const response = await fetch('/api/admin/employee-records', { headers });
        if (!response.ok) throw new Error('Failed to retrieve employee records');

        const data = await response.json();

        // Admin Profile Setup
        const userFullNameEl = document.getElementById('userFullName');
        const userAvatarEl = document.getElementById('userAvatarImg');

        if (userFullNameEl) userFullNameEl.textContent = data.user?.fullName || 'Angeline J. Ang';
        if (userAvatarEl && data.user?.avatar) {
            userAvatarEl.src = data.user.avatar;
            userAvatarEl.onerror = function() { this.src = '/customer/images/account.png'; }; 
        }

        // Stats
        document.getElementById('totalHeadcount').textContent = Number(data.stats?.totalHeadcount || 0).toLocaleString();
        document.getElementById('activeToday').textContent = Number(data.stats?.activeToday || 0).toLocaleString();

        allEmployees = data.employees || [];
        applyEmployeeFilters();

    } catch (error) {
        console.error('Error fetching employee records:', error);
        MMSwal.fire({
            icon: 'warning',
            title: 'System Notice',
            text: error.message || 'Could not load staff records from server.'
        });
    }
}

function applyEmployeeFilters() {
    const q = document.getElementById('employeeSearchInput')?.value.toLowerCase().trim() || '';

    filteredEmployees = allEmployees.filter(emp => {
        if (q) {
            const name = (emp.full_name || '').toLowerCase();
            const code = (emp.employee_code || '').toLowerCase();
            const pos = (emp.position || emp.job_title || '').toLowerCase();
            const dept = (emp.department || '').toLowerCase();
            const email = (emp.email || '').toLowerCase();
            if (!name.includes(q) && !code.includes(q) && !pos.includes(q) && !dept.includes(q) && !email.includes(q)) {
                return false;
            }
        }
        return true;
    });

    const countEl = document.getElementById('visibleEmployeeCount');
    if (countEl) countEl.textContent = filteredEmployees.length;

    currentEmpPage = 1;
    renderEmployeeTable();
}

function renderEmployeeTable() {
    const tbody = document.getElementById('employeeTableBody');
    const pageInfo = document.getElementById('empPageInfo');
    const prevBtn = document.getElementById('prevEmpBtn');
    const nextBtn = document.getElementById('nextEmpBtn');

    if (!tbody) return;

    if (filteredEmployees.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="loading-state-text">No employee records match your search criteria.</td></tr>';
        if (pageInfo) pageInfo.textContent = 'Showing 0 of 0 staff';
        if (prevBtn) prevBtn.disabled = true;
        if (nextBtn) nextBtn.disabled = true;
        renderEmpPagerButtons(1, 1);
        return;
    }

    const totalPages = Math.ceil(filteredEmployees.length / EMP_PAGE_SIZE) || 1;
    const startIndex = (currentEmpPage - 1) * EMP_PAGE_SIZE;
    const pageItems = filteredEmployees.slice(startIndex, startIndex + EMP_PAGE_SIZE);

    if (pageInfo) {
        const startNum = startIndex + 1;
        const endNum = Math.min(startIndex + EMP_PAGE_SIZE, filteredEmployees.length);
        pageInfo.textContent = `Showing ${startNum}-${endNum} of ${filteredEmployees.length} staff`;
    }
    if (prevBtn) prevBtn.disabled = currentEmpPage <= 1;
    if (nextBtn) nextBtn.disabled = currentEmpPage >= totalPages;

    renderEmpPagerButtons(totalPages, currentEmpPage);

    tbody.innerHTML = pageItems.map(emp => {
        const avatarSrc = (emp.avatar && emp.avatar !== '/customer/images/account.png') ? emp.avatar : '/customer/images/account.png';
        const isActive = parseInt(emp.is_active || 0, 10) === 1;
        const roleName = emp.role_name || emp.position || 'Staff';

        return `
            <tr>
                <td>
                    <div class="cust-cell">
                        <div class="cust-avatar-sm">
                            <img src="${escapeHtml(avatarSrc)}" alt="${escapeHtml(emp.full_name)}" class="cust-avatar-img" onerror="this.onerror=null; this.src='/customer/images/account.png';">
                        </div>
                        <div>
                            <div class="cust-name-text">${escapeHtml(emp.full_name)}</div>
                            <div class="cust-id-sub">${escapeHtml(emp.employee_code || 'EMP-000')}</div>
                        </div>
                    </div>
                </td>
                <td>
                    <div class="role-text">${escapeHtml(emp.position || emp.job_title || 'Unassigned')}</div>
                    <div class="dept-sub">${escapeHtml(emp.department || 'Operations')}</div>
                </td>
                <td>
                    <span class="role-pill-badge">${escapeHtml(roleName)}</span>
                </td>
                <td>
                    <select class="status-dropdown ${isActive ? 'status-active' : 'status-inactive'}"
                        onchange="toggleEmployeeStatus(${emp.id}, this)">
                        <option value="1" ${isActive ? 'selected' : ''}>Active</option>
                        <option value="0" ${!isActive ? 'selected' : ''}>Inactive</option>
                    </select>
                </td>
                <td style="text-align: right;">
                    <button type="button" class="view-profile-btn" onclick="openEmployeeModalByData('${emp.id}')">
                        View Profile
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

function renderEmpPagerButtons(totalPages, activePage) {
    const pagerNumbers = document.getElementById('empPagerNumbers');
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
            if (page && page !== currentEmpPage) {
                currentEmpPage = page;
                renderEmployeeTable();
            }
        });
    });
}

async function toggleEmployeeStatus(empId, selectElement) {
    const isActive = selectElement.value;
    selectElement.className = 'status-dropdown ' + (isActive === '1' ? 'status-active' : 'status-inactive');

    try {
        const response = await fetch('/api/admin/employee-records/status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: empId, is_active: parseInt(isActive, 10) })
        });

        const data = await response.json();
        if (!data.success) {
            MMSwal.fire({
                icon: 'warning',
                title: 'Update Failed',
                text: data.message || 'Could not update employee status.'
            });
        }
    } catch (error) {
        console.error('Network error updating status:', error);
        MMSwal.fire({
            icon: 'warning',
            title: 'Network Error',
            text: 'Failed to update employee status on server.'
        });
    }
}

async function handleAddEmployee(e) {
    e.preventDefault();

    const form = document.getElementById('addEmployeeForm');
    const formData = new FormData(form);

    try {
        const response = await fetch('/api/admin/add-employee', {
            method: 'POST',
            body: formData
        });

        const data = await response.json();
        if (data.status === 'success') {
            closeAddModal();
            form.reset();
            await fetchEmployeeRecordData();

            MMSwal.fire({
                icon: 'success',
                title: 'Employee Registered',
                text: 'New staff profile and credentials have been established.'
            });
        } else {
            MMSwal.fire({
                icon: 'warning',
                title: 'Registration Error',
                text: data.message || 'Could not add employee.'
            });
        }
    } catch (error) {
        console.error('Error adding employee:', error);
        MMSwal.fire({
            icon: 'warning',
            title: 'Error',
            text: 'An error occurred while provisioning the account.'
        });
    }
}

async function handleEditEmployee(e) {
    e.preventDefault();

    const form = document.getElementById('editProfileForm');
    const formData = new FormData(form);

    try {
        const response = await fetch('/api/admin/edit-employee', {
            method: 'POST',
            body: formData
        });

        const data = await response.json();
        if (data.status === 'success') {
            closeModal();
            await fetchEmployeeRecordData();

            MMSwal.fire({
                icon: 'success',
                title: 'Profile Updated',
                text: 'Employee record changes saved successfully.'
            });
        } else {
            MMSwal.fire({
                icon: 'warning',
                title: 'Update Failed',
                text: data.message || 'Could not update employee.'
            });
        }
    } catch (error) {
        console.error('Error updating employee:', error);
        MMSwal.fire({
            icon: 'warning',
            title: 'Error',
            text: 'An error occurred while updating the employee.'
        });
    }
}

function openAddModal() {
    const modal = document.getElementById('addEmployeeModalOverlay');
    if (modal) {
        modal.classList.add('open');
        document.body.style.overflow = 'hidden';
        populateRoleSelect();
    }
}

async function populateRoleSelect() {
    const select = document.getElementById('addRoleSelect');
    if (!select) return;
    try {
        const response = await fetch('/api/admin/roles');
        const data = await response.json();
        if (data.status === 'success' && Array.isArray(data.roles) && data.roles.length > 0) {
            select.innerHTML = '<option value="">Select a role...</option>' +
                data.roles.map(r => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('');
        } else {
            select.innerHTML = '<option value="">No roles available</option>';
        }
    } catch (error) {
        console.error('Error loading roles:', error);
        select.innerHTML = '<option value="">Failed to load roles</option>';
    }
}

function closeAddModal() {
    const modal = document.getElementById('addEmployeeModalOverlay');
    if (modal) {
        modal.classList.remove('open');
        document.body.style.overflow = '';
    }
}

function openEmployeeModalByData(empId) {
    const empData = allEmployees.find(e => String(e.id) === String(empId));
    if (!empData) return;

    currentEmpData = empData;

    document.getElementById('editAvatarInput').value = '';
    document.getElementById('mEmpDbId').value = empData.id;
    document.getElementById('mUserDbId').value = empData.user_id || 0;

    document.getElementById('mEmpId').textContent = empData.employee_code || 'EMP-000';
    document.getElementById('mFullName').textContent = empData.full_name || '';
    document.getElementById('mGender').textContent = empData.gender || 'Male';
    document.getElementById('mJobTitle').textContent = empData.position || empData.job_title || 'Unassigned';
    document.getElementById('mDepartment').textContent = empData.department || 'Operations';
    document.getElementById('mDateCreated').textContent = empData.created_at ? new Date(empData.created_at).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    }) : 'N/A';
    document.getElementById('mEmpStatus').textContent = parseInt(empData.is_active || 0, 10) === 1 ? 'Active' : 'Inactive';
    document.getElementById('mUsername').textContent = empData.username || 'N/A';
    document.getElementById('mEmail').textContent = empData.email || 'N/A';
    
    const modalImg = document.getElementById('mAvatarImg');
    modalImg.src = empData.avatar || '/customer/images/account.png';
    modalImg.onerror = function() { this.src = '/customer/images/account.png'; };

    document.getElementById('inputFullName').value = empData.full_name || '';
    document.getElementById('inputGender').value = empData.gender || 'Male';
    document.getElementById('inputJobTitle').value = empData.job_title || '';
    document.getElementById('inputDepartment').value = empData.department || '';
    document.getElementById('inputUsername').value = empData.username || '';
    document.getElementById('inputEmail').value = empData.email || '';

    enableEditMode(false);

    const modal = document.getElementById('employeeModalOverlay');
    if (modal) {
        modal.classList.add('open');
        document.body.style.overflow = 'hidden';
    }
}

function enableEditMode(isEditing) {
    const card = document.getElementById('profileModalCard');
    const title = document.getElementById('modalTitleText');

    if (isEditing) {
        card.classList.add('is-editing');
        title.textContent = 'Edit Employee Profile';
    } else {
        card.classList.remove('is-editing');
        title.textContent = 'Employee Master Record';
        document.getElementById('editAvatarInput').value = '';
        if (currentEmpData) {
            const modalImg = document.getElementById('mAvatarImg');
            modalImg.src = currentEmpData.avatar || '/customer/images/account.png';
            modalImg.onerror = function() { this.src = '/customer/images/account.png'; };
        }
    }
}

function previewAvatar(input) {
    if (input.files && input.files[0]) {
        const reader = new FileReader();
        reader.onload = function(e) {
            document.getElementById('mAvatarImg').src = e.target.result;
        }
        reader.readAsDataURL(input.files[0]);
    }
}

async function handleDeleteEmployee() {
    if (!currentEmpData) return;

    const name = currentEmpData.full_name || 'this employee';

    const result = await MMSwal.fire({
        title: 'Remove Staff Account?',
        html: `Permanently delete <strong>"${escapeHtml(name)}"</strong> from the workforce directory? This action cannot be reversed.`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Yes, Remove Account',
        cancelButtonText: 'Cancel'
    });

    if (!result.isConfirmed) return;

    try {
        const response = await fetch('/api/admin/delete-employee', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: currentEmpData.user_id })
        });

        const data = await response.json();
        if (data.status === 'success') {
            closeModal();
            await fetchEmployeeRecordData();
            MMSwal.fire({
                icon: 'success',
                title: 'Account Removed',
                text: `${name} has been removed from workforce records.`
            });
        } else {
            MMSwal.fire({
                icon: 'warning',
                title: 'Deletion Failed',
                text: data.message || 'Could not remove employee account.'
            });
        }
    } catch (error) {
        console.error('Error deleting employee:', error);
        MMSwal.fire({
            icon: 'warning',
            title: 'Error',
            text: 'An error occurred while removing the employee.'
        });
    }
}

function closeModal() {
    const modal = document.getElementById('employeeModalOverlay');
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