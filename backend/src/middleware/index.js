'use strict';
const { verifyAccessToken } = require('../auth/tokens');
const { can, PERMISSIONS } = require('../auth/permissions');
const { query, withUser } = require('../db');

// 1) requireAuth — validates the bearer token, attaches req.user
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'missing_token' });
  }
  try {
    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub, email: payload.email, name: payload.name };
    next();
  } catch {
    return res.status(401).json({ error: 'invalid_token' });
  }
}

// 2) requireWorkspace — resolves the active workspace from the X-Workspace-Id
// header, confirms the user has an ACTIVE membership there, attaches
// req.membership = { id, workspaceId, role }. This is what ties a request to a
// tenant; without a valid membership the user cannot touch that workspace.
async function requireWorkspace(req, res, next) {
  const workspaceId = req.headers['x-workspace-id'] || req.params.workspaceId;
  if (!workspaceId) return res.status(400).json({ error: 'missing_workspace' });
  try {
    const rows = await withUser(req.user.id, async (c) => (await c.query(
      `SELECT m.id, m.role, r.permissions
       FROM memberships m
       LEFT JOIN roles r ON r.workspace_id = m.workspace_id AND r.name = m.role
       WHERE m.workspace_id = $1 AND m.user_id = $2 AND m.status = 'active'`,
      [workspaceId, req.user.id])).rows);
    if (rows.length === 0) {
      // Not a member — but a platform super-admin gets full operator access to
      // any workspace (to monitor and manage across agencies). RLS still scopes
      // reads/writes to this workspace via withWorkspace(workspaceId).
      const pa = (await query('SELECT role FROM platform_admins WHERE user_id = $1', [req.user.id])).rows[0];
      if (pa && pa.role === 'super_admin') {
        req.membership = { id: null, workspaceId, role: 'super_admin', permissions: new Set(PERMISSIONS), isPlatformOperator: true };
        return next();
      }
      return res.status(403).json({ error: 'not_a_member' });
    }
    const perms = rows[0].permissions ? new Set(rows[0].permissions) : null;
    req.membership = { id: rows[0].id, workspaceId, role: rows[0].role, permissions: perms };
    next();
  } catch (err) {
    next(err);
  }
}

// 3) requirePermission — the teeth. Prefers the workspace's role definition
// (editable data / custom roles); falls back to the built-in matrix if unset.
function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.membership) return res.status(500).json({ error: 'workspace_context_missing' });
    const ok = req.membership.permissions
      ? req.membership.permissions.has(permission)
      : can(req.membership.role, permission);
    if (!ok) return res.status(403).json({ error: 'forbidden', needed: permission });
    next();
  };
}

// 4) errorHandler — last middleware
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  console.error('[error]', err.message);
  if (res.headersSent) return;
  res.status(err.status || 500).json({ error: err.code || 'server_error' });
}

// requirePlatformAdmin — gate for HigherPays operator (Super-Admin) routes.
// This is ABOVE workspace roles; it is a separate grant in platform_admins.
async function requirePlatformAdmin(req, res, next) {
  try {
    const { rows } = await query('SELECT role FROM platform_admins WHERE user_id = $1', [req.user.id]);
    if (rows.length === 0) return res.status(403).json({ error: 'not_platform_admin' });
    req.platformRole = rows[0].role;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { requireAuth, requireWorkspace, requirePermission, requirePlatformAdmin, errorHandler };
