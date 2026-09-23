document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('loginForm');
  const usernameInput = document.getElementById('username');
  const passwordInput = document.getElementById('password');
  const usernameError = document.getElementById('username-error');
  const passwordError = document.getElementById('password-error');
  const serverError = document.getElementById('server-error-msg');
  const submitBtn = document.getElementById('submitBtn');

  // SweetAlert modal wrapper
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

  // Toggle password input visibility
  document.querySelectorAll('.toggle-password').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-target');
      const input = document.getElementById(targetId);
      const eyeOpen = btn.querySelector('.eye-open');
      const eyeClosed = btn.querySelector('.eye-closed');

      if (input.type === 'password') {
        input.type = 'text';
        if (eyeOpen) eyeOpen.style.display = 'block';
        if (eyeClosed) eyeClosed.style.display = 'none';
      } else {
        input.type = 'password';
        if (eyeOpen) eyeOpen.style.display = 'none';
        if (eyeClosed) eyeClosed.style.display = 'block';
      }
    });
  });

  // Handle post-logout query parameters
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('logged_out') === '1') {
    showSweetAlert({
      title: 'Logged Out!',
      text: 'You have been safely logged out. See you again soon!',
      icon: 'success',
      confirmButtonText: 'Sweet'
    });
    cleanUrl();
  }

  // Clean URL parameters without reloading
  function cleanUrl() {
    const clean = window.location.protocol + "//" + window.location.host + window.location.pathname;
    window.history.replaceState({ path: clean }, '', clean);
  }

  // Toggle input field error message state
  function setFieldError(input, errorEl, message) {
    if (errorEl) errorEl.textContent = message;
    if (input) input.closest('.input-wrap').classList.toggle('has-error', !!message);
  }

  // Helper para i-sync ang kumpletong customer profile mula sa database
  async function syncAndSaveCustomerSession(userRecord) {
    const userId = userRecord.id || userRecord.user_id;
    let customerData = { ...userRecord };

    try {
      const profileRes = await fetch(`/api/customer/profile?customer_id=${encodeURIComponent(userId)}`, {
        credentials: 'include',
        headers: {
          'Accept': 'application/json',
          'x-customer-id': String(userId)
        }
      });

      if (profileRes.ok) {
        const profileResult = await profileRes.json();
        if (profileResult.status === 'success' && (profileResult.data || profileResult.customer)) {
          const cust = profileResult.data || profileResult.customer;
          const userObj = cust.users || cust;

          // Kunin ang avatar galing sa table join, root object, o user record
          const avatarUrl = userObj.avatar || cust.avatar || cust.avatar_url || cust.profile_picture || userRecord.avatar || userRecord.profile_picture || '';

          customerData = {
            ...userRecord,
            customer_id: cust.id || cust.customer_id || customerData.customer_id || userId,
            id: cust.id || customerData.id || userId,
            user_id: cust.user_id || userObj.id || userId,
            full_name: userObj.full_name || cust.full_name || userRecord.full_name || userRecord.username || '',
            username: userObj.username || cust.username || userRecord.username || '',
            avatar: avatarUrl,
            profile_picture: avatarUrl,
            loyalty_points: cust.loyalty_points || 0
          };
        }
      }
    } catch (profileErr) {
      console.warn('Could not pre-fetch full customer profile:', profileErr);
    }

    if (!customerData.customer_id) {
      customerData.customer_id = customerData.id || userId;
      customerData.user_id = userId;
    }

    if (!customerData.avatar && (userRecord.avatar || userRecord.profile_picture)) {
      customerData.avatar = userRecord.avatar || userRecord.profile_picture;
      customerData.profile_picture = customerData.avatar;
    }

    localStorage.setItem('mm_user', JSON.stringify(customerData));
  }

  // Handle login submission
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    let valid = true;
    const userInput = usernameInput.value.trim();
    const passInput = passwordInput.value;

    if (!userInput) {
      setFieldError(usernameInput, usernameError, 'Please enter your username or email.');
      valid = false;
    } else {
      setFieldError(usernameInput, usernameError, '');
    }

    if (!passInput) {
      setFieldError(passwordInput, passwordError, 'Please enter your password.');
      valid = false;
    } else {
      setFieldError(passwordInput, passwordError, '');
    }

    if (!valid) {
      showSweetAlert({
        title: 'Missing Fields',
        text: 'Please enter both your username/email and password to continue.',
        icon: 'warning',
        confirmButtonText: 'Got It'
      });
      return;
    }

    const originalBtn = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.innerText = 'Logging in...';
    if (serverError) serverError.style.display = 'none';

    try {
      // Authenticate against Express backend na may credentials (cookies)
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_or_email: userInput,
          password: passInput
        })
      });

      const textData = await response.text();
      let result;

      try {
        result = JSON.parse(textData);
      } catch (parseErr) {
        throw new Error(`Server error (${response.status}): Expected JSON response.`);
      }

      if (!response.ok || result.status !== 'success') {
        throw new Error(result.message || 'Invalid username or password.');
      }

      // I-sync ang session diretso sa database profile
      await syncAndSaveCustomerSession(result.user);

      // Redirect to home dashboard
      window.location.href = 'home.html?login=success';

    } catch (err) {
      if (serverError) {
        serverError.textContent = err.message;
        serverError.style.display = 'block';
      }
      showSweetAlert({
        title: 'Login Failed',
        text: err.message,
        icon: 'error',
        confirmButtonText: 'Try Again'
      });
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalBtn;
    }
  });

  // Initialize Google OAuth client
  if (typeof google !== 'undefined') {
    google.accounts.id.initialize({
      client_id: "1077352091553-6d77b0rtu3km8r1har7ra3lsmbf5en35.apps.googleusercontent.com",
      callback: handleGoogleCredentialResponse,
      auto_select: false
    });

    const hiddenDiv = document.getElementById('googleButtonHidden');
    if (hiddenDiv) {
      google.accounts.id.renderButton(hiddenDiv, {
        type: 'standard',
        shape: 'rectangular',
        theme: 'outline',
        text: 'signin_with',
        size: 'large'
      });
    }
  }

  // Make the visible, styled Google button trigger the real (hidden) GSI button
  const btnGoogleLogin = document.getElementById('btnGoogleLogin');
  if (btnGoogleLogin) {
    btnGoogleLogin.addEventListener('click', () => {
      const hiddenDiv = document.getElementById('googleButtonHidden');
      const hiddenBtn = hiddenDiv && hiddenDiv.querySelector('div[role="button"]');
      if (hiddenBtn) {
        hiddenBtn.click();
      } else {
        showSweetAlert({
          title: 'Google Sign-In Unavailable',
          text: 'Google Sign-In is still loading. Please wait a moment and try again.',
          icon: 'info',
          confirmButtonText: 'OK'
        });
      }
    });
  }

  // Handle Google OAuth callback
  async function handleGoogleCredentialResponse(response) {
    if (!response || !response.credential) return;

    try {
      const res = await fetch('/api/auth/google', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential: response.credential })
      });

      const data = await res.json();
      if (!res.ok || data.status !== 'success') {
        throw new Error(data.message || 'Google sign-in failed.');
      }

      await syncAndSaveCustomerSession(data.user);
      window.location.href = 'home.html?login=success';
    } catch (err) {
      showSweetAlert({
        title: 'Google Sign-In Error',
        text: err.message,
        icon: 'error',
        confirmButtonText: 'OK'
      });
    }
  }

  // ==========================================
  // FORGOT PASSWORD FLOW
  // ==========================================
  const forgotPasswordLink = document.getElementById('forgotPasswordLink');
  if (forgotPasswordLink) {
    forgotPasswordLink.addEventListener('click', (e) => {
      e.preventDefault();
      openForgotPasswordFlow();
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
});