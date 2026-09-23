document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.toggle-password').forEach(btn => {
        btn.addEventListener('click', () => {
            const input = document.getElementById(btn.dataset.target);
            const eyeOpen = btn.querySelector('.eye-open');
            const eyeClosed = btn.querySelector('.eye-closed');

            if (input.type === 'password') {
                input.type = 'text';
                eyeOpen.style.display = 'block';
                eyeClosed.style.display = 'none';
                btn.setAttribute('aria-label', 'Hide password');
            } else {
                input.type = 'password';
                eyeOpen.style.display = 'none';
                eyeClosed.style.display = 'block';
                btn.setAttribute('aria-label', 'Show password');
            }
        });
    });

    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', handleLogin);
    }
});

async function handleLogin(e) {
    e.preventDefault();

    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');
    const submitBtn = document.getElementById('submitBtn');

    const username = usernameInput.value.trim();
    const password = passwordInput.value;

    if (!username || !password) {
        showError('Please enter both username and password.');
        return;
    }

    hideError();
    submitBtn.disabled = true;
    submitBtn.textContent = 'Logging in...';

    try {
        const response = await fetch('/api/auth/employee-login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        const result = await response.json();

        if (response.ok && result.status === 'success') {
            // Save the ID so all dashboards know who is logged in!
            localStorage.setItem('userId', result.user.id);
            window.location.href = result.redirectUrl;
        } else {
            showError(result.message || 'Login failed. Please check your credentials.');
        }
    } catch (error) {
        console.error('Login request error:', error);
        showError('Network error. Unable to connect to backend.');
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = 'Log In &nbsp;→';
    }
}

function showError(msg) {
    const errorMsgEl = document.getElementById('errorMsg');
    if (errorMsgEl) {
        errorMsgEl.textContent = msg;
        errorMsgEl.style.display = 'block';
    }
}

function hideError() {
    const errorMsgEl = document.getElementById('errorMsg');
    if (errorMsgEl) {
        errorMsgEl.style.display = 'none';
        errorMsgEl.textContent = '';
    }
}