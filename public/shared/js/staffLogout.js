// public/shared/js/staffLogout.js
//
// Every staff dashboard (management + employee) has a "Log out" link with
// class="logout-btn" that was just plain navigation:
//   <a href="../managementlogin.html" class="nav-link logout-btn">Log out</a>
// That never touched the signed mm_staff cookie set by src/middleware/
// staffAuth.js, so the session stayed valid (up to 12h) even after
// "logging out" - pasting a dashboard URL back in still worked.
//
// This intercepts clicks on any .logout-btn, clears the cookie via
// POST /api/staff/logout first, then follows the link. Uses event
// delegation on document so it also covers buttons injected later
// (e.g. a sidebar loaded via fetch), as long as this script is present
// on the page.
(function () {
    document.addEventListener('click', function (event) {
        const btn = event.target.closest('.logout-btn');
        if (!btn) return;

        const href = btn.getAttribute('href');
        if (!href) return;

        event.preventDefault();
        fetch('/api/staff/logout', { method: 'POST', credentials: 'same-origin' })
            .catch(function () { /* still leave the page even if this call fails */ })
            .finally(function () { window.location.href = href; });
    });
})();
