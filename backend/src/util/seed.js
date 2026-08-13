'use strict';
// One-command bootstrap for a fresh install: creates an owner + agency, grants
// platform super-admin, and sets fees + splits so you can log in and test
// immediately. Idempotent (skips if the seed email already exists).
//
//   SEED_EMAIL=you@higherpays.com SEED_PASSWORD='strong-pass' npm run seed
const { Pool } = require('pg');
const config = require('../config');
const { hashPassword } = require('../auth/passwords');
const { seedRolesForWorkspace } = require('../auth/permissions');

const EMAIL = process.env.SEED_EMAIL || 'owner@higherpays.com';
const PASSWORD = process.env.SEED_PASSWORD || 'change-me-now-8+';
const FULL_NAME = process.env.SEED_NAME || 'HigherPays Owner';
const ORG_NAME = process.env.SEED_ORG || 'HigherPays';
const PSP = Number(process.env.SEED_PSP_RATE || 8);
const MARGIN = Number(process.env.SEED_MARGIN_RATE || 0); // own agency: no margin

async function run() {
  if (String(PASSWORD).length < 8) { console.error('SEED_PASSWORD must be at least 8 characters.'); process.exit(1); }
  const pool = new Pool({ connectionString: config.databaseUrl });
  const c = await pool.connect();
  try {
    if ((await c.query('SELECT 1 FROM users WHERE email=$1', [EMAIL])).rows[0]) {
      console.log(`User ${EMAIL} already exists — nothing to seed.`);
      return;
    }
    await c.query('BEGIN');
    // some tables have RLS; run the seed in platform context
    if (config.useRls) await c.query("SELECT set_config('app.platform_admin','on',true)");

    const org = (await c.query('INSERT INTO organizations (name, slug) VALUES ($1,$2) RETURNING id',
      [ORG_NAME, ORG_NAME.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Math.random().toString(36).slice(2, 7)])).rows[0];
    const ws = (await c.query("INSERT INTO workspaces (organization_id, name, currency, mid, provider_name) VALUES ($1,$2,'EUR',$3,'mantapay') RETURNING id, webhook_endpoint_id",
      [org.id, ORG_NAME, process.env.SEED_MID || 'MID-SET-ME'])).rows[0];
    const user = (await c.query('INSERT INTO users (email, password_hash, full_name) VALUES ($1,$2,$3) RETURNING id',
      [EMAIL, await hashPassword(PASSWORD), FULL_NAME])).rows[0];
    await c.query("INSERT INTO memberships (workspace_id, user_id, role) VALUES ($1,$2,'owner')", [ws.id, user.id]);
    await seedRolesForWorkspace(c, ws.id);
    await c.query("INSERT INTO platform_admins (user_id, role) VALUES ($1,'super_admin')", [user.id]);

    await c.query('INSERT INTO platform_fee_rates (organization_id, psp_rate_pct, margin_rate_pct) VALUES ($1,$2,$3)', [org.id, PSP, MARGIN]);
    await c.query('INSERT INTO settlement_fee_config (organization_id, chargeback_fee) VALUES ($1,$2)', [org.id, Number(process.env.SEED_CHARGEBACK_FEE || 15)]);
    await c.query('INSERT INTO commission_rules (workspace_id, creator_id, creator_split_pct, agency_split_pct, chatter_pct) VALUES ($1,NULL,$2,$3,$4)',
      [ws.id, Number(process.env.SEED_CREATOR_SPLIT || 70), 100 - Number(process.env.SEED_CREATOR_SPLIT || 70), Number(process.env.SEED_CHATTER_PCT || 8)]);

    await c.query('COMMIT');
    console.log('\n✅ Seed complete.\n');
    console.log(`  Login:        ${EMAIL} / (the password you set)`);
    console.log(`  Role:         owner + platform super_admin`);
    console.log(`  Blended fee:  ${PSP + MARGIN}%  (PSP ${PSP}% + margin ${MARGIN}%)`);
    console.log(`  Webhook URL:  {WEBHOOK_PUBLIC_BASE}/webhooks/payment/${ws.webhook_endpoint_id}`);
    console.log('\n  Set the workspace MID and QRMONEY_API_KEY before taking real payments.\n');
  } catch (e) {
    await c.query('ROLLBACK');
    console.error('Seed failed:', e.message);
    process.exitCode = 1;
  } finally {
    c.release();
    await pool.end();
  }
}

if (require.main === module) run();
module.exports = { run };
