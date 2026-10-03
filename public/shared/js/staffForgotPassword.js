// public/shared/js/staffForgotPassword.js
//
// Wires up the "Forgot password?" link on the management and employee login
// pages. It was previously a dead <a href="#"> with no click handler at all.
//
// This mirrors the customer flow in public/customer/js/login.js exactly
// (same two SweetAlert steps, same "mm-swal-*" visual theme) and reuses the
// SAME backend endpoints:
//   POST /api/customer/request-password-otp  (email -> OTP sent)
//   POST /api/customer/forgot-password       (email + otp + new_password -> reset)
// Those endpoints only ever look up the account by email in the shared
// `users` table - they don't check user_type - so they work unchanged for
// admin/ceo/employee accounts, not just customers.
(function () {
    document.addEventListener('DOMContentLoaded', () => {
        const forgotPasswordLink = document.getElementById('forgotPasswordLink');
        if (!forgotPasswordLink) return;

        // Employee portal: forgotten passwords go through an admin ticket.
        // Management login (admin/CEO) keeps the email security-code flow,
        // since there is no higher admin to send their ticket to.
        const isEmployeePortal = /\/employee\/login/i.test(window.location.pathname);

        forgotPasswordLink.addEventListener('click', (e) => {
            e.preventDefault();
            if (isEmployeePortal) openTicketFlow();
            else openForgotPasswordFlow();
        });
    });

    function showSweetAlert(options) {
        if (typeof Swal === 'undefined') return Promise.resolve({ isConfirmed: false });

        return Swal.fire({
            target: document.body,
            customClass: {
                container: 'mm-swal-container-top',
                popup: 'mm-swal-popup',
                title: 'mm-swal-title',
                htmlContainer: 'mm-swal-html',
                actions: 'mm-swal-actions',
                confirmButton: 'mm-swal-confirm-btn',
                cancelButton: 'mm-swal-cancel-btn'
            },
            buttonsStyling: false,
            ...options
        });
    }

    async function openTicketFlow() {
        const typedUsername = (document.getElementById('username') || {}).value || '';
        const { value: form, isConfirmed } = await showSweetAlert({
            title: 'Forgot Password?',
            html: `
        <p style="font-size:13.5px;color:#7C4F38;margin:0 0 14px;text-align:left;">
          Send a request to your admin. They will verify it's you and give you a new password.
        </p>
        <input type="text" id="tkUsername" class="swal2-input" placeholder="Your username" style="margin:0 0 10px;">
        <textarea id="tkNote" class="swal2-textarea" placeholder="Note for the admin (optional)" maxlength="300" style="margin:0;"></textarea>
      `,
            showCancelButton: true,
            confirmButtonText: 'Send Request',
            cancelButtonText: 'Cancel',
            focusConfirm: false,
            didOpen: () => { document.getElementById('tkUsername').value = typedUsername.trim(); },
            preConfirm: () => {
                const username = document.getElementById('tkUsername').value.trim();
                const note = document.getElementById('tkNote').value.trim();
                if (!username) {
                    Swal.showValidationMessage('Please enter your username.');
                    return false;
                }
                return { username, note };
            }
        });

        if (!isConfirmed || !form) return;

        try {
            const res = await fetch('/api/staff/password-ticket', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(form)
            });
            const data = await res.json();
            if (!res.ok || data.status !== 'success') {
                throw new Error(data.message || 'Could not send your request.');
            }
            showSweetAlert({
                title: data.already_pending ? 'Already Requested' : 'Request Sent!',
                text: data.message,
                icon: 'success',
                confirmButtonText: 'OK'
            });
        } catch (err) {
            showSweetAlert({
                title: 'Could Not Send Request',
                text: err.message,
                icon: 'error',
                confirmButtonText: 'OK'
            });
        }
    }

    async function openForgotPasswordFlow() {
        const { value: email, isConfirmed } = await showSweetAlert({
            title: 'Forgot Password?',
            html: `
        <p style="font-size:13.5px;color:#7C4F38;margin:0 0 14px;text-align:left;">
          Enter your account email and we'll send you a security code to reset your password.
        </p>
        <input type="email" id="fpEmail" class="swal2-input" placeholder="Registered email address" style="margin:0;">
      `,
            showCancelButton: true,
            confirmButtonText: 'Send Code',
            cancelButtonText: 'Cancel',
            focusConfirm: false,
            preConfirm: () => {
                const val = document.getElementById('fpEmail').value.trim();
                if (!val) {
                    Swal.showValidationMessage('Please enter your email address.');
                    return false;
                }
                return val;
            }
        });

        if (!isConfirmed || !email) return;

        try {
            const res = await fetch('/api/customer/request-password-otp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email })
            });
            const data = await res.json();
            if (!res.ok || data.status !== 'success') {
                throw new Error(data.message || 'Could not send security code.');
            }
            openResetPasswordStep(email);
        } catch (err) {
            showSweetAlert({
                title: 'Could Not Send Code',
                text: err.message,
                icon: 'error',
                confirmButtonText: 'OK'
            });
        }
    }

    async function openResetPasswordStep(email) {
        const { value: formValues, isConfirmed } = await showSweetAlert({
            title: 'Reset Your Password',
            html: `
        <p style="font-size:13.5px;color:#7C4F38;margin:0 0 14px;text-align:left;">
          We sent a 6-digit code to <b>${email}</b>. Enter it below along with your new password.
        </p>
        <input type="text" id="fpOtp" class="swal2-input" placeholder="6-digit code" maxlength="6" style="margin:0 0 10px;">
        <div class="mm-pw-wrap" style="margin:0 0 10px;"><input type="password" id="fpNewPassword" class="swal2-input" placeholder="New password"><button type="button" class="mm-pw-toggle" data-target="fpNewPassword" aria-label="Show password"><svg class="eye-open" viewBox="0 0 40 40" width="20" height="20" style="display:none"><path d="M8 20 C11 13 15.5 10 20 10 C24.5 10 29 13 32 20 C29 27 24.5 30 20 30 C15.5 30 11 27 8 20 Z" fill="none" stroke="#ffffff" stroke-width="2.3" stroke-linejoin="round" /><circle cx="20" cy="20" r="5" fill="#ffffff" /></svg><svg class="eye-closed" viewBox="0 0 40 40" width="20" height="20"><path d="M8 20 C11 13 15.5 10 20 10 C24.5 10 29 13 32 20 C29 27 24.5 30 20 30 C15.5 30 11 27 8 20 Z" fill="none" stroke="#ffffff" stroke-width="2.3" stroke-linejoin="round" /><circle cx="20" cy="20" r="5" fill="#ffffff" /><line x1="9" y1="31" x2="31" y2="9" stroke="#F69299" stroke-width="3.4" stroke-linecap="round" /><line x1="9" y1="31" x2="31" y2="9" stroke="#ffffff" stroke-width="2" stroke-linecap="round" /></svg></button></div>
        <div class="mm-pw-wrap" style="margin:0;"><input type="password" id="fpConfirmPassword" class="swal2-input" placeholder="Confirm new password"><button type="button" class="mm-pw-toggle" data-target="fpConfirmPassword" aria-label="Show password"><svg class="eye-open" viewBox="0 0 40 40" width="20" height="20" style="display:none"><path d="M8 20 C11 13 15.5 10 20 10 C24.5 10 29 13 32 20 C29 27 24.5 30 20 30 C15.5 30 11 27 8 20 Z" fill="none" stroke="#ffffff" stroke-width="2.3" stroke-linejoin="round" /><circle cx="20" cy="20" r="5" fill="#ffffff" /></svg><svg class="eye-closed" viewBox="0 0 40 40" width="20" height="20"><path d="M8 20 C11 13 15.5 10 20 10 C24.5 10 29 13 32 20 C29 27 24.5 30 20 30 C15.5 30 11 27 8 20 Z" fill="none" stroke="#ffffff" stroke-width="2.3" stroke-linejoin="round" /><circle cx="20" cy="20" r="5" fill="#ffffff" /><line x1="9" y1="31" x2="31" y2="9" stroke="#F69299" stroke-width="3.4" stroke-linecap="round" /><line x1="9" y1="31" x2="31" y2="9" stroke="#ffffff" stroke-width="2" stroke-linecap="round" /></svg></button></div>
      `,
            showCancelButton: true,
            confirmButtonText: 'Reset Password',
            cancelButtonText: 'Cancel',
            focusConfirm: false,
            didOpen: (popup) => {
            popup.querySelectorAll('.mm-pw-toggle').forEach((btn) => {
              btn.addEventListener('click', () => {
                const input = document.getElementById(btn.getAttribute('data-target'));
                const eyeOpen = btn.querySelector('.eye-open');
                const eyeClosed = btn.querySelector('.eye-closed');
                const show = input.type === 'password';
                input.type = show ? 'text' : 'password';
                btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
                if (eyeOpen) eyeOpen.style.display = show ? 'block' : 'none';
                if (eyeClosed) eyeClosed.style.display = show ? 'none' : 'block';
              });
            });
            },
            preConfirm: () => {
                const otp = document.getElementById('fpOtp').value.trim();
                const pass = document.getElementById('fpNewPassword').value;
                const confirmPass = document.getElementById('fpConfirmPassword').value;

                if (!otp || otp.length !== 6) {
                    Swal.showValidationMessage('Please enter the 6-digit code from your email.');
                    return false;
                }
                if (!pass || pass.length < 6) {
                    Swal.showValidationMessage('Password must be at least 6 characters.');
                    return false;
                }
                if (pass !== confirmPass) {
                    Swal.showValidationMessage('Passwords do not match.');
                    return false;
                }
                return { otp, pass };
            }
        });

        if (!isConfirmed || !formValues) return;

        try {
            const res = await fetch('/api/customer/forgot-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, otp_code: formValues.otp, new_password: formValues.pass })
            });
            const data = await res.json();
            if (!res.ok || data.status !== 'success') {
                throw new Error(data.message || 'Could not reset password.');
            }
            showSweetAlert({
                title: 'Password Reset!',
                text: 'Your password has been changed. You can now log in with your new password.',
                icon: 'success',
                confirmButtonText: 'Log In'
            });
        } catch (err) {
            showSweetAlert({
                title: 'Reset Failed',
                text: err.message,
                icon: 'error',
                confirmButtonText: 'Try Again'
            });
        }
    }
})();