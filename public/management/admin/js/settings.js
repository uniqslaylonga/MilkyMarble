// public/management/admin/js/settings.js

const WEEKDAY_LABELS = [
  { day: 0, label: 'Sunday' },
  { day: 1, label: 'Monday' },
  { day: 2, label: 'Tuesday' },
  { day: 3, label: 'Wednesday' },
  { day: 4, label: 'Thursday' },
  { day: 5, label: 'Friday' },
  { day: 6, label: 'Saturday' }
];

let currentPickupDays = [];

document.addEventListener('DOMContentLoaded', () => {
  loadPickupDaySettings();
});

async function loadPickupDaySettings() {
  const grid = document.getElementById('pickupDaysGrid');
  try {
    const res = await fetch('/api/admin/settings/pickup-days', { credentials: 'include' });
    const data = await res.json();

    if (data.status === 'success' && Array.isArray(data.days)) {
      currentPickupDays = data.days;
    } else {
      currentPickupDays = [1, 2, 4];
    }
  } catch (err) {
    console.error('Failed to load pickup day settings:', err);
    currentPickupDays = [1, 2, 4];
  }

  renderPickupDaysGrid();
}

function renderPickupDaysGrid() {
  const grid = document.getElementById('pickupDaysGrid');
  if (!grid) return;

  grid.innerHTML = WEEKDAY_LABELS.map(({ day, label }) => {
    const isActive = currentPickupDays.includes(day);
    return `
      <label class="pickup-day-toggle ${isActive ? 'active' : ''}" data-day="${day}">
        <input type="checkbox" value="${day}" ${isActive ? 'checked' : ''} onchange="onDayToggle(this)">
        <span class="pickup-day-label">${label}</span>
      </label>
    `;
  }).join('');
}

window.onDayToggle = function(checkbox) {
  const wrapper = checkbox.closest('.pickup-day-toggle');
  if (wrapper) wrapper.classList.toggle('active', checkbox.checked);
};

window.savePickupDays = async function() {
  const grid = document.getElementById('pickupDaysGrid');
  const statusMsg = document.getElementById('pickupDaysStatusMsg');
  const saveBtn = document.getElementById('savePickupDaysBtn');
  if (!grid) return;

  const selectedDays = Array.from(grid.querySelectorAll('input[type="checkbox"]:checked'))
    .map(cb => parseInt(cb.value, 10));

  if (selectedDays.length === 0) {
    statusMsg.textContent = 'Select at least one pick-up day.';
    statusMsg.className = 'settings-status-msg error';
    return;
  }

  saveBtn.disabled = true;
  statusMsg.textContent = '';
  statusMsg.className = 'settings-status-msg';

  try {
    const res = await fetch('/api/admin/settings/pickup-days', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ days: selectedDays })
    });
    const data = await res.json();

    if (data.status === 'success') {
      currentPickupDays = data.days;
      statusMsg.textContent = 'Saved! Customers will see this on their next visit to checkout.';
      statusMsg.className = 'settings-status-msg success';
    } else {
      statusMsg.textContent = data.message || 'Could not save settings.';
      statusMsg.className = 'settings-status-msg error';
    }
  } catch (err) {
    console.error('Failed to save pickup day settings:', err);
    statusMsg.textContent = 'Network error — please try again.';
    statusMsg.className = 'settings-status-msg error';
  } finally {
    saveBtn.disabled = false;
  }
};
