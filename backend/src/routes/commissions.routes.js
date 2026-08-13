'use strict';
const express = require('express');
const { withWorkspace } = require('../db');
const { requirePermission } = require('../middleware');
const { asyncHandler, audit } = require('../util/audit');
const { badRequest } = require('../util/validate');

const router = express.Router({ mergeParams: true });
const wid = (req) => req.membership.workspaceId;
const uid = (req) => req.user.id;

const pct = (v) => typeof v === 'number' && v >= 0 && v <= 100;

// GET /workspaces/:workspaceId/commissions
// Returns the current creator/chatter split for the workspace, plus the blended
// platform fee that applies (for display — the owner does not set this).
router.get('/', requirePermission('commissions.view'), asyncHandler(async (req, res) => {
  const data = await withWorkspace(wid(req), uid(req), async (c) => {
    const rule = (await c.query(
      `SELECT creator_split_pct, agency_split_pct, chatter_pct, effective_from
       FROM commission_rules
       WHERE workspace_id = $1 AND creator_id IS NULL
       ORDER BY effective_from DESC LIMIT 1`, [wid(req)])).rows[0] || null;

    const org = (await c.query(`SELECT organization_id FROM workspaces WHERE id = $1`, [wid(req)])).rows[0];
    const fee = (await c.query(`SELECT * FROM effective_platform_fee($1, now())`, [org.organization_id])).rows[0] || null;
    return { rule, platformFee: fee };
  });

  res.json({
    // sensible defaults if the owner hasn't set splits yet
    commission: data.rule || { creator_split_pct: 70, agency_split_pct: 30, chatter_pct: 0, effective_from: null },
    platformFee: data.platformFee, // { psp_rate_pct, margin_rate_pct, blended_rate_pct } or null
  });
}));

// PUT /workspaces/:workspaceId/commissions   { creatorSplitPct, chatterPct }
// Open fields — the workspace owner sets these at will. Agency share is derived
// (100 − creator). A new versioned row is written; history is preserved.
router.put('/', requirePermission('commissions.manage'), asyncHandler(async (req, res) => {
  const { creatorSplitPct, chatterPct } = req.body || {};
  if (!pct(creatorSplitPct)) return badRequest(res, 'creatorSplitPct must be 0..100', ['creatorSplitPct']);
  if (!pct(chatterPct)) return badRequest(res, 'chatterPct must be 0..100', ['chatterPct']);

  const agencySplit = 100 - creatorSplitPct;
  // Soft guard: chatter commission is taken from the agency share; warn (don't block)
  // if it would exceed it, since the owner may intend a promo/loss-leader.
  const warning = chatterPct > agencySplit ? 'chatter_pct exceeds agency share; agency net will be negative' : undefined;

  const rule = await withWorkspace(wid(req), uid(req), async (c) => (await c.query(
    `INSERT INTO commission_rules (workspace_id, creator_id, creator_split_pct, agency_split_pct, chatter_pct, created_by)
     VALUES ($1, NULL, $2, $3, $4, $5)
     RETURNING creator_split_pct, agency_split_pct, chatter_pct, effective_from`,
    [wid(req), creatorSplitPct, agencySplit, chatterPct, uid(req)])).rows[0]);

  await audit({ workspaceId: wid(req), actorUserId: uid(req), action: 'commissions.update', metadata: { creatorSplitPct, chatterPct } });
  res.status(201).json({ commission: rule, warning });
}));

module.exports = router;
