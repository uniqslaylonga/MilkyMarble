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

        forgotPasswordLink.addEventListener('click', (e) => {
            e.preventDefault();
            openForgotPasswordFlow();
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
        <input type="password" id="fpNewPassword" class="swal2-input" placeholder="New password" style="margin:0 0 10px;">
        <input type="password" id="fpConfirmPassword" class="swal2-input" placeholder="Confirm new password" style="margin:0;">
      `,
            showCancelButton: true,
            confirmButtonText: 'Reset Password',
            cancelButtonText: 'Cancel',
            focusConfirm: false,
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
