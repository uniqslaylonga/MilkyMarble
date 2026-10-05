document.addEventListener('DOMContentLoaded', () => {
    
    // Password toggle setup
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

    // Form submit handler
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', handleLogin);
    }
});

async function handleLogin(e) {
    e.preventDefault();

    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');
    const errorBanner = document.getElementById('errorMessage');

    const username = usernameInput.value.trim();
    const password = passwordInput.value.trim();

    if (!username || !password) {
        showError('Please enter both username and password.');
        return;
    }

    try {
        const response = await fetch('/api/management/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        const data = await response.json();

        if (data.status === 'success') {
            if (errorBanner) errorBanner.style.display = 'none';
            
            // Save user ID to localStorage so dashboards can load specific profiles[cite: 18]
            if (data.user && data.user.id) {
                localStorage.setItem('userId', data.user.id);
            }

            // Redirect based on role[cite: 18]
            if (data.role === 'ceo') {
                window.location.href = 'ceo/dashboard.html';
            } else if (data.role === 'admin') {
                window.location.href = 'admin/dashboard.html';
            } else {
                window.location.href = data.redirectUrl || 'admin/dashboard.html';
            }
        } else {
            showError(data.message || 'Invalid username or password.');
        }
    } catch (error) {
        console.error('Login error:', error);
        showError('Database connection error. Please try again.');
    }
}

function showError(msg) {
    const errorBanner = document.getElementById('errorMessage');
    if (errorBanner) {
        errorBanner.textContent = msg;
        errorBanner.style.display = 'block';
    } else {
        alert(msg);
    }
}