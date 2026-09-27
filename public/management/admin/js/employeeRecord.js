let currentEmpData = null;

let allEmployees = [];



document.addEventListener('DOMContentLoaded', () => {

    fetchEmployeeRecordData();

    populateRoleSelect();



    // Real-time search filter

    const searchInput = document.getElementById('employeeSearchInput');

    if (searchInput) {

        searchInput.addEventListener('input', function() {

            const q = this.value.toLowerCase().trim();

            const rows = document.querySelectorAll('#employeeTableBody tr');

            rows.forEach(row => {

                const text = row.textContent.toLowerCase();

                row.style.display = (!q || text.includes(q)) ? '' : 'none';

            });

        });

    }



    // Modal background overlays

    const empModalOverlay = document.getElementById('employeeModalOverlay');

    if (empModalOverlay) {

        empModalOverlay.addEventListener('click', (e) => {

            if (e.target.id === 'employeeModalOverlay') closeModal();

        });

    }



    const addModalOverlay = document.getElementById('addEmployeeModalOverlay');

    if (addModalOverlay) {

        addModalOverlay.addEventListener('click', (e) => {

            if (e.target.id === 'addEmployeeModalOverlay') closeAddModal();

        });

    }



    document.addEventListener('keydown', (e) => {

        if (e.key === 'Escape') {

            closeModal();

            closeAddModal();

        }

    });



    // Form Handlers

    document.getElementById('addEmployeeForm')?.addEventListener('submit', handleAddEmployee);

    document.getElementById('editProfileForm')?.addEventListener('submit', handleEditEmployee);

});



async function fetchEmployeeRecordData() {

    try {

        // Grab logged-in user ID to fetch accurate profile details

        const userId = localStorage.getItem('userId');

        const headers = userId ? { 'x-user-id': userId } : {};



        const response = await fetch('/api/admin/employee-records', { headers });

        if (!response.ok) throw new Error('Failed to load employee records');



        const data = await response.json();



        // Admin Profile Setup

        const userFullNameEl = document.getElementById('userFullName');

        const userAvatarEl = document.getElementById('userAvatarImg');



        if (userFullNameEl) userFullNameEl.textContent = data.user.fullName;

        if (userAvatarEl && data.user.avatar) {

            userAvatarEl.src = data.user.avatar;

            userAvatarEl.onerror = function() { this.src = '/customer/images/account.png'; }; 

        }



        // Stats

        document.getElementById('totalHeadcount').textContent = Number(data.stats.totalHeadcount || 0).toLocaleString();

        document.getElementById('activeToday').textContent = Number(data.stats.activeToday || 0).toLocaleString();



        // Employee Directory

        allEmployees = data.employees || [];

        renderEmployeeTable(allEmployees);



    } catch (error) {

        console.error('Error fetching employee records:', error);

        const tbody = document.getElementById('employeeTableBody');

        if (tbody) {

            tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: red; padding: 20px;">Failed to load employee records.</td></tr>';

        }

    }

}



function renderEmployeeTable(employees) {

    const tbody = document.getElementById('employeeTableBody');

    if (!tbody) return;



    if (!employees || employees.length === 0) {

        tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 20px;">No employee records found.</td></tr>';

        return;

    }



    tbody.innerHTML = employees.map(emp => {

        const avatarSrc = (emp.avatar && emp.avatar !== '//customer/images/account.png') ? emp.avatar : '/customer/images/account.png';

        const isActive = parseInt(emp.is_active || 0, 10) === 1;



        return `

            <tr>

                <td>

                    <div class="cust-cell">

                        <div class="cust-avatar-sm">

                            <img src="${escapeHtml(avatarSrc)}" alt="${escapeHtml(emp.full_name)}" class="cust-avatar-img" onerror="this.onerror=null; this.src='/customer/images/account.png';">

                        </div>

                        <div>

                            <div class="cust-name-text">${escapeHtml(emp.full_name)}</div>

                            <div class="cust-id-sub">${escapeHtml(emp.employee_code || '')}</div>

                        </div>

                    </div>

                </td>

                <td>

                    <div class="role-text">${escapeHtml(emp.position || emp.job_title || 'Unassigned')}</div>

                    <div class="dept-sub">${escapeHtml(emp.department || 'General')}</div>

                </td>

                <td>

                    <select class="status-dropdown ${isActive ? 'status-active' : 'status-inactive'}"

                        onchange="toggleEmployeeStatus(${emp.id}, this)">

                        <option value="1" ${isActive ? 'selected' : ''}>Active</option>

                        <option value="0" ${!isActive ? 'selected' : ''}>Inactive</option>

                    </select>

                </td>

                <td>

                    <button class="view-profile-btn" onclick="openEmployeeModalByData('${emp.id}')">View Profile</button>

                </td>

            </tr>

        `;

    }).join('');

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

            alert('Failed to update status.');

        }

    } catch (error) {

        console.error('Network error updating employee status:', error);

        alert('Network error updating status.');

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

            fetchEmployeeRecordData();

        } else {

            alert('Failed to add employee: ' + (data.message || 'Unknown error'));

        }

    } catch (error) {

        console.error('Error adding employee:', error);

        alert('An error occurred while adding the employee.');

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

            fetchEmployeeRecordData();

        } else {

            alert('Failed to update employee: ' + (data.message || 'Unknown error'));

        }

    } catch (error) {

        console.error('Error updating employee:', error);

        alert('An error occurred while updating the employee.');

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



// Loads the same predefined role list used across management pages (roles

// table, excluding CEO) and fills the Add Employee "Role" dropdown with it.

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

    document.getElementById('mDepartment').textContent = empData.department || 'General';

    document.getElementById('mDateCreated').textContent = empData.created_at ? new Date(empData.created_at).toLocaleDateString('en-US', {

        month: 'short',

        day: 'numeric',

        year: 'numeric'

    }) : 'N/A';

    document.getElementById('mEmpStatus').textContent = parseInt(empData.is_active || 0, 10) === 1 ? 'Active' : 'Inactive';

    document.getElementById('mUsername').textContent = empData.username || 'N/A';

    document.getElementById('mEmail').textContent = empData.email || 'N/A';

    

    // Set up modal image with fallback

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



    const result = await Swal.fire({

        title: 'Are you sure?',

        text: `This will permanently remove ${name}'s account, profile, and role assignment. This cannot be undone.`,

        icon: 'warning',

        showCancelButton: true,

        confirmButtonText: 'Yes, remove',

        cancelButtonText: 'Cancel',

        reverseButtons: true,

        buttonsStyling: false,

        customClass: {

            container: 'mm-swal-container-top',

            popup: 'mm-swal-popup',

            icon: 'mm-swal-icon',

            title: 'mm-swal-title',

            htmlContainer: 'mm-swal-html',

            actions: 'mm-swal-actions',

            confirmButton: 'mm-swal-confirm-btn',

            cancelButton: 'mm-swal-cancel-btn'

        }

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

            fetchEmployeeRecordData();

            Swal.fire({

                title: 'Removed',

                text: `${name} has been removed.`,

                icon: 'success',

                buttonsStyling: false,

                customClass: {

                    container: 'mm-swal-container-top',

                    popup: 'mm-swal-popup',

                    icon: 'mm-swal-icon',

                    title: 'mm-swal-title',

                    htmlContainer: 'mm-swal-html',

                    actions: 'mm-swal-actions',

                    confirmButton: 'mm-swal-confirm-btn'

                }

            });

        } else {

            Swal.fire({

                title: 'Failed to remove employee',

                text: data.message || 'Unknown error',

                icon: 'error',

                buttonsStyling: false,

                customClass: {

                    container: 'mm-swal-container-top',

                    popup: 'mm-swal-popup',

                    icon: 'mm-swal-icon',

                    title: 'mm-swal-title',

                    htmlContainer: 'mm-swal-html',

                    actions: 'mm-swal-actions',

                    confirmButton: 'mm-swal-confirm-btn'

                }

            });

        }

    } catch (error) {

        console.error('Error deleting employee:', error);

        Swal.fire({

            title: 'Something went wrong',

            text: 'An error occurred while removing the employee.',

            icon: 'error',

            buttonsStyling: false,

            customClass: {

                container: 'mm-swal-container-top',

                popup: 'mm-swal-popup',

                icon: 'mm-swal-icon',

                title: 'mm-swal-title',

                htmlContainer: 'mm-swal-html',

                actions: 'mm-swal-actions',

                confirmButton: 'mm-swal-confirm-btn'

            }

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