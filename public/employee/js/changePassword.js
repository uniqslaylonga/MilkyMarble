// public/employee/js/changePassword.js
// Forced "choose your own password" step after logging in with a temporary
// password issued by an admin (see /api/staff/change-password in server.js).
document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('changeForm');
    if (!form) return;

    // Show / hide password toggles
    document.querySelectorAll('.toggle-password').forEach(btn => {
        btn.addEventListener('click', () => {
            const input = document.getElementById(btn.dataset.target);
            const eyeOpen = btn.querySelector('.eye-open');
            const eyeClosed = btn.querySelector('.eye-closed');
            const show = input.type === 'password';
            input.type = show ? 'text' : 'password';
            eyeOpen.style.display = show ? 'block' : 'none';
            eyeClosed.style.display = show ? 'none' : 'block';
            btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
        });
    });

    // Enter in any field submits the form
    form.querySelectorAll('input').forEach(input => {
        input.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter') {
                ev.preventDefault();
                form.requestSubmit();
            }
        });
    });

    const submitBtn = document.getElementById('submitBtn');
    const errorEl = document.getElementById('errorMsg');

    function showError(msg) {
        errorEl.textContent = msg;
        errorEl.style.display = 'block';
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        errorEl.style.display = 'none';

        const current_password = document.getElementById('currentPassword').value;
        const new_password = document.getElementById('newPassword').value;
        const confirm_password = document.getElementById('confirmPassword').value;

        if (new_password.length < 8) return showError('Your new password must be at least 8 characters.');
        if (new_password !== confirm_password) return showError('The new passwords do not match.');
        if (new_password === current_password) return showError('Your new password must be different from the temporary one.');

        submitBtn.disabled = true;
        submitBtn.textContent = 'Saving...';

        try {
            const res = await fetch('/api/staff/change-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ current_password, new_password, confirm_password })
            });
            const data = await res.json().catch(() => ({}));

            if (res.ok && data.status === 'success') {
                let next = '';
                try { next = sessionStorage.getItem('mmNextUrl') || ''; } catch (err) {}
                try { sessionStorage.removeItem('mmNextUrl'); sessionStorage.removeItem('mmTempUser'); } catch (err) {}
                window.location.href = next || 'login.html';
                return;
            }
            if (res.status === 401) {
                window.location.href = 'login.html?error=login_required';
                return;
            }
            showError(data.message || 'Could not update your password.');
        } catch (err) {
            showError('Network error. Unable to connect to the server.');
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = 'Save Password &nbsp;→';
        }
    });
});