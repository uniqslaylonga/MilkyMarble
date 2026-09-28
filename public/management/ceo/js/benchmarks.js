// Shared ERP-benchmark renderer for the CEO dashboard + analytics pages.
// Values come from the API (/api/ceo/dashboard, /api/ceo/analytics -> benchmarks).
// A metric the system does not record is null and is shown as "—" / "No data"
// instead of a made-up number.
(function () {
    const DEFS = {
        dso: { unit: ' Days', target: 45, lowerBetter: true, desc: 'Unpaid orders ÷ last-30-day realized revenue × 30.' },
        o2c: { unit: ' Days', target: 5, lowerBetter: true, desc: 'Time from order placement to counter handover.' },
        otd: { unit: '%', target: 95, lowerBetter: false, desc: 'Share of orders released within their claim window.' },
        fpy: { unit: '%', target: 90, lowerBetter: false, desc: 'Share of batches passing quality check on the first run.' }
    };

    window.applyBenchmarks = function applyBenchmarks(bm) {
        document.querySelectorAll('[data-bm]').forEach(cell => {
            const def = DEFS[cell.dataset.bm];
            if (!def) return;

            const raw = bm ? bm[cell.dataset.bm] : null;
            const value = raw === null || raw === undefined ? null : Number(raw);
            const valEl = cell.querySelector('[data-bm-value]');
            const statusEl = cell.querySelector('[data-bm-status]');
            const barEl = cell.querySelector('.bm-progress-fill');
            const descEl = cell.querySelector('[data-bm-desc]');

            if (value === null || !Number.isFinite(value)) {
                if (valEl) valEl.textContent = '—';
                if (statusEl) { statusEl.textContent = 'No data'; statusEl.className = 'bm-pill nodata'; }
                if (barEl) barEl.style.width = '0%';
                if (descEl) descEl.textContent = def.desc + ' Not tracked by the system yet.';
                return;
            }

            const ok = def.lowerBetter ? value <= def.target : value >= def.target;
            const width = def.lowerBetter ? Math.min(100, (value / def.target) * 100) : Math.min(100, Math.max(0, value));
            if (valEl) valEl.textContent = value.toLocaleString('en-US', { maximumFractionDigits: 1 }) + def.unit;
            if (statusEl) { statusEl.textContent = ok ? 'On target' : 'Off target'; statusEl.className = 'bm-pill ' + (ok ? 'optimal' : 'warn'); }
            if (barEl) barEl.style.width = width + '%';
            if (descEl) descEl.textContent = def.desc;
        });
    };
})();
