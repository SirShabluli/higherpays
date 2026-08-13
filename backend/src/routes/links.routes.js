'use strict';
const express = require('express');
const { withWorkspace } = require('../db');
const { requirePermission } = require('../middleware');
const { asyncHandler, audit } = require('../util/audit');
const { badRequest } = require('../util/validate');
const config = require('../config');
const provider = require('../providers/mantapay');

const router = express.Router({ mergeParams: true });
const wid = (req) => req.membership.workspaceId;
const uid = (req) => req.user.id;

const MIN_FIXED_AMOUNT = 3;             // provider minimum: 3 USD/EUR
const CHATTER_RATE_WINDOW_SECONDS = 30; // rate limit: one link per chatter per 30s

// -----------------------------------------------------------------------------
// Provider integration — QRMoney Hosted Checkout (POST /c3pl/dp/checkout).
// Card data never passes through here; the fan pays on QRMoney's hosted page.
// -----------------------------------------------------------------------------
async function generateProviderLink({ ws, currency, amount, pricingMode, referenceId, notes }) {
  const apiKey = provider.resolveApiKey(ws);
  // Build this workspace's notify URL (webhook) when a public base is configured;
  // otherwise QRMoney uses the notifyUrl from the merchant profile.
  const notifyUrl = config.webhookPublicBase
    ? `${config.webhookPublicBase.replace(/\/$/, '')}/webhooks/payment/${ws.webhook_endpoint_id}`
    : undefined;
  const { checkoutUrl } = await provider.createCheckout({
    apiKey,
    unit: currency,
    amount: pricingMode === 'fixed' ? amount : undefined, // omit => customer enters it
    referenceId,
    notifyUrl,
    notes,
  });
  return { providerLinkId: referenceId, url: checkoutUrl };
}

// GET /workspaces/:workspaceId/links
// Chatters see only the links they created; everyone else sees all in-workspace.
router.get('/', requirePermission('links.view'), asyncHandler(async (req, res) => {
  const chatterScoped = req.membership.role === 'chatter';
  const vals = [wid(req)];
  let scope = '';
  if (chatterScoped) { vals.push(req.membership.id); scope = `AND pl.created_by = $${vals.length}`; }
  const rows = await withWorkspace(wid(req), uid(req), async (c) => (await c.query(
    `SELECT pl.id, pl.pricing_mode, pl.amount, pl.currency, pl.provider_link_id,
            CASE WHEN pl.status = 'created' AND pl.created_at < now() - ($${vals.length + 1} || ' minutes')::interval
                 THEN 'expired' ELSE pl.status END AS status,
            pl.reference_id, pl.created_at, pl.paid_at,
            cr.stage_name AS creator, cu.alias AS customer,
            u.full_name AS chatter
     FROM payment_links pl
     LEFT JOIN creators cr ON cr.id = pl.creator_id
     LEFT JOIN customers cu ON cu.id = pl.customer_id
     LEFT JOIN memberships m ON m.id = pl.created_by
     LEFT JOIN users u ON u.id = m.user_id
     WHERE pl.workspace_id = $1 ${scope}
     ORDER BY pl.created_at DESC LIMIT 200`, [...vals, config.linkTtlMinutes])).rows);
  res.json({ links: rows });
}));

// GET /workspaces/:workspaceId/links/:id
router.get('/:id', requirePermission('links.view'), asyncHandler(async (req, res) => {
  const row = await withWorkspace(wid(req), uid(req), async (c) => (await c.query(
    `SELECT id, creator_id, customer_id, created_by, pricing_mode, amount, currency,
            status, provider_link_id, reference_id, description, created_at, paid_at
     FROM payment_links WHERE workspace_id = $1 AND id = $2`, [wid(req), req.params.id])).rows[0]);
  if (!row) return res.status(404).json({ error: 'not_found' });
  if (req.membership.role === 'chatter' && row.created_by !== req.membership.id) {
    return res.status(403).json({ error: 'forbidden' });
  }
  res.json(row);
}));

// POST /workspaces/:workspaceId/links
// body: { creatorId, customerId?, pricingMode: 'fixed'|'open', amount?, currency, description? }
router.post('/', requirePermission('links.create'), asyncHandler(async (req, res) => {
  const { creatorId, customerId, pricingMode = 'fixed', amount, currency, description } = req.body || {};
  if (!creatorId) return badRequest(res, 'creatorId is required', ['creatorId']);
  if (!['fixed', 'open'].includes(pricingMode)) return badRequest(res, "pricingMode must be 'fixed' or 'open'", ['pricingMode']);
  if (!/^[A-Za-z]{3}$/.test(currency || '')) return badRequest(res, 'currency must be a 3-letter code', ['currency']);

  let amt = null;
  if (pricingMode === 'fixed') {
    amt = Number(amount);
    if (!(amt > 0)) return badRequest(res, 'amount is required for a fixed link', ['amount']);
    if (amt < MIN_FIXED_AMOUNT) return badRequest(res, `minimum amount is ${MIN_FIXED_AMOUNT}`, ['amount']);
    // workspace guardrails (set in Settings). Enforced here so the console can't be bypassed.
    const lim = await withWorkspace(wid(req), uid(req), async (c) => (await c.query(
      'SELECT min_link_amount, max_link_amount FROM workspaces WHERE id=$1', [wid(req)])).rows[0]);
    if (lim && lim.min_link_amount != null && amt < Number(lim.min_link_amount)) {
      return badRequest(res, `amount is below the workspace minimum of ${Number(lim.min_link_amount)}`, ['amount']);
    }
    if (lim && lim.max_link_amount != null && amt > Number(lim.max_link_amount)) {
      return badRequest(res, `amount is above the workspace maximum of ${Number(lim.max_link_amount)}`, ['amount']);
    }
  } else if (amount != null) {
    return badRequest(res, 'open links must not carry an amount', ['amount']);
  }

  const cur = currency.toUpperCase();
  if (!config.supportedCurrencies.includes(cur)) {
    return badRequest(res, `currency ${cur} is not enabled (supported: ${config.supportedCurrencies.join(', ')})`, ['currency']);
  }
  const referenceId = 'ord_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  const result = await withWorkspace(wid(req), uid(req), async (c) => {
    // Rate limit: only for chatters, one link per CHATTER_RATE_WINDOW_SECONDS.
    if (req.membership.role === 'chatter') {
      const recent = (await c.query(
        `SELECT created_at FROM payment_links
         WHERE workspace_id = $1 AND created_by = $2
           AND created_at > now() - ($3 || ' seconds')::interval
         ORDER BY created_at DESC LIMIT 1`,
        [wid(req), req.membership.id, CHATTER_RATE_WINDOW_SECONDS])).rows[0];
      if (recent) {
        const elapsed = Math.floor((Date.now() - new Date(recent.created_at).getTime()) / 1000);
        return { rateLimited: Math.max(1, CHATTER_RATE_WINDOW_SECONDS - elapsed) };
      }
    }

    // creator must belong to this workspace
    const creator = (await c.query(
      `SELECT id FROM creators WHERE id = $1 AND workspace_id = $2`, [creatorId, wid(req)])).rows[0];
    if (!creator) return { err: 'creator_not_found' };
    if (customerId) {
      const cust = (await c.query(
        `SELECT id FROM customers WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL`, [customerId, wid(req)])).rows[0];
      if (!cust) return { err: 'customer_not_found' };
    }

    // workspace provider config (endpoint id + secret-store key name; never the key itself)
    const ws = (await c.query(
      `SELECT id, webhook_endpoint_id, provider_config_ref, mid FROM workspaces WHERE id = $1`, [wid(req)])).rows[0];

    // ask QRMoney for the hosted checkout URL
    const provider = await generateProviderLink({ ws, currency: cur, amount: amt, pricingMode, referenceId, notes: description });

    const link = (await c.query(
      `INSERT INTO payment_links
         (workspace_id, creator_id, customer_id, created_by, pricing_mode, amount, currency, status, provider_link_id, reference_id, description)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'created',$8,$9,$10)
       RETURNING id, pricing_mode, amount, currency, status, provider_link_id, reference_id, created_at`,
      [wid(req), creatorId, customerId || null, req.membership.id, pricingMode, amt, cur, provider.providerLinkId, referenceId, description || null])).rows[0];
    return { link, url: provider.url };
  });

  if (result.rateLimited) {
    res.setHeader('Retry-After', String(result.rateLimited));
    return res.status(429).json({ error: 'rate_limited', scope: 'chatter', retryAfterSeconds: result.rateLimited });
  }
  if (result.err) return res.status(404).json({ error: result.err });

  await audit({ workspaceId: wid(req), actorUserId: uid(req), action: 'link.create', entityType: 'payment_link', entityId: result.link.id, metadata: { pricingMode, amount: amt, currency: cur } });
  res.status(201).json({ ...result.link, url: result.url });
}));

// POST /workspaces/:wid/links/reconcile — safety-net for links whose final
// webhook never arrived. Polls the provider status endpoint for links still
// 'created'/'opened' past their expiry (or `graceMinutes`), and applies the
// outcome idempotently (same keys the webhook uses, so it never double-posts
// and never overrides a link the webhook already resolved).
router.post('/reconcile', requirePermission('commissions.manage'), asyncHandler(async (req, res) => {
  const graceMin = Number(req.body && req.body.graceMinutes) || 10;
  const ws = (await withWorkspace(wid(req), uid(req), (c) =>
    c.query('SELECT id, mid, provider_config_ref FROM workspaces WHERE id=$1', [wid(req)]))).rows[0];
  const apiKey = provider.resolveApiKey(ws);
  const summary = { checked: 0, updated: [], skipped: [] };

  await withWorkspace(wid(req), uid(req), async (c) => {
    const stuck = (await c.query(
      `SELECT id, reference_id, provider_request_id, amount, currency, creator_id, customer_id, created_by, expires_at
       FROM payment_links
       WHERE status IN ('created','opened')
         AND (expires_at < now() OR (expires_at IS NULL AND created_at < now() - ($1 || ' minutes')::interval))`,
      [String(graceMin)])).rows;

    for (const link of stuck) {
      summary.checked++;
      // resolve the provider payment-request id (cached, else from a stored webhook event)
      let prid = link.provider_request_id;
      if (!prid && link.reference_id) {
        const row = (await c.query(
          `SELECT payload->>'id' AS id FROM webhook_events
           WHERE workspace_id=$1 AND payload->>'referenceId'=$2 AND payload->>'id' IS NOT NULL
           ORDER BY received_at DESC LIMIT 1`, [wid(req), link.reference_id])).rows[0];
        prid = row && row.id;
      }
      if (!prid) {
        // nothing to poll — expire it if it's genuinely past its expiry
        if (link.expires_at) {
          await c.query("UPDATE payment_links SET status='expired' WHERE id=$1 AND status IN ('created','opened')", [link.id]);
          summary.updated.push({ linkId: link.id, to: 'expired', via: 'no_provider_id' });
        } else summary.skipped.push({ linkId: link.id, reason: 'no_provider_id' });
        continue;
      }
      await c.query('UPDATE payment_links SET provider_request_id=$2 WHERE id=$1', [link.id, prid]);

      let s;
      try { s = await provider.getPaymentStatus(apiKey, prid); }
      catch (e) { summary.skipped.push({ linkId: link.id, reason: 'status_error', detail: e.detail || e.message }); continue; }
      const st = provider.mapPaymentStatus(s.payment_request_status_id);

      if (st === 'pending') {
        // In 'transition' mode codes 2 and 4 are ambiguous, so a genuine decline
        // also lands here and would otherwise be polled forever. The link is
        // already past its expiry window, so close it as EXPIRED (not 'failed' —
        // we cannot honestly claim a decline). If it does settle later, the paid
        // webhook still records the transaction and flips the link to paid.
        if (provider.isAmbiguousStatus(s.payment_request_status_id) && link.expires_at) {
          await c.query("UPDATE payment_links SET status='expired' WHERE id=$1 AND status IN ('created','opened')", [link.id]);
          summary.updated.push({ linkId: link.id, to: 'expired', reason: 'ambiguous_status_past_expiry' });
          continue;
        }
        summary.skipped.push({ linkId: link.id, reason: 'still_pending' }); continue;
      }
      if (st === 'declined' || st === 'canceled') {
        await c.query("UPDATE payment_links SET status='failed' WHERE id=$1 AND status IN ('created','opened')", [link.id]);
        summary.updated.push({ linkId: link.id, to: 'failed', reason: st }); continue;
      }
      if (st === 'paid') {
        const gross = s.gross_amount != null ? Number(s.gross_amount) : Number(link.amount || 0);
        const fee = s.fee != null ? Number(s.fee) : 0;
        const net = s.net_amount != null ? Number(s.net_amount) : gross - fee;
        const cur = (s.unit || link.currency || 'EUR').toString().toUpperCase();
        const ptx = s.transaction_id || ('pr-' + prid);
        const tx = (await c.query(
          `INSERT INTO transactions
             (workspace_id, payment_link_id, creator_id, customer_id, attributed_membership_id,
              type, status, gross, fee, net, currency, provider_transaction_id, occurred_at, raw_payload)
           VALUES ($1,$2,$3,$4,$5,'payment'::txn_type,'approved'::txn_status,$6,$7,$8,$9,$10,now(),$11)
           ON CONFLICT (workspace_id, provider_transaction_id)
             DO UPDATE SET status=EXCLUDED.status, fee=EXCLUDED.fee, net=EXCLUDED.net
           RETURNING id`,
          [wid(req), link.id, link.creator_id, link.customer_id, link.created_by, gross, fee, net, cur, ptx, s])).rows[0];
        const hasSale = (await c.query("SELECT 1 FROM commission_entries WHERE transaction_id=$1 AND entry_type='sale'", [tx.id])).rows[0];
        if (!hasSale) await c.query('SELECT fn_post_sale($1)', [tx.id]);
        await c.query("UPDATE payment_links SET status='paid', paid_at=now() WHERE id=$1", [link.id]);
        summary.updated.push({ linkId: link.id, to: 'paid', amount: gross }); continue;
      }
      if (st === 'refund' || st === 'chargeback') {
        await c.query("UPDATE payment_links SET status='refunded' WHERE id=$1", [link.id]);
        summary.updated.push({ linkId: link.id, to: 'refunded', reason: st }); continue;
      }
      summary.skipped.push({ linkId: link.id, reason: 'status_' + st });
    }
  });

  res.json(summary);
}));

module.exports = router;
