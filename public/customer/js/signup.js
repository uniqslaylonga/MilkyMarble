document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('signupForm');
  const steps = Array.from(document.querySelectorAll('.form-step'));
  const dots = Array.from(document.querySelectorAll('.step-dot'));
  const serverError = document.getElementById('server-error-msg');
  const submitBtn = document.getElementById('submitBtn');

  const fullnameInput = document.getElementById('fullname');
  const usernameInput = document.getElementById('username');
  const emailInput = document.getElementById('email');
  const passwordInput = document.getElementById('password');
  const confirmPasswordInput = document.getElementById('confirm_password');

  const fullnameError = document.getElementById('fullname-error');
  const usernameError = document.getElementById('username-error');
  const emailError = document.getElementById('email-error');
  const passwordError = document.getElementById('password-error');
  const confirmPasswordError = document.getElementById('confirm-password-error');

  let currentStep = 1;

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

  // Toggle input field error message state
  function setFieldError(input, errorEl, message) {
    if (errorEl) errorEl.textContent = message;
    if (input) input.closest('.input-wrap').classList.toggle('has-error', !!message);
  }

  // Show only the requested step, update dots
  function goToStep(stepNum) {
    steps.forEach((stepEl) => {
      stepEl.hidden = Number(stepEl.dataset.step) !== stepNum;
    });

    dots.forEach((dot) => {
      const dotNum = Number(dot.dataset.dot);
      dot.classList.toggle('active', dotNum === stepNum);
      dot.classList.toggle('completed', dotNum < stepNum);
    });

    currentStep = stepNum;
  }

  // Validate the fields belonging to the current step; returns true if OK
  function validateStep(stepNum) {
    let valid = true;

    if (stepNum === 1) {
      const fullnameVal = fullnameInput.value.trim();
      const usernameVal = usernameInput.value.trim();

      if (!fullnameVal) {
        setFieldError(fullnameInput, fullnameError, 'Please enter your full name.');
        valid = false;
      } else {
        setFieldError(fullnameInput, fullnameError, '');
      }

      if (!usernameVal) {
        setFieldError(usernameInput, usernameError, 'Please choose a username.');
        valid = false;
      } else {
        setFieldError(usernameInput, usernameError, '');
      }
    }

    if (stepNum === 2) {
      const emailVal = emailInput.value.trim();
      const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

      if (!emailVal) {
        setFieldError(emailInput, emailError, 'Please enter your email address.');
        valid = false;
      } else if (!emailPattern.test(emailVal)) {
        setFieldError(emailInput, emailError, 'Please enter a valid email address.');
        valid = false;
      } else {
        setFieldError(emailInput, emailError, '');
      }
    }

    if (stepNum === 3) {
      const passVal = passwordInput.value;
      const confirmVal = confirmPasswordInput.value;

      if (!passVal || passVal.length < 6) {
        setFieldError(passwordInput, passwordError, 'Password must be at least 6 characters.');
        valid = false;
      } else {
        setFieldError(passwordInput, passwordError, '');
      }

      if (!confirmVal) {
        setFieldError(confirmPasswordInput, confirmPasswordError, 'Please confirm your password.');
        valid = false;
      } else if (confirmVal !== passVal) {
        setFieldError(confirmPasswordInput, confirmPasswordError, 'Passwords do not match.');
        valid = false;
      } else {
        setFieldError(confirmPasswordInput, confirmPasswordError, '');
      }
    }

    return valid;
  }

  // Wire up all "Next" buttons
  document.querySelectorAll('[data-next]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!validateStep(currentStep)) return;
      goToStep(Math.min(currentStep + 1, steps.length));
    });
  });

  // Wire up all "Back" buttons
  document.querySelectorAll('[data-back]').forEach((btn) => {
    btn.addEventListener('click', () => {
      goToStep(Math.max(currentStep - 1, 1));
    });
  });

  // Helper para i-sync ang kumpletong customer profile mula sa database
  async function syncAndSaveCustomerSession(userRecord) {
    const userId = userRecord.id || userRecord.user_id;
    let customerData = userRecord;

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
          customerData = {
            ...userRecord,
            customer_id: cust.id,
            id: cust.id,
            user_id: cust.user_id || userId,
            full_name: cust.full_name || userRecord.full_name || userRecord.username || '',
            username: cust.username || userRecord.username || '',
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

    localStorage.setItem('mm_user', JSON.stringify(customerData));
  }

  // Handle signup submission (fires on step 3's submit button)
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (!validateStep(3)) return;

    const payload = {
      fullname: fullnameInput.value.trim(),
      username: usernameInput.value.trim(),
      email: emailInput.value.trim(),
      password: passwordInput.value
    };

    const originalText = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.innerText = 'Creating account...';
    if (serverError) serverError.style.display = 'none';

    try {
      const response = await fetch('/api/auth/signup', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const textData = await response.text();
      let result;

      try {
        result = JSON.parse(textData);
      } catch (parseErr) {
        throw new Error(`Server error (${response.status}): Expected JSON response.`);
      }

      if (!response.ok || result.status !== 'success') {
        throw new Error(result.message || 'Could not create your account.');
      }

      await syncAndSaveCustomerSession(result.user);

      await showSweetAlert({
        title: 'Welcome to Milky Marble!',
        text: 'Your account has been created successfully.',
        icon: 'success',
        confirmButtonText: 'Sweet'
      });

      window.location.href = 'home.html?login=success';

    } catch (err) {
      if (serverError) {
        serverError.textContent = err.message;
        serverError.style.display = 'block';
      }
      showSweetAlert({
        title: 'Sign Up Failed',
        text: err.message,
        icon: 'error',
        confirmButtonText: 'Try Again'
      });
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalText;
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
        text: 'signup_with',
        size: 'large'
      });
    }
  }

  const btnGoogleLogin = document.getElementById('btnGoogleLogin');
  if (btnGoogleLogin) {
    btnGoogleLogin.addEventListener('click', () => {
      const hiddenDiv = document.getElementById('googleButtonHidden');
      const hiddenBtn = hiddenDiv && hiddenDiv.querySelector('div[role="button"]');
      if (hiddenBtn) hiddenBtn.click();
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
        throw new Error(data.message || 'Google sign-up failed.');
      }

      await syncAndSaveCustomerSession(data.user);
      window.location.href = 'home.html?login=success';
    } catch (err) {
      showSweetAlert({
        title: 'Google Sign-Up Error',
        text: err.message,
        icon: 'error',
        confirmButtonText: 'OK'
      });
    }
  }

  // Start on step 1
  goToStep(1);
});