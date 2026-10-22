# Restock flow fixes

## 1. Receive & Audit no longer fails after adding stock
- `POST /api/procurement-officer/mark-purchased` (src/routes/employeeRoutes.js) now accepts `status: 'RECEIVED'` and `audit_note`.
  - Allowed from `APPROVED` or `PURCHASED`; no longer blocked by the PHP 300 direct-buy cap (that cap now applies only to Buy Instant).
  - Audit note is appended to the expense's notes. Vendor total is credited on receive for items that were never direct-bought.
  - Double receive returns 400 instead of silently succeeding.
- Receive handlers (inventoryOfficer/js/procurement.js and dashboard.js) now mark RECEIVED first, then add stock, so a retry can't double-count inventory.
- `RECEIVED` added to the status lists that count spend / hide pending items (employeeRoutes.js, server.js CEO audit + approval history).

## 2. Finance approval for PHP 301-500
- New routes: `GET /api/finance-officer/requisitions`, `POST /api/finance-officer/requisitions/action` (approve / reject with required reason; only acts on `PENDING_FINANCE`; rejection reason saved to the expense notes; activity logged).
- New "Requisition Approvals" tab on the Finance Budget page (budget.html, js/budget.js, css/budget.css).

## 3. Item name mismatch
- Receive flow strips the "Restock: " prefix so stock tops up the existing inventory item instead of creating "Restock: X".

## Notes
- Not changed: the Finance "Disbursement Vouchers" tab still has no backing POST route (its Add form posts to /api/finance-officer/expenses, which only has GET).
- Not changed: CEO rejection reason is still not saved on the expense row.
- migrations/2026-10-22_allow_received_status.sql is only needed if your expenses.status column has a CHECK constraint.
