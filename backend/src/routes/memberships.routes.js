'use strict';
const express = require('express');
const { withWorkspace } = require('../db');
const { requirePermission } = require('../middleware');
const { asyncHandler } = require('../util/audit');
const router = express.Router({ mergeParams: true });
const wid = (req) => req.membership.workspaceId;
const uid = (req) => req.user.id;

// GET / — chatters in this workspace, with each one's own commission rate.
// The console needs this so payouts and dashboard cards use the real per-chatter
// rate rather than falling back to the workspace default.
router.get('/', requirePermission('team.view'), asyncHandler(async (req, res) => {
  const rows = await withWorkspace(wid(req), uid(req), async (c) => (await c.query(
    `SELECT m.id, u.full_name AS name, u.email, m.status, m.shift, m.commission_pct
       FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.role = 'chatter' ORDER BY u.full_name`)).rows);
  res.json({
    chatters: rows.map((r) => ({
      membershipId: r.id, name: r.name, email: r.email, status: r.status, shift: r.shift,
      commissionPct: r.commission_pct == null ? null : Number(r.commission_pct),
    })),
  });
}));

// PATCH /workspaces/:id/memberships/:membershipId — set a per-chatter commission %
router.patch('/:membershipId', requirePermission('commissions.manage'), asyncHandler(async (req, res) => {
  const { commissionPct } = req.body || {};
  const v = commissionPct == null || commissionPct === '' ? null : Number(commissionPct);
  if (v != null && !(v >= 0 && v <= 100)) return res.status(400).json({ error: 'commission_pct must be 0..100' });
  const row = await withWorkspace(wid(req), uid(req), async (c) => (await c.query(
    'UPDATE memberships SET commission_pct=$1 WHERE id=$2 AND workspace_id=$3 RETURNING id, commission_pct',
    [v, req.params.membershipId, wid(req)])).rows[0]);
  if (!row) return res.status(404).json({ error: 'not_found' });
  res.json({ id: row.id, commissionPct: row.commission_pct == null ? null : Number(row.commission_pct) });
}));

module.exports = router;
