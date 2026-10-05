// Self-service profile picture upload, shared across every management and
// employee page. Finds whichever avatar element the page already uses
// (#userAvatarImg / #userAvatar / #userAvatarContainer - all three patterns
// exist across the codebase), makes it clickable, uploads to
// /api/profile/upload-avatar, and keeps every avatar element on the page in
// sync. Works for admin, CEO, and every employee role, since avatar always
// lives on the shared `users` table.
(function () {
    function getUserId() {
        return localStorage.getItem('userId') || sessionStorage.getItem('userId') || null;
    }

    function findHost() {
        return document.getElementById('userAvatarImg') ||
               document.getElementById('userAvatar') ||
               document.getElementById('userAvatarContainer');
    }

    // <img> elements are replaced/void elements - a child node appended to
    // one is in the DOM but never actually painted, so the hover overlay
    // would silently do nothing. Wrap bare <img> hosts in a positioning
    // span sized to match, and do all overlay/click work on the wrapper
    // instead, while image updates still target the real <img>.
    function ensureClickableWrapper(host) {
        if (host.tagName !== 'IMG') return host;

        const already = host.parentElement;
        if (already && already.dataset && already.dataset.avatarWrap === '1') {
            return already;
        }

        const cs = window.getComputedStyle(host);
        const wrapper = document.createElement('span');
        wrapper.dataset.avatarWrap = '1';
        wrapper.style.cssText =
            'position:relative;display:inline-block;line-height:0;' +
            'width:' + cs.width + ';height:' + cs.height + ';' +
            'border-radius:' + (cs.borderRadius || '50%') + ';overflow:hidden;';

        host.parentNode.insertBefore(wrapper, host);
        wrapper.appendChild(host);
        return wrapper;
    }

    function applyAvatarUrl(imgEl, containerEl, url) {
        if (!url) return;
        if (imgEl) {
            imgEl.src = url;
            return;
        }
        // Container-only element (holds a placeholder SVG, not an <img>) -
        // swap the placeholder for a real photo.
        let img = containerEl.querySelector('img.avatar-photo-img');
        if (!img) {
            img = document.createElement('img');
            img.className = 'avatar-photo-img';
            img.alt = 'Profile photo';
            img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%;display:block;';
            img.onerror = function () { this.remove(); };
            containerEl.insertBefore(img, containerEl.firstChild);
        }
        containerEl.querySelectorAll(':scope > svg').forEach(function (svg) { svg.style.display = 'none'; });
        img.src = url;
    }

    function init() {
        const host = findHost();
        const userId = getUserId();
        if (!host || !userId) return;

        const imgEl = host.tagName === 'IMG' ? host : null;
        const clickHost = ensureClickableWrapper(host);

        // Load whatever avatar is already saved, so refreshing the page
        // (or landing on a dashboard whose own JS never fetches the
        // avatar) still shows the real photo.
        fetch('/api/profile/avatar?user_id=' + encodeURIComponent(userId))
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data && data.status === 'success' && data.avatar) {
                    applyAvatarUrl(imgEl, host, data.avatar);
                }
            })
            .catch(function () { /* non-fatal - the page's own default stays */ });

        clickHost.style.position = clickHost.style.position || 'relative';
        clickHost.style.cursor = 'pointer';
        clickHost.title = 'Click to change your profile picture';

        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'image/png,image/jpeg,image/webp,image/gif';
        fileInput.style.display = 'none';
        document.body.appendChild(fileInput);

        const overlay = document.createElement('div');
        overlay.setAttribute('aria-hidden', 'true');
        overlay.style.cssText = [
            'position:absolute', 'inset:0', 'display:flex', 'align-items:center',
            'justify-content:center', 'background:rgba(0,0,0,0.45)', 'color:#fff',
            'font-size:14px', 'line-height:1', 'opacity:0', 'transition:opacity .15s',
            'border-radius:50%', 'pointer-events:none'
        ].join(';');
        overlay.textContent = '\u270E'; // pencil glyph - no icon-font dependency
        clickHost.appendChild(overlay);

        clickHost.addEventListener('mouseenter', function () { overlay.style.opacity = '1'; });
        clickHost.addEventListener('mouseleave', function () { overlay.style.opacity = '0'; });
        clickHost.addEventListener('click', function () { fileInput.click(); });

        fileInput.addEventListener('change', function () {
            const file = fileInput.files[0];
            if (!file) return;

            if (!file.type.startsWith('image/')) {
                alert('Please choose an image file.');
                fileInput.value = '';
                return;
            }
            if (file.size > 8 * 1024 * 1024) {
                alert('Image must be smaller than 8MB.');
                fileInput.value = '';
                return;
            }

            const formData = new FormData();
            formData.append('avatar', file);
            formData.append('user_id', userId);

            overlay.textContent = '...';
            overlay.style.opacity = '1';

            fetch('/api/profile/upload-avatar', { method: 'POST', body: formData })
                .then(function (r) { return r.json().then(function (data) { return { ok: r.ok, data: data }; }); })
                .then(function (result) {
                    if (!result.ok || result.data.status !== 'success') {
                        throw new Error(result.data.message || 'Upload failed.');
                    }
                    applyAvatarUrl(imgEl, host, result.data.avatar);
                    // Keep any other avatar elements elsewhere on the page
                    // (e.g. a profile modal) in sync too.
                    document.querySelectorAll('img.user-avatar-img, img#mAvatarImg').forEach(function (el) {
                        el.src = result.data.avatar;
                    });
                })
                .catch(function (err) {
                    alert('Could not upload photo: ' + err.message);
                })
                .finally(function () {
                    overlay.textContent = '\u270E';
                    overlay.style.opacity = '0';
                    fileInput.value = '';
                });
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();