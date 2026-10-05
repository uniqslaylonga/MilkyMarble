// public/management/admin/js/passwordTickets.js
// Admin side of the employee "forgot password" tickets (Employee Records page).
// Employees submit a ticket from the employee login page; here the admin sees
// the open ones, and either issues a new temporary password or dismisses them.

const ticketSwal = Swal.mixin({
    customClass: {
        popup: 'mm-swal-popup',
        title: 'mm-swal-title',
        confirmButton: 'mm-swal-confirm',
        cancelButton: 'mm-swal-cancel'
    },
    buttonsStyling: false
});

let openTickets = [];

// Tickets contain text typed by anyone on the login page, so always escape it.
function ticketEsc(value) {
    const div = document.createElement('div');
    div.textContent = value == null ? '' : String(value);
    return div.innerHTML;
}

function ticketTimeAgo(iso) {
    const diffMin = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin} min ago`;
    const hrs = Math.round(diffMin / 60);
    if (hrs < 24) return `${hrs} hr ago`;
    return new Date(iso).toLocaleDateString();
}

async function loadTickets() {
    try {
        const res = await fetch('/api/admin/password-tickets');
        const data = await res.json();
        if (!res.ok || data.status !== 'success') throw new Error(data.message || 'Could not load requests.');
        openTickets = data.tickets || [];
    } catch (err) {
        console.warn('[passwordTickets]', err.message);
        openTickets = [];
    }
    updateTicketBadge();
    renderTickets();
}

function updateTicketBadge() {
    const badge = document.getElementById('pwTicketsBadge');
    if (!badge) return;
    badge.textContent = openTickets.length;
    badge.hidden = openTickets.length === 0;
}

function renderTickets() {
    const list = document.getElementById('ticketsList');
    if (!list) return;

    if (openTickets.length === 0) {
        list.innerHTML = '<div class="ticket-empty">No pending password requests.</div>';
        return;
    }

    list.innerHTML = openTickets.map(t => `
        <div class="ticket-row" data-ticket-id="${ticketEsc(t.id)}">
            <div class="ticket-row-top">
                <div>
                    <div class="ticket-name">${ticketEsc(t.full_name || t.username)}</div>
                    <div class="ticket-username">@${ticketEsc(t.username)}</div>
                </div>
                <div class="ticket-time">${ticketEsc(ticketTimeAgo(t.created_at))}</div>
            </div>
            ${t.note ? `<div class="ticket-note">${ticketEsc(t.note)}</div>` : ''}
            <div class="ticket-actions">
                <button type="button" class="btn-secondary" data-action="dismiss">Dismiss</button>
                <button type="button" class="btn-primary" data-action="resolve">Set New Password</button>
            </div>
        </div>
    `).join('');
}

async function openTicketsModal() {
    document.getElementById('ticketsModalOverlay')?.classList.add('open');
    document.body.style.overflow = 'hidden';
    await loadTickets();
}

function closeTicketsModal() {
    document.getElementById('ticketsModalOverlay')?.classList.remove('open');
    document.body.style.overflow = '';
}

async function resolveTicket(ticket) {
    const confirm = await ticketSwal.fire({
        title: 'Set a new password?',
        text: `A new temporary password will be created for ${ticket.full_name || ticket.username}. Their old password will stop working.`,
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: 'Generate Password',
        cancelButtonText: 'Cancel'
    });
    if (!confirm.isConfirmed) return;

    try {
        const res = await fetch(`/api/admin/password-tickets/${encodeURIComponent(ticket.id)}/resolve`, { method: 'POST' });
        const data = await res.json();
        if (!res.ok || data.status !== 'success') throw new Error(data.message || 'Could not reset the password.');

        await ticketSwal.fire({
            title: 'New Password Ready',
            html: `
                <p style="font-size:13.5px;color:#7C4F38;margin:0;">
                    Give this to <b>${ticketEsc(data.full_name || data.username)}</b> in person.
                    It is shown only once. They will be asked to choose their own password right after they log in with it.
                </p>
                <div class="temp-pw-box">${ticketEsc(data.temp_password)}</div>
            `,
            icon: 'success',
            confirmButtonText: 'Done'
        });
    } catch (err) {
        await ticketSwal.fire({ title: 'Failed', text: err.message, icon: 'error', confirmButtonText: 'OK' });
    }
    await loadTickets();
}

async function dismissTicket(ticket) {
    const confirm = await ticketSwal.fire({
        title: 'Dismiss this request?',
        text: 'The password will not be changed.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Dismiss',
        cancelButtonText: 'Keep'
    });
    if (!confirm.isConfirmed) return;

    try {
        const res = await fetch(`/api/admin/password-tickets/${encodeURIComponent(ticket.id)}/dismiss`, { method: 'POST' });
        const data = await res.json();
        if (!res.ok || data.status !== 'success') throw new Error(data.message || 'Could not dismiss the ticket.');
    } catch (err) {
        await ticketSwal.fire({ title: 'Failed', text: err.message, icon: 'error', confirmButtonText: 'OK' });
    }
    await loadTickets();
}

document.addEventListener('DOMContentLoaded', () => {
    loadTickets(); // fills the badge count

    document.getElementById('ticketsModalOverlay')?.addEventListener('click', (e) => {
        if (e.target.id === 'ticketsModalOverlay') closeTicketsModal();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeTicketsModal();
    });

    document.getElementById('ticketsList')?.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-action]');
        if (!btn) return;
        const row = btn.closest('.ticket-row');
        const ticket = openTickets.find(t => String(t.id) === row.dataset.ticketId);
        if (!ticket) return;
        if (btn.dataset.action === 'resolve') resolveTicket(ticket);
        else dismissTicket(ticket);
    });
});
