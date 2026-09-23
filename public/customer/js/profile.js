// public/customer/js/profile.js
let currentUser = null;
let resendTimer = null;

const ProfileSwal = Swal.mixin({
    customClass: {
        popup: 'custom-swal-popup',
        title: 'custom-swal-title',
        htmlContainer: 'custom-swal-html',
        confirmButton: 'custom-swal-confirm',
        cancelButton: 'custom-swal-cancel'
    },
    buttonsStyling: false
});

// Helper para maayos ang formatting ng image URL o Base64
function sanitizeAvatarString(raw) {
    if (!raw || typeof raw !== 'string') return 'images/account.png';
    let cleaned = raw.trim();

    // Tanggalin ang leading slash kung aksidenteng nalagay bago ang data URI
    if (cleaned.startsWith('/data:') || cleaned.startsWith('/data/')) {
        cleaned = cleaned.substring(1);
    }

    // Itama ang typo kung may data/image sa halip na data:image
    if (cleaned.startsWith('data/image')) {
        cleaned = 'data:image' + cleaned.substring(10);
    }

    // Kung Base64 data URI, ibalik agad nang walang binabago
    if (cleaned.startsWith('data:image/') || cleaned.startsWith('data:')) {
        return cleaned;
    }

    // Kung external URL (hal. Supabase Storage public link)
    if (cleaned.startsWith('http://') || cleaned.startsWith('https://')) {
        return cleaned;
    }

    // Kung local file path
    if (cleaned.startsWith('/images/')) {
        return cleaned.substring(1);
    }
    if (!cleaned.startsWith('images/')) {
        return 'images/' + cleaned;
    }

    return cleaned;
}

document.addEventListener('DOMContentLoaded', () => {
    // Linisin agad ang posibleng sirang value sa kasalukuyang localStorage
    try {
        const stored = JSON.parse(localStorage.getItem('mm_user') || 'null');
        if (stored && stored.avatar) {
            const sanitized = sanitizeAvatarString(stored.avatar);
            if (sanitized !== stored.avatar) {
                stored.avatar = sanitized;
                if (stored.profile_picture) stored.profile_picture = sanitized;
                localStorage.setItem('mm_user', JSON.stringify(stored));
            }
        }
    } catch {}

    loadProfileDetails();
    setupProfileForm();
});

// Kumuha ng datos mula sa Supabase/Backend gamit ang verified session identity
async function loadProfileDetails() {
    const localUser = JSON.parse(localStorage.getItem('mm_user') || 'null');

    if (!localUser || (!localUser.email && !localUser.user_id && !localUser.id)) {
        window.location.href = 'customerlogin.html?error=login_required';
        return;
    }

    const email = localUser.email || '';
    const userId = localUser.user_id || localUser.id || '';
    const customerId = localUser.customer_id || '';

    try {
        const queryParams = new URLSearchParams();
        if (email) queryParams.append('email', email);
        if (userId) queryParams.append('user_id', userId);
        if (customerId) queryParams.append('customer_id', customerId);

        const res = await fetch(`/api/customer/profile?${queryParams.toString()}`, {
            credentials: 'include'
        });

        if (res.status === 401) {
            localStorage.removeItem('mm_user');
            window.location.href = 'customerlogin.html?error=session_expired';
            return;
        }

        const result = await res.json();

        if (res.ok && result.status === 'success' && (result.data || result.customer)) {
            currentUser = result.data || result.customer;
            populateProfileFields(currentUser);
        } else {
            ProfileSwal.fire({
                icon: 'error',
                title: 'Account Error',
                text: result.message || 'Unable to retrieve your account details. Please log in again.'
            });
        }
    } catch (err) {
        console.error('Failed to load profile details:', err);
        ProfileSwal.fire({
            icon: 'error',
            title: 'Connection Error',
            text: 'Unable to connect to the server to fetch your profile. Please check your internet connection.'
        });
    }
}

// I-populate ang totoong database fields sa input elements
function populateProfileFields(data) {
    const user = data.users || data;

    const rawAvatar = user.avatar || user.profile_picture || user.avatar_url || data.avatar || '';
    const avatarSrc = sanitizeAvatarString(rawAvatar);

    const avatarRound = document.getElementById('avatarRoundPreview');
    if (avatarRound) {
        avatarRound.src = avatarSrc;
        avatarRound.onerror = () => { avatarRound.src = 'images/account.png'; };
    }

    const navAvatar = document.querySelector('.nav-avatar-img-badge');
    if (navAvatar) navAvatar.src = avatarSrc;

    const dropAvatar = document.getElementById('dropdownAvatarImgDisplay');
    if (dropAvatar) dropAvatar.src = avatarSrc;

    const fullNameEl = document.getElementById('full_name');
    if (fullNameEl) fullNameEl.value = user.full_name || '';

    const emailEl = document.getElementById('profileCurrentEmailDisplay');
    if (emailEl) emailEl.value = user.email || '';

    const phoneValue = data.phone || data.phone_number || user.phone || user.phone_number || '';
    const phoneEl = document.getElementById('phone');
    if (phoneEl) phoneEl.value = phoneValue;

    const usernameInput = document.getElementById('username');
    const hintText = document.getElementById('usernameHintText');
    if (usernameInput) usernameInput.value = user.username || '';

    // I-sync sa localStorage ang verified account data ng kasalukuyang user
    const localUser = JSON.parse(localStorage.getItem('mm_user') || '{}');
    if (avatarSrc && avatarSrc !== 'images/account.png') {
        localUser.avatar = avatarSrc;
        localUser.profile_picture = avatarSrc;
    }
    if (user.full_name) localUser.full_name = user.full_name;
    if (user.username) localUser.username = user.username;
    if (user.email) localUser.email = user.email;
    if (data.customer_id || data.id) localUser.customer_id = data.customer_id || data.id;
    if (user.id || data.user_id) localUser.user_id = user.id || data.user_id;
    localStorage.setItem('mm_user', JSON.stringify(localUser));

    // 30-Day Username Cooldown Logic
    const cooldownDays = 30;
    const lastUpdateVal = user.last_username_update || data.last_username_update;

    if (lastUpdateVal && usernameInput && hintText) {
        const lastUpdate = new Date(lastUpdateVal);
        const now = new Date();
        const diffMs = now - lastUpdate;
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

        if (diffDays < cooldownDays) {
            const daysRemaining = cooldownDays - diffDays;
            
            usernameInput.disabled = true;
            usernameInput.readOnly = true;
            usernameInput.style.backgroundColor = '#F4EBE6';
            usernameInput.style.cursor = 'not-allowed';
            usernameInput.style.borderColor = '#DBCBC4';
            usernameInput.style.color = '#8A7368';
            
            hintText.textContent = `Username can be updated again in ${daysRemaining} day(s).`;
            hintText.style.color = '#E27D80';
            hintText.style.fontWeight = '700';
        } else {
            unlockUsernameInput(usernameInput, hintText);
        }
    } else if (usernameInput && hintText) {
        unlockUsernameInput(usernameInput, hintText);
    }
}

function unlockUsernameInput(input, hint) {
    input.disabled = false;
    input.readOnly = false;
    input.style.backgroundColor = '#FFFFFF';
    input.style.cursor = 'text';
    input.style.borderColor = '#D4C8C1';
    input.style.color = 'var(--text-dark)';
    hint.textContent = 'You can change your username once every 30 days.';
    hint.style.color = 'var(--text-muted)';
    hint.style.fontWeight = '500';
}

function previewAvatar(input) {
    if (input.files && input.files[0]) {
        const reader = new FileReader();
        reader.onload = function(e) {
            const avatarDataUrl = e.target.result;
            const roundPreview = document.getElementById('avatarRoundPreview');
            if (roundPreview) roundPreview.src = avatarDataUrl;
            
            const navAvatar = document.querySelector('.nav-avatar-img-badge');
            if (navAvatar) navAvatar.src = avatarDataUrl;

            const dropAvatar = document.getElementById('dropdownAvatarImgDisplay');
            if (dropAvatar) dropAvatar.src = avatarDataUrl;
        };
        reader.readAsDataURL(input.files[0]);
    }
}

function openEmailChangeModal() {
    document.getElementById('modalNewEmailInput').value = '';
    document.getElementById('modalOtpCodeInput').value = '';
    document.getElementById('emailChangeModal').classList.add('active');
    document.getElementById('modalNewEmailInput').focus();
}

function closeEmailChangeModal(event) {
    if (event && event.target && event.target.id !== 'emailChangeModal' && !event.target.classList.contains('mm-email-modal-close')) {
        return;
    }
    document.getElementById('emailChangeModal').classList.remove('active');
}

function startResendCooldown(seconds) {
    const btn = document.getElementById('btnSendEmailCode');
    if (!btn) return;
    btn.disabled = true;
    let remaining = seconds;
    btn.innerText = `Resend (${remaining}s)`;

    clearInterval(resendTimer);
    resendTimer = setInterval(() => {
        remaining--;
        if (remaining <= 0) {
            clearInterval(resendTimer);
            btn.disabled = false;
            btn.innerText = 'Send Code';
        } else {
            btn.innerText = `Resend (${remaining}s)`;
        }
    }, 1000);
}

async function handleSendEmailOtp() {
    const newEmail = document.getElementById('modalNewEmailInput').value.trim();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!newEmail || !emailRegex.test(newEmail)) {
        ProfileSwal.fire({
            icon: 'warning',
            title: 'Valid Email Needed',
            text: 'Please enter a valid email address before requesting a verification code.'
        });
        return;
    }

    const sendBtn = document.getElementById('btnSendEmailCode');
    sendBtn.disabled = true;
    sendBtn.innerText = 'Sending...';

    ProfileSwal.fire({
        title: 'Sending Code...',
        text: 'Please wait while we generate and send your verification code.',
        allowOutsideClick: false,
        didOpen: () => { Swal.showLoading(); }
    });

    try {
        const res = await fetch('/api/customer/email-otp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ new_email: newEmail })
        });
        const data = await res.json();

        if (res.ok && data.status === 'success') {
            startResendCooldown(60);
            ProfileSwal.fire({
                icon: 'success',
                title: 'Code Sent!',
                text: data.message || `Verification code sent to ${newEmail}.`,
                timer: 2500,
                showConfirmButton: false
            });
            document.getElementById('modalOtpCodeInput').focus();
        } else {
            sendBtn.disabled = false;
            sendBtn.innerText = 'Send Code';
            ProfileSwal.fire({
                icon: 'error',
                title: 'Could Not Send',
                text: data.message || 'Failed to send confirmation code. Please try again.'
            });
        }
    } catch (err) {
        sendBtn.disabled = false;
        sendBtn.innerText = 'Send Code';
        ProfileSwal.fire({
            icon: 'error',
            title: 'Delivery Failed',
            text: 'Unable to deliver verification email at this moment. Please check your internet connection or email configuration.'
        });
    }
}

// I-verify ang OTP at i-save ang bagong email sa Supabase
async function handleVerifySaveEmail() {
    const newEmail = document.getElementById('modalNewEmailInput').value.trim();
    const otpCode  = document.getElementById('modalOtpCodeInput').value.trim();

    if (!newEmail) {
        ProfileSwal.fire({ icon: 'warning', title: 'Missing Email', text: 'Please enter your new email address.' });
        return;
    }

    if (otpCode.length !== 6) {
        ProfileSwal.fire({ icon: 'warning', title: 'Invalid Code', text: 'Please enter the complete 6-digit confirmation code.' });
        return;
    }

    ProfileSwal.fire({
        title: 'Updating Email...',
        text: 'Verifying code and saving to database...',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });

    const localUser = JSON.parse(localStorage.getItem('mm_user') || '{}');
    const customerId = localUser.customer_id || '';
    const userId = localUser.user_id || localUser.id || '';

    if (!customerId && !userId) {
        ProfileSwal.fire({ icon: 'error', title: 'Session Expired', text: 'Please log in again to verify and update your account.' });
        return;
    }

    try {
        const res = await fetch('/api/customer/email-otp/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                customer_id: customerId,
                user_id: userId,
                new_email: newEmail,
                otp_code: otpCode
            })
        });
        const data = await res.json();

        if (!res.ok || data.status !== 'success') {
            ProfileSwal.fire({
                icon: 'error',
                title: 'Verification Failed',
                text: data.message || 'Invalid or expired confirmation code.'
            });
            return;
        }

        document.getElementById('emailChangeModal').classList.remove('active');
        document.getElementById('profileCurrentEmailDisplay').value = newEmail;

        localUser.email = newEmail;
        localStorage.setItem('mm_user', JSON.stringify(localUser));

        ProfileSwal.fire({
            icon: 'success',
            title: 'Email Updated!',
            text: 'Your email address has been successfully updated in your profile.'
        });
    } catch {
        ProfileSwal.fire({
            icon: 'error',
            title: 'Server Error',
            text: 'An error occurred while connecting to the server. Please try again.'
        });
    }
}

function setupProfileForm() {
    const form = document.getElementById('profileForm');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const fullName = document.getElementById('full_name').value.trim();
        const username = document.getElementById('username').value.trim();
        const phone = document.getElementById('phone').value.trim();
        const fileInput = document.getElementById('profileAvatarInput') || document.querySelector('input[type="file"]');
        const avatarRound = document.getElementById('avatarRoundPreview');
        let avatarSrc = (avatarRound && !avatarRound.src.includes('account.png')) ? avatarRound.src : '';

        if (!fullName) {
            ProfileSwal.fire({ icon: 'warning', title: 'Missing Field', text: 'Full name is required.' });
            return;
        }

        if (phone) {
            const phMobileRegex = /^09\d{9}$/;
            if (!phMobileRegex.test(phone)) {
                ProfileSwal.fire({
                    icon: 'warning',
                    title: 'Invalid Contact Number',
                    text: 'Contact number must be an 11-digit number starting with 09 (e.g. 09123456789).'
                });
                return;
            }
        }

        ProfileSwal.fire({
            title: 'Saving Profile...',
            text: 'Validating and updating your details...',
            allowOutsideClick: false,
            didOpen: () => { Swal.showLoading(); }
        });

        const localUser = JSON.parse(localStorage.getItem('mm_user') || '{}');
        const customerId = localUser.customer_id || '';
        const userId = localUser.user_id || localUser.id || '';

        if (!customerId && !userId && !localUser.email) {
            ProfileSwal.fire({ icon: 'error', title: 'Authentication Required', text: 'Please log in to save changes.' });
            return;
        }

        const supabaseClientInstance = window.supabaseClient || window.supabase;

        // 1. Kung may bagong piniling larawan at available ang Supabase client
        if (fileInput && fileInput.files && fileInput.files[0] && supabaseClientInstance && supabaseClientInstance.storage) {
            const file = fileInput.files[0];
            const fileExt = file.name.split('.').pop();
            const filePath = `${userId || customerId}-${Date.now()}.${fileExt}`;

            try {
                const { data: uploadData, error: uploadError } = await supabaseClientInstance.storage
                    .from('avatars')
                    .upload(filePath, file, {
                        cacheControl: '3600',
                        upsert: true
                    });

                if (uploadError) {
                    ProfileSwal.fire({
                        icon: 'error',
                        title: 'Upload Failed',
                        text: uploadError.message
                    });
                    return;
                }

                const { data: { publicUrl } } = supabaseClientInstance.storage
                    .from('avatars')
                    .getPublicUrl(filePath);

                avatarSrc = publicUrl;
            } catch (storageErr) {
                console.error('Storage upload error:', storageErr);
                ProfileSwal.fire({
                    icon: 'error',
                    title: 'Upload Error',
                    text: 'Could not upload image to storage.'
                });
                return;
            }
        }

        // 2. I-save sa database gamit ang API endpoint
        try {
            const res = await fetch('/api/customer/profile', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    customer_id: customerId,
                    user_id: userId,
                    email: localUser.email,
                    full_name: fullName,
                    username: username,
                    phone_number: phone,
                    avatar: sanitizeAvatarString(avatarSrc)
                })
            });
            const data = await res.json();

            if (!res.ok || data.status !== 'success') {
                ProfileSwal.fire({
                    icon: 'error',
                    title: 'Update Failed',
                    text: data.message || 'Could not update profile details.'
                });
                return;
            }

            localUser.full_name = fullName;
            localUser.username = username;
            localUser.phone = phone;
            localUser.phone_number = phone;
            if (avatarSrc) {
                localUser.avatar = sanitizeAvatarString(avatarSrc);
                localUser.profile_picture = sanitizeAvatarString(avatarSrc);
            }
            localStorage.setItem('mm_user', JSON.stringify(localUser));

            const navAvatar = document.querySelector('.nav-avatar-img-badge');
            if (navAvatar && avatarSrc) navAvatar.src = sanitizeAvatarString(avatarSrc);

            ProfileSwal.fire({
                icon: 'success',
                title: 'Saved!',
                text: data.message || 'Profile changes saved successfully!',
                confirmButtonText: 'Got It'
            }).then(() => {
                loadProfileDetails();
            });

        } catch (err) {
            ProfileSwal.fire({
                icon: 'error',
                title: 'Server Error',
                text: 'Could not connect to the server. Please check your connection.'
            });
        }
    });
}