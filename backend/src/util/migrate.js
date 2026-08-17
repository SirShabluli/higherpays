'use strict';
// Applies every migration in /migrations in order, exactly once. Tracks applied
// files in a schema_migrations table. Safe to run repeatedly.
//   node src/util/migrate.js
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const config = require('../config');

async function run() {
  // Migrations need DDL and must not be subject to RLS, so we prefer a
  // dedicated MIGRATIONS_DATABASE_URL (owner/superuser). Falls back to the
  // main DATABASE_URL for local dev where the app connects as owner anyway.
  const migrationsUrl = process.env.MIGRATIONS_DATABASE_URL || config.databaseUrl;
  const pool = new Pool({ connectionString: migrationsUrl });
  const dir = path.join(__dirname, '..', '..', 'migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const client = await pool.connect();
  let ran = 0;
  try {
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const applied = new Set((await client.query('SELECT filename FROM schema_migrations')).rows.map((r) => r.filename));

    for (const f of files) {
      if (applied.has(f)) continue;
      // The runner wraps each migration + its bookkeeping in ONE transaction, so
      // strip the file's own top-level BEGIN;/COMMIT; markers (PL/pgSQL BEGIN/END
      // inside function bodies has no semicolon and is left untouched).
      let sql = fs.readFileSync(path.join(dir, f), 'utf8')
        .replace(/^\s*BEGIN;\s*$/gim, '')
        .replace(/^\s*COMMIT;\s*$/gim, '');
      process.stdout.write(`  → ${f} ... `);
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [f]);
        await client.query('COMMIT');
        console.log('done');
        ran++;
      } catch (e) {
        await client.query('ROLLBACK');
        console.error(`FAILED\n${e.message}`);
        process.exitCode = 1;
        return;
      }
    }
    console.log(ran ? `Applied ${ran} migration(s).` : 'Database already up to date.');
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) run();
module.exports = { run };
