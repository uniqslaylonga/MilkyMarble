// Shared utilities and unified SweetAlert styling for Sales Officer
(function () {
    const dateFmt = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Manila',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });

    // Manila timezone date converter
    function localDate(value) {
        const d = value instanceof Date ? value : new Date(value);
        return isNaN(d) ? '' : dateFmt.format(d);
    }

    // Server error message extractor
    async function errorMessage(response) {
        try {
            const body = await response.json();
            if (body && body.message) return body.message;
        } catch (e) {
            // Not a JSON response
        }
        return 'Server responded with status ' + response.status;
    }

    // Displays persistent database error banner
    function showError(error) {
        let msg = (error && error.message) ? error.message : String(error || 'Unknown error');
        if (/failed to fetch|networkerror/i.test(msg)) msg = 'Cannot reach the server.';

        let banner = document.getElementById('salesApiError');
        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'salesApiError';
            banner.setAttribute('role', 'alert');
            banner.style.cssText = 'margin:0 0 16px;padding:12px 16px;border-radius:10px;' +
                'background:#fdecea;color:#8a1f17;border:1px solid #f3b7b1;font-size:14px;line-height:1.4;';
            const host = document.querySelector('.main-content') || document.body;
            host.insertBefore(banner, host.firstChild);
        }
        banner.textContent = 'Live data could not be loaded: ' + msg +
            ' Check the server logs and the Supabase connection, then refresh.';
    }

    // Replaces loading state text
    function failTables(text) {
        document.querySelectorAll('.loading-state-text').forEach(function (el) {
            el.textContent = text || 'Could not load data.';
        });
    }

    // Computes split percentages ensuring 100% sum
    function splitPercents(a, b) {
        a = Number(a) || 0; 
        b = Number(b) || 0;
        const total = a + b;
        if (total <= 0) return { a: 0, b: 0, aText: '0%', bText: '0%' };
        let aP = Math.round((a / total) * 1000) / 10;
        let bP = Math.round((100 - aP) * 10) / 10;
        let aText, bText;
        if (b > 0 && bP < 0.1) { bP = 0.1; aP = 99.9; }
        if (a > 0 && aP < 0.1) { aP = 0.1; bP = 99.9; }
        const fmt = v => (Number.isInteger(v) ? String(v) : v.toFixed(1)) + '%';
        aText = (a > 0 && aP <= 0.1) ? '<0.1%' : fmt(aP);
        bText = (b > 0 && bP <= 0.1) ? '<0.1%' : fmt(bP);
        return { a: aP, b: bP, aText: aText, bText: bText };
    }

    // Auto-injects unified SweetAlert2 styling matching Milky Marble palette
    function injectSwalStyles() {
        if (document.getElementById('mm-swal-injected-styles')) return;
        const style = document.createElement('style');
        style.id = 'mm-swal-injected-styles';
        style.textContent = `
            .swal2-popup.mm-swal-popup {
                background-color: #FFFFFF !important;
                border-radius: 20px !important;
                padding: 24px !important;
                border: 1.5px solid rgba(246, 146, 153, 0.28) !important;
                box-shadow: 0 16px 40px rgba(124, 79, 56, 0.22) !important;
                font-family: 'Urbanist', sans-serif !important;
            }
            .swal2-title.mm-swal-title {
                font-family: 'Bootzy TM', sans-serif !important;
                color: #7C4F38 !important;
                font-size: 18px !important;
                letter-spacing: 0.5px !important;
            }
            .swal2-html-container {
                color: #453434 !important;
                font-size: 13px !important;
                font-family: 'Urbanist', sans-serif !important;
            }
            .swal2-confirm.mm-swal-confirm {
                background-color: #F69299 !important;
                color: #ffffff !important;
                border: none !important;
                border-radius: 12px !important;
                padding: 8px 22px !important;
                font-weight: 700 !important;
                font-size: 12.5px !important;
                font-family: 'Urbanist', sans-serif !important;
                cursor: pointer !important;
                box-shadow: 0 3px 8px rgba(246, 146, 153, 0.3) !important;
                margin: 0 6px !important;
                transition: background 0.15s ease !important;
            }
            .swal2-confirm.mm-swal-confirm:hover {
                background-color: #F8A5AD !important;
            }
            .swal2-cancel.mm-swal-cancel {
                background-color: transparent !important;
                border: 1.5px solid rgba(246, 146, 153, 0.35) !important;
                border-radius: 12px !important;
                padding: 8px 18px !important;
                font-weight: 700 !important;
                font-size: 12px !important;
                color: #7C4F38 !important;
                font-family: 'Urbanist', sans-serif !important;
                cursor: pointer !important;
                margin: 0 6px !important;
            }
            .swal2-cancel.mm-swal-cancel:hover {
                background-color: #FDEFEE !important;
            }
            .swal2-input.mm-swal-input {
                background-color: #FFF5F4 !important;
                border: 1.5px solid #F69299 !important;
                border-radius: 10px !important;
                padding: 8px 12px !important;
                font-family: 'Urbanist', sans-serif !important;
                font-size: 13px !important;
                color: #453434 !important;
            }
        `;
        document.head.appendChild(style);
    }

    // Unified custom alert modal
    function swalAlert(title, text, icon = 'info') {
        injectSwalStyles();
        if (typeof Swal !== 'undefined') {
            return Swal.fire({
                title: title,
                text: text,
                icon: icon,
                customClass: {
                    popup: 'mm-swal-popup',
                    title: 'mm-swal-title',
                    confirmButton: 'mm-swal-confirm'
                },
                buttonsStyling: false
            });
        }
        alert(title + '\n' + text);
        return Promise.resolve();
    }

    // Unified custom confirmation modal
    async function swalConfirm(title, text, confirmBtnText = 'Confirm', cancelBtnText = 'Cancel') {
        injectSwalStyles();
        if (typeof Swal !== 'undefined') {
            const res = await Swal.fire({
                title: title,
                text: text,
                icon: 'question',
                showCancelButton: true,
                confirmButtonText: confirmBtnText,
                cancelButtonText: cancelBtnText,
                customClass: {
                    popup: 'mm-swal-popup',
                    title: 'mm-swal-title',
                    confirmButton: 'mm-swal-confirm',
                    cancelButton: 'mm-swal-cancel'
                },
                buttonsStyling: false
            });
            return res.isConfirmed;
        }
        return confirm(title + '\n' + text);
    }

    // Unified custom text input modal
    async function swalPrompt(title, text, placeholder = '') {
        injectSwalStyles();
        if (typeof Swal !== 'undefined') {
            const res = await Swal.fire({
                title: title,
                text: text,
                input: 'text',
                inputPlaceholder: placeholder,
                showCancelButton: true,
                customClass: {
                    popup: 'mm-swal-popup',
                    title: 'mm-swal-title',
                    input: 'mm-swal-input',
                    confirmButton: 'mm-swal-confirm',
                    cancelButton: 'mm-swal-cancel'
                },
                buttonsStyling: false
            });
            return res.isConfirmed ? res.value : null;
        }
        return prompt(title + (text ? '\n' + text : ''));
    }

    window.SalesCommon = {
        localDate: localDate,
        splitPercents: splitPercents,
        errorMessage: errorMessage,
        showError: showError,
        failTables: failTables,
        alert: swalAlert,
        confirm: swalConfirm,
        prompt: swalPrompt
    };
})();