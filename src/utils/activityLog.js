// src/utils/activityLog.js
//
// Writes one row to `activity_logs` for anything an admin/CEO needs an audit
// trail of (employee/customer changes, production plans, store settings,
// staff logins). This NEVER throws and never blocks the caller — a logging
// failure should not break the real action (adding an employee, toggling a
// status, etc). Errors are only console.warn'd.
//
// Table (run once in Supabase SQL editor — see sql/activity_logs.sql):
//   activity_logs(id, actor_id, actor_type, actor_role, actor_name, action,
//                 category, description, target_type, target_id,
//                 target_label, metadata, ip_address, created_at)

function getClientIp(req) {
  if (!req) return null;
  const fwd = req.headers && req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || (req.connection && req.connection.remoteAddress) || null;
}

/**
 * @param {object} supabase - the Supabase client
 * @param {object} opts
 * @param {object} [opts.req] - the Express request, used to auto-fill actor id/type (from req.staff, set by requireStaff) and IP
 * @param {number|string} [opts.actorId] - overrides req.staff.id
 * @param {string} [opts.actorType] - 'admin' | 'ceo' | 'employee' | 'system' — overrides req.staff.type
 * @param {string} [opts.actorRole] - e.g. 'Sales Officer'
 * @param {string} [opts.actorName] - human name, if already known (e.g. from the login row)
 * @param {string} opts.action - short machine key, e.g. 'employee.created'
 * @param {string} opts.category - 'employee' | 'customer' | 'production' | 'settings' | 'auth'
 * @param {string} opts.description - human-readable sentence shown in the UI
 * @param {string} [opts.targetType] - e.g. 'employee', 'customer', 'production_log'
 * @param {number|string} [opts.targetId]
 * @param {string} [opts.targetLabel] - display name of the target (survives the target later being deleted)
 * @param {object} [opts.metadata] - any extra structured detail (JSON)
 */
async function logActivity(supabase, opts = {}) {
  try {
    if (!supabase) return;
    const {
      req = null,
      actorRole = null,
      actorName = null,
      action,
      category,
      description,
      targetType = null,
      targetId = null,
      targetLabel = null,
      metadata = null
    } = opts;

    if (!action || !category || !description) {
      console.warn('[activityLog] skipped: action, category and description are required.');
      return;
    }

    const actorId = opts.actorId !== undefined && opts.actorId !== null
      ? opts.actorId
      : (req && req.staff ? req.staff.id : null);

    const actorType = opts.actorType || (req && req.staff ? req.staff.type : null);

    const row = {
      actor_id: actorId ?? null,
      actor_type: actorType || null,
      actor_role: actorRole || (req && req.staff && Array.isArray(req.staff.roles) ? (req.staff.roles[0] || null) : null),
      actor_name: actorName || null,
      action,
      category,
      description,
      target_type: targetType,
      target_id: targetId !== null && targetId !== undefined ? String(targetId) : null,
      target_label: targetLabel || null,
      metadata: metadata || null,
      ip_address: getClientIp(req)
    };

    const { error } = await supabase.from('activity_logs').insert([row]);
    if (error) console.warn('[activityLog] insert failed:', error.message);
  } catch (e) {
    console.warn('[activityLog] unexpected error:', e.message);
  }
}

module.exports = { logActivity };
