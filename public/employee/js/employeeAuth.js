// public/employee/js/employeeAuth.js
//
// Shared by the Finance, Inventory and Production dashboards.
//
// The employee API (src/routes/employeeRoutes.js) works out who is logged in
// from the 'x-user-id' header. employeelogin.js saves that id to
// localStorage('userId') at login. Without this header the server can't look
// up the employee, so it falls back to a generic "Employee" label instead of
// the user's full name.
//
// Use employeeFetch() exactly like fetch() for any /api/... call.
(function () {
    function getUserId() {
        try {
            return localStorage.getItem('userId') || sessionStorage.getItem('userId') || '';
        } catch (e) {
            return '';
        }
    }

    window.employeeFetch = function (url, options) {
        const opts = Object.assign({}, options || {});
        const headers = Object.assign({}, opts.headers || {});
        const userId = getUserId();
        if (userId) headers['x-user-id'] = userId;
        opts.headers = headers;
        return fetch(url, opts);
    };
})();

// ---------------------------------------------------------------------------
// Shared error UI for the Finance / Inventory / Production dashboards.
// When the API or Supabase fails, say so - never show made-up records.
// ---------------------------------------------------------------------------
(function () {
    window.EmployeeUI = {
        errorMessage: async function (response) {
            try {
                const body = await response.json();
                if (body && body.message) return body.message;
            } catch (e) { /* not JSON */ }
            return 'Server responded with status ' + response.status;
        },
        showError: function (error) {
            let msg = (error && error.message) ? error.message : String(error || 'Unknown error');
            if (/failed to fetch|networkerror/i.test(msg)) msg = 'Cannot reach the server.';
            let banner = document.getElementById('employeeApiError');
            if (!banner) {
                banner = document.createElement('div');
                banner.id = 'employeeApiError';
                banner.setAttribute('role', 'alert');
                banner.style.cssText = 'margin:0 0 16px;padding:12px 16px;border-radius:10px;' +
                    'background:#fdecea;color:#8a1f17;border:1px solid #f3b7b1;font-size:14px;line-height:1.4;';
                const host = document.querySelector('.main-content') || document.body;
                host.insertBefore(banner, host.firstChild);
            }
            banner.textContent = 'Live data could not be loaded: ' + msg +
                ' Nothing on this page is sample data. Check the server logs and the Supabase connection, then refresh.';
        },
        failTables: function (text) {
            document.querySelectorAll('.loading-state-text').forEach(function (el) {
                el.textContent = text || 'Could not load data.';
            });
        }
    };
})();
