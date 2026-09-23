// Buksan ang modal at kunin ang existing values mula sa Order Summary
function openRecipientModal() {
    const currentNameElem = document.getElementById('summaryRecipName');
    const currentEmailElem = document.getElementById('summaryRecipEmail');

    const currentName = currentNameElem ? currentNameElem.innerText.trim() : '';
    const currentEmail = currentEmailElem ? currentEmailElem.innerText.trim() : '';

    // I-populate ang modal inputs (fallback sa blank kung default placeholder pa ang laman)
    const nameInput = document.getElementById('inputRecipientName');
    const emailInput = document.getElementById('inputRecipientEmail');

    if (nameInput) {
        nameInput.value = (currentName && currentName !== 'Full Name') ? currentName : '';
    }
    if (emailInput) {
        emailInput.value = (currentEmail && currentEmail !== '@gmail.com') ? currentEmail : '';
    }

    const modal = document.getElementById('recipientEditModal');
    if (modal) {
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
        setTimeout(() => {
            if (nameInput) nameInput.focus();
        }, 100);
    }
}

// Isara ang modal at ibalik ang scroll kung walang ibang modal sa likod
function closeRecipientModal(event) {
    const modal = document.getElementById('recipientEditModal');
    if (modal) {
        modal.classList.remove('active');

        // Ibalik lamang ang body scroll kung sarado rin ang Order Summary modal
        const orderSummaryModal = document.getElementById('orderSummaryModal');
        if (!orderSummaryModal || !orderSummaryModal.classList.contains('active')) {
            document.body.style.overflow = '';
        }
    }
}

// I-save ang recipient name at email papunta sa summary elements
function saveRecipientDetails(e) {
    e.preventDefault();

    const nameVal = document.getElementById('inputRecipientName').value.trim();
    const emailVal = document.getElementById('inputRecipientEmail').value.trim();

    if (!nameVal || !emailVal) return;

    const summaryName = document.getElementById('summaryRecipName');
    const summaryEmail = document.getElementById('summaryRecipEmail');

    if (summaryName) summaryName.innerText = nameVal;
    if (summaryEmail) summaryEmail.innerText = emailVal;

    closeRecipientModal();
}

// Gawing globally accessible para sa inline HTML onclick attributes
window.openRecipientModal = openRecipientModal;
window.closeRecipientModal = closeRecipientModal;
window.saveRecipientDetails = saveRecipientDetails;