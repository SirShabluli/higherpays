'use strict';
// RLS enforcement: agency A must not see agency B's data. This is the single
// most important behavioural test in the suite — every past production bug in
// this repo was invisible until we ran with a non-superuser DB role.
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { app } = require('../helpers/setup');
const { createTenant, createCreator } = require('../helpers/tenant');

test('agency A cannot see agency B creators (RLS)', async () => {
  const a = await createTenant(app);
  const b = await createTenant(app);
  await createCreator(app, a, { stageName: 'A-only creator' });
  await createCreator(app, b, { stageName: 'B-only creator' });

  const aRes = await request(app)
    .get(`/workspaces/${a.workspaceId}/creators`)
    .set(a.authHeaders)
    .expect(200);
  const names = aRes.body.creators.map((c) => c.stage_name);
  assert.ok(names.includes('A-only creator'));
  assert.ok(!names.includes('B-only creator'));
});

test('agency A gets 403 hitting agency B endpoints with its own token', async () => {
  const a = await createTenant(app);
  const b = await createTenant(app);
  // Point A's token at B's workspace id — X-Workspace-Id overrides the URL slug
  // (see requireWorkspace middleware).
  await request(app)
    .get(`/workspaces/${b.workspaceId}/creators`)
    .set({ Authorization: `Bearer ${a.accessToken}`, 'X-Workspace-Id': b.workspaceId })
    .expect(403);
});
