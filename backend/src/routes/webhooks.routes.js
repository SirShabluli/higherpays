'use strict';
const notifier = require('../notify');
const express = require('express');
const { pool, withSystem } = require('../db');
const { asyncHandler } = require('../util/audit');
const provider = require('../providers/mantapay');

const router = express.Router();

// Trusted system transaction (platform context => can write across tenants and
// invoke the SECURITY DEFINER payout functions).
// Trusted server context: the tenant isn't known until the endpoint id resolves.
const systemTx = withSystem;

const PROVIDER = 'mantapay';

// POST /webhooks/payment/:endpoint
// QRMoney posts application/x-www-form-urlencoded with the final result.
// Authenticity (QRMoney v1.1):
//   PRIMARY  — X-Signature = Base64(HMAC-SHA512(raw_body, api_key)), verified over
//              the raw bytes before parsing; reject if missing or mismatched.
//   SECONDARY— merchantId in the payload matches the workspace's stored MID.
//   Plus the unguessable per-workspace endpoint id in this URL.
router.post('/payment/:endpoint', asyncHandler(async (req, res) => {
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(String(req.body || ''));

  // 1) resolve the workspace (and its provider config) from the opaque endpoint id
  // RLS is on in production and `workspaces` is FORCE-protected, so a bare query
  // here returns zero rows and every webhook 404s. Resolve inside a system context.
  const ws = await withSystem(async (c) => (await c.query(
    'SELECT id, mid, provider_config_ref FROM workspaces WHERE webhook_endpoint_id = $1', [req.params.endpoint])).rows[0]);
  if (!ws) return res.status(404).json({ error: 'unknown_endpoint' });

  // 2) verify the signature over the RAW body, keyed with this workspace's API key
  const apiKey = provider.resolveApiKey(ws);
  const signatureValid = provider.verifyWebhookSignature(raw, apiKey, req.headers[provider.SIGNATURE_HEADER]);

  // 3) parse the form body
  let ev;
  try { ev = provider.parseWebhook(raw); }
  catch { return res.status(400).json({ error: 'bad_payload' }); }

  // 4) secondary check: merchantId must match the workspace's MID (when set)
  const merchantOk = !ws.mid || (ev.merchantId && ev.merchantId === ws.mid);
  const authOk = signatureValid && merchantOk;

  // 5) idempotency: record the event; a duplicate id is acknowledged, not re-run
  const inserted = await systemTx(async (c) => {
    const r = (await c.query(
      `INSERT INTO webhook_events (workspace_id, provider, event_type, provider_event_id, signature_valid, payload)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (provider, provider_event_id) DO NOTHING
       RETURNING id`,
      [ws.id, PROVIDER, ev.status, ev.providerEventId, signatureValid, ev.fields])).rows[0];
    return r ? r.id : null;
  });
  if (!inserted) return res.status(200).json({ ok: true, duplicate: true });

  // 6) reject unauthenticated events (recorded above for audit, never processed)
  if (!signatureValid) return res.status(401).json({ error: 'bad_signature' });
  if (!merchantOk) return res.status(400).json({ error: 'merchant_mismatch' });
  if (ev.status === 'unknown') {
    await systemTx((c) => c.query('UPDATE webhook_events SET processed=true, processed_at=now() WHERE id=$1', [inserted]));
    return res.status(200).json({ ok: true, ignored: 'non_final_status' });
  }

  // 6) record the transaction (with the ACTUAL fee) and fire the payout engine
  try {
    const result = await systemTx(async (c) => {
      const link = ev.referenceId
        ? (await c.query('SELECT * FROM payment_links WHERE reference_id = $1 AND workspace_id = $2', [ev.referenceId, ws.id])).rows[0]
        : null;

      const status = ev.status === 'approved' ? 'approved' : 'declined';
      const gross = ev.gross != null ? ev.gross : (link ? link.amount : 0);
      const fee = ev.fee != null ? ev.fee : 0;
      const net = ev.net != null ? ev.net : gross - fee;

      const tx = (await c.query(
        `INSERT INTO transactions
           (workspace_id, payment_link_id, creator_id, customer_id, attributed_membership_id,
            type, status, gross, fee, net, currency, provider_transaction_id, occurred_at, raw_payload)
         VALUES ($1,$2,$3,$4,$5,'payment'::txn_type,$6::txn_status,$7,$8,$9,$10,$11,now(),$12)
         ON CONFLICT (workspace_id, provider_transaction_id)
           DO UPDATE SET status = EXCLUDED.status, fee = EXCLUDED.fee, net = EXCLUDED.net
         RETURNING id`,
        [ws.id, link ? link.id : null, link ? link.creator_id : null, link ? link.customer_id : null,
         link ? link.created_by : null, status, gross, fee, net, ev.currency, ev.transactionId, ev.fields])).rows[0];

      if (link) {
        const linkStatus = ev.status === 'approved' ? 'paid' : 'failed';
        if (ev.status === 'approved') await c.query('UPDATE payment_links SET status=$2::link_status, paid_at=now() WHERE id=$1', [link.id, linkStatus]);
        else await c.query('UPDATE payment_links SET status=$2::link_status WHERE id=$1', [link.id, linkStatus]);
      }

      // only an approved payment produces a payout
      if (ev.status === 'approved') {
        const hasSale = (await c.query("SELECT 1 FROM commission_entries WHERE transaction_id=$1 AND entry_type='sale'", [tx.id])).rows[0];
        if (!hasSale) await c.query('SELECT fn_post_sale($1)', [tx.id]);
      }

      // Notify the team (in-app feed + Telegram). Best-effort, and wrapped in a
      // SAVEPOINT: a failed notification insert would otherwise abort the whole
      // transaction and lose the payment itself.
      await c.query('SAVEPOINT notify_sp');
      try {
        const creatorName = link && link.creator_id
          ? ((await c.query('SELECT stage_name FROM creators WHERE id=$1', [link.creator_id])).rows[0] || {}).stage_name
          : null;
        if (ev.status === 'approved') {
          await notifier.notify(c, ws.id, {
            event: 'payment.paid',
            title: 'Payment received',
            body: creatorName ? `Creator: ${creatorName}` : null,
            amount: gross, currency: ev.currency,
            entityType: 'transaction', entityId: tx.id,
          });
        } else {
          await notifier.notify(c, ws.id, {
            event: 'payment.failed',
            title: 'Payment declined',
            body: creatorName ? `Creator: ${creatorName}` : null,
            amount: gross, currency: ev.currency,
            entityType: 'transaction', entityId: tx.id,
          });
        }
        await c.query('RELEASE SAVEPOINT notify_sp');
      } catch (e) {
        await c.query('ROLLBACK TO SAVEPOINT notify_sp').catch(() => {});
        console.error('[webhook] notify failed (payment still recorded):', e.message);
      }

      await c.query('UPDATE webhook_events SET processed=true, processed_at=now() WHERE id=$1', [inserted]);
      return { transactionId: tx.id, status: ev.status };
    });
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    console.error('[webhook] processing failed:', err.message);
    return res.status(500).json({ error: 'processing_failed' });
  }
}));

module.exports = router;
