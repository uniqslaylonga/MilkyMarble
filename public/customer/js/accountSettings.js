// public/customer/js/accountSettings.js[cite: 4]
let currentCustomerData = null; //[cite: 4]

// Custom SweetAlert2 instance matching Milky Marble aesthetic[cite: 4]
const SettingsSwal = Swal.mixin({ //[cite: 4]
    customClass: { //[cite: 4]
        popup: 'custom-swal-popup', //[cite: 4]
        title: 'custom-swal-title', //[cite: 4]
        htmlContainer: 'custom-swal-html', //[cite: 4]
        confirmButton: 'custom-swal-confirm', //[cite: 4]
        cancelButton: 'custom-swal-cancel' //[cite: 4]
    }, //[cite: 4]
    buttonsStyling: false //[cite: 4]
}); //[cite: 4]

document.addEventListener('DOMContentLoaded', () => { //[cite: 4]
    loadAccountSettings(); //[cite: 4]
}); //[cite: 4]

// Kuhanin ang buong data ng user at customer preferences[cite: 4]
async function loadAccountSettings() { //[cite: 4]
    try { //[cite: 4]
        const localUser = JSON.parse(localStorage.getItem('mm_user') || '{}');
        const customerId = localUser.customer_id || 11;

        const res = await fetch(`/api/customer/profile?customer_id=${customerId}`); //[cite: 4]

        if (res.status === 401) { //[cite: 4]
            window.location.href = 'customerlogin.html?error=login_required'; //[cite: 4]
            return; //[cite: 4]
        }

        const json = await res.json(); //[cite: 4]
        if (json.status !== 'success' || !json.data) { //[cite: 4]
            SettingsSwal.fire({ //[cite: 4]
                icon: 'error', //[cite: 4]
                title: 'Data Error', //[cite: 4]
                text: json.message || 'Could not load profile records.' //[cite: 4]
            }); //[cite: 4]
            return; //[cite: 4]
        }

        currentCustomerData = json.data; //[cite: 4]
        populateSettingsUI(currentCustomerData); //[cite: 4]

    } catch (err) { //[cite: 4]
        console.error('Failed to load profile:', err); //[cite: 4]
        SettingsSwal.fire({ //[cite: 4]
            icon: 'error', //[cite: 4]
            title: 'Connection Error', //[cite: 4]
            text: 'Unable to reach the server. Please check your network connection.' //[cite: 4]
        }); //[cite: 4]
    }
}

// I-populate ang data sa DOM at navbar avatar[cite: 4]
function populateSettingsUI(data) { //[cite: 4]
    const user = data.users || {}; //[cite: 4]
    const displayName = user.full_name || user.username || 'Valued Customer'; //[cite: 4]
    const email = user.email || ''; //[cite: 4]

    // Overview Card & Navbar Badge[cite: 4]
    document.getElementById('overviewName').textContent = displayName; //[cite: 4]
    document.getElementById('overviewEmail').textContent = email; //[cite: 4]
    document.getElementById('otpTargetEmail').textContent = email; //[cite: 4]
    
    if (user.avatar) { //[cite: 4]
        const overviewAvatarEl = document.getElementById('overviewAvatar');
        overviewAvatarEl.src = user.avatar; //[cite: 4]
        overviewAvatarEl.onerror = () => { overviewAvatarEl.onerror = null; overviewAvatarEl.src = 'images/account.png'; };
        const navAvatar = document.querySelector('.nav-avatar-img-badge');
        if (navAvatar) {
            navAvatar.src = user.avatar;
            navAvatar.onerror = () => { navAvatar.onerror = null; navAvatar.src = 'images/account.png'; };
        }
    }

    // Notification Toggles[cite: 4]
    document.getElementById('toggle_notify_pickup').checked = Boolean(data.notify_pickup); //[cite: 4]
    document.getElementById('toggle_notify_email_receipts').checked = Boolean(data.notify_email_receipts); //[cite: 4]
    document.getElementById('toggle_notify_promos').checked = Boolean(data.notify_promos); //[cite: 4]

    // Payment Preference
    populatePaymentPreferenceUI(data.payment_preference || null);

}

// Toggle password text visibility[cite: 4]
function togglePassVisibility(inputId, button) { //[cite: 4]
    const input = document.getElementById(inputId); //[cite: 4]
    const icon = button.querySelector('i'); //[cite: 4]

    if (input.type === 'password') { //[cite: 4]
        input.type = 'text'; //[cite: 4]
        icon.classList.remove('fa-eye'); //[cite: 4]
        icon.classList.add('fa-eye-slash'); //[cite: 4]
    } else { //[cite: 4]
        input.type = 'password'; //[cite: 4]
        icon.classList.remove('fa-eye-slash'); //[cite: 4]
        icon.classList.add('fa-eye'); //[cite: 4]
    }
}

// Live preference toggling via PATCH[cite: 4]
async function updateAccountPreference(prefKey, isChecked, label) { //[cite: 4]
    try { //[cite: 4]
        const localUser = JSON.parse(localStorage.getItem('mm_user') || '{}');
        const customerId = localUser.customer_id || (currentCustomerData && currentCustomerData.id) || 11;

        const res = await fetch('/api/customer/preferences', { //[cite: 4]
            method: 'PATCH', //[cite: 4]
            headers: { 'Content-Type': 'application/json' }, //[cite: 4]
            body: JSON.stringify({ //[cite: 4]
                customer_id: customerId,
                key: prefKey, //[cite: 4]
                value: isChecked //[cite: 4]
            }) //[cite: 4]
        }); //[cite: 4]
        const data = await res.json(); //[cite: 4]

        if (data.status === 'success') { //[cite: 4]
            const Toast = Swal.mixin({ //[cite: 4]
                toast: true, //[cite: 4]
                position: 'top-end', //[cite: 4]
                showConfirmButton: false, //[cite: 4]
                timer: 2800, //[cite: 4]
                timerProgressBar: false, //[cite: 4]
                customClass: { //[cite: 4]
                    popup: 'custom-swal-toast' //[cite: 4]
                } //[cite: 4]
            }); //[cite: 4]

            const feedbackMessages = { //[cite: 4]
                notify_pickup: { //[cite: 4]
                    on: "Sweet! We'll alert you the moment your cup is ready at the counter.", //[cite: 4]
                    off: "Pick-up readiness alerts turned off." //[cite: 4]
                }, //[cite: 4]
                notify_email_receipts: { //[cite: 4]
                    on: "All set! Order summaries will be sent straight to your email.", //[cite: 4]
                    off: "Email receipts turned off." //[cite: 4]
                }, //[cite: 4]
                notify_promos: { //[cite: 4]
                    on: "Yay! Check your inbox for your 10% OFF welcome perk!", //[cite: 4]
                    off: "Promo updates turned off. You won't receive marketing emails." //[cite: 4]
                } //[cite: 4]
            }; //[cite: 4]

            const msg = feedbackMessages[prefKey] //[cite: 4]
                ? (isChecked ? feedbackMessages[prefKey].on : feedbackMessages[prefKey].off) //[cite: 4]
                : `${label} ${isChecked ? 'enabled' : 'disabled'}!`; //[cite: 4]

            Toast.fire({ //[cite: 4]
                icon: isChecked ? 'success' : 'info', //[cite: 4]
                title: msg //[cite: 4]
            }); //[cite: 4]
        } else { //[cite: 4]
            SettingsSwal.fire({ //[cite: 4]
                icon: 'error', //[cite: 4]
                title: 'Oops!', //[cite: 4]
                text: data.message || 'Could not update your preference.' //[cite: 4]
            }); //[cite: 4]
        }
    } catch { //[cite: 4]
        SettingsSwal.fire({ //[cite: 4]
            icon: 'error', //[cite: 4]
            title: 'Connection Error', //[cite: 4]
            text: 'Could not connect to update preference.' //[cite: 4]
        }); //[cite: 4]
    }
}

// Reflect the saved payment preference (or "auto") on the pills
function populatePaymentPreferenceUI(preference) {
    const pills = document.querySelectorAll('.payment-pref-pill');
    pills.forEach(pill => {
        const isMatch = pill.getAttribute('data-method') === preference;
        pill.classList.toggle('active', isMatch);
    });

    const note = document.getElementById('paymentPrefNote');
    const clearBtn = document.getElementById('btnClearPaymentPref');

    if (preference) {
        if (note) note.textContent = `We'll pre-select "${preference}" for you at checkout.`;
        if (clearBtn) clearBtn.style.display = 'inline-block';
    } else {
        if (note) note.textContent = "No preference set — we'll auto-select whichever method you used last at checkout.";
        if (clearBtn) clearBtn.style.display = 'none';
    }
}

// Save a chosen payment preference (Cash on Hand / E-Wallet)
async function selectPaymentPreference(pillElement) {
    const method = pillElement.getAttribute('data-method');
    await savePaymentPreference(method, `Payment preference set to ${method}.`);
}

// Clear the saved preference so checkout falls back to "last used"
async function clearPaymentPreference() {
    await savePaymentPreference(null, "Preference cleared — we'll use whichever method you used last.");
}

async function savePaymentPreference(method, successMessage) {
    try {
        const localUser = JSON.parse(localStorage.getItem('mm_user') || '{}');
        const customerId = localUser.customer_id || (currentCustomerData && currentCustomerData.id) || 11;

        const res = await fetch('/api/customer/preferences', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ customer_id: customerId, key: 'payment_preference', value: method })
        });
        const data = await res.json();

        if (data.status === 'success') {
            populatePaymentPreferenceUI(method);
            if (currentCustomerData) currentCustomerData.payment_preference = method;

            const Toast = Swal.mixin({
                toast: true,
                position: 'top-end',
                showConfirmButton: false,
                timer: 2800,
                timerProgressBar: false,
                customClass: { popup: 'custom-swal-toast' }
            });
            Toast.fire({ icon: 'success', title: successMessage });
        } else {
            SettingsSwal.fire({
                icon: 'error',
                title: 'Oops!',
                text: data.message || 'Could not update your payment preference.'
            });
        }
    } catch {
        SettingsSwal.fire({
            icon: 'error',
            title: 'Connection Error',
            text: 'Could not connect to update your payment preference.'
        });
    }
}

// Intercept form submit and trigger email OTP[cite: 4]
async function interceptPasswordSubmit(event) { //[cite: 4]
    event.preventDefault(); //[cite: 4]

    const currentPass = document.getElementById('current_password').value; //[cite: 4]
    const newPass     = document.getElementById('new_password').value; //[cite: 4]
    const confirmPass = document.getElementById('confirm_password').value; //[cite: 4]

    if (!currentPass || !newPass || !confirmPass) { //[cite: 4]
        SettingsSwal.fire({ //[cite: 4]
            icon: 'warning', //[cite: 4]
            title: 'Missing Fields', //[cite: 4]
            text: 'Please fill in all password fields first.' //[cite: 4]
        }); //[cite: 4]
        return; //[cite: 4]
    }

    if (newPass !== confirmPass) { //[cite: 4]
        SettingsSwal.fire({ //[cite: 4]
            icon: 'error', //[cite: 4]
            title: 'Password Mismatch', //[cite: 4]
            text: 'New password and confirmation do not match.' //[cite: 4]
        }); //[cite: 4]
        return; //[cite: 4]
    }

    if (newPass.length < 6) { //[cite: 4]
        SettingsSwal.fire({ //[cite: 4]
            icon: 'warning', //[cite: 4]
            title: 'Password Too Short', //[cite: 4]
            text: 'New password must be at least 6 characters long.' //[cite: 4]
        }); //[cite: 4]
        return; //[cite: 4]
    }

    SettingsSwal.fire({ //[cite: 4]
        title: 'Sending Security Code...', //[cite: 4]
        text: 'Dispatching verification code to your email.', //[cite: 4]
        allowOutsideClick: false, //[cite: 4]
        didOpen: () => Swal.showLoading() //[cite: 4]
    }); //[cite: 4]

    try { //[cite: 4]
        const localUser = JSON.parse(localStorage.getItem('mm_user') || '{}');
        const targetEmail = (currentCustomerData && currentCustomerData.users && currentCustomerData.users.email)
                         || (currentCustomerData && currentCustomerData.email)
                         || localUser.email;
        const targetCustomerId = (currentCustomerData && currentCustomerData.id) || localUser.customer_id || 11;

        const res = await fetch('/api/customer/request-password-otp', { //[cite: 4]
            method: 'POST', //[cite: 4]
            headers: { 'Content-Type': 'application/json' }, //[cite: 4]
            body: JSON.stringify({
                customer_id: targetCustomerId,
                email: targetEmail
            })
        });
        const data = await res.json(); //[cite: 4]
        Swal.close(); //[cite: 4]

        if (res.ok && data.status === 'success') {
            document.getElementById('passwordOtpModal').classList.add('active'); //[cite: 4]
            document.getElementById('passwordOtpCode').value = ''; //[cite: 4]
            document.getElementById('passwordOtpCode').focus(); //[cite: 4]
        } else { //[cite: 4]
            SettingsSwal.fire({ //[cite: 4]
                icon: 'error', //[cite: 4]
                title: 'Failed to Send Code', //[cite: 4]
                text: data.message || 'Could not generate verification code.' //[cite: 4]
            }); //[cite: 4]
        }
    } catch { //[cite: 4]
        Swal.close(); //[cite: 4]
        SettingsSwal.fire({ //[cite: 4]
            icon: 'error', //[cite: 4]
            title: 'Mail Error', //[cite: 4]
            text: 'Could not send verification code. Please check your network connection.'
        });
    }
}

function closePasswordOtpModal() { //[cite: 4]
    document.getElementById('passwordOtpModal').classList.remove('active'); //[cite: 4]
}

// Verify OTP at kumpletuhin ang password change
async function verifyPasswordOtp() { //[cite: 4]
    const codeVal = document.getElementById('passwordOtpCode').value.trim(); //[cite: 4]

    if (codeVal.length !== 6) { //[cite: 4]
        SettingsSwal.fire({ //[cite: 4]
            icon: 'warning', //[cite: 4]
            title: 'Invalid Code', //[cite: 4]
            text: 'Please enter the full 6-digit confirmation code.' //[cite: 4]
        }); //[cite: 4]
        return; //[cite: 4]
    }

    const localUser = JSON.parse(localStorage.getItem('mm_user') || '{}');
    const targetCustomerId = (currentCustomerData && currentCustomerData.id) || localUser.customer_id || 11;

    const payload = { //[cite: 4]
        customer_id: targetCustomerId,
        current_password: document.getElementById('current_password').value, //[cite: 4]
        new_password: document.getElementById('new_password').value, //[cite: 4]
        confirm_password: document.getElementById('confirm_password').value, //[cite: 4]
        otp_code: codeVal //[cite: 4]
    }; //[cite: 4]

    try { //[cite: 4]
        const res = await fetch('/api/customer/change-password', { //[cite: 4]
            method: 'POST', //[cite: 4]
            headers: { 'Content-Type': 'application/json' }, //[cite: 4]
            body: JSON.stringify(payload) //[cite: 4]
        }); //[cite: 4]
        const data = await res.json(); //[cite: 4]

        if (res.ok && data.status === 'success') {
            closePasswordOtpModal(); //[cite: 4]
            document.getElementById('changePasswordForm').reset(); //[cite: 4]
            SettingsSwal.fire({ //[cite: 4]
                icon: 'success', //[cite: 4]
                title: 'Password Updated!', //[cite: 4]
                text: data.message || 'Your password has been changed successfully.' //[cite: 4]
            }); //[cite: 4]
        } else { //[cite: 4]
            SettingsSwal.fire({ //[cite: 4]
                icon: data.status === 'warning' ? 'warning' : 'error', //[cite: 4]
                title: 'Verification Failed', //[cite: 4]
                text: data.message || 'Could not update password.' //[cite: 4]
            }); //[cite: 4]
        }
    } catch { //[cite: 4]
        SettingsSwal.fire({ //[cite: 4]
            icon: 'error', //[cite: 4]
            title: 'Server Error', //[cite: 4]
            text: 'An error occurred while updating your password.' //[cite: 4]
        }); //[cite: 4]
    }
}

// Account deactivation flow
function confirmDeactivateAccount() { //[cite: 4]
    SettingsSwal.fire({ //[cite: 4]
        title: 'Deactivate Account?', //[cite: 4]
        text: 'You will be logged out and your customer account will be inactive.', //[cite: 4]
        icon: 'warning', //[cite: 4]
        showCancelButton: true, //[cite: 4]
        confirmButtonText: 'Yes, Deactivate', //[cite: 4]
        cancelButtonText: 'Keep My Account', //[cite: 4]
        customClass: { //[cite: 4]
            popup: 'custom-swal-popup', //[cite: 4]
            title: 'custom-swal-title', //[cite: 4]
            htmlContainer: 'custom-swal-html', //[cite: 4]
            confirmButton: 'custom-swal-danger-confirm', //[cite: 4]
            cancelButton: 'custom-swal-cancel' //[cite: 4]
        }, //[cite: 4]
        reverseButtons: true //[cite: 4]
    }).then(async (result) => { //[cite: 4]
        if (result.isConfirmed) { //[cite: 4]
            try { //[cite: 4]
                const localUser = JSON.parse(localStorage.getItem('mm_user') || '{}');
                const targetCustomerId = (currentCustomerData && currentCustomerData.id) || localUser.customer_id || 11;

                const res = await fetch('/api/customer/deactivate', { //[cite: 4]
                    method: 'POST', //[cite: 4]
                    headers: { 'Content-Type': 'application/json' }, //[cite: 4]
                    body: JSON.stringify({ customer_id: targetCustomerId })
                }); //[cite: 4]
                const data = await res.json(); //[cite: 4]

                if (data.status === 'success') { //[cite: 4]
                    localStorage.removeItem('mm_user');
                    SettingsSwal.fire({ //[cite: 4]
                        icon: 'success', //[cite: 4]
                        title: 'Account Deactivated', //[cite: 4]
                        text: 'Your account has been deactivated.', //[cite: 4]
                        timer: 1800, //[cite: 4]
                        showConfirmButton: false //[cite: 4]
                    }).then(() => { //[cite: 4]
                        window.location.href = data.redirect || 'customerlogin.html'; //[cite: 4]
                    }); //[cite: 4]
                }
            } catch { //[cite: 4]
                SettingsSwal.fire({ //[cite: 4]
                    icon: 'error', //[cite: 4]
                    title: 'Error', //[cite: 4]
                    text: 'Failed to deactivate account.' //[cite: 4]
                }); //[cite: 4]
            }
        }
    }); //[cite: 4]
}