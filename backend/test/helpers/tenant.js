'use strict';
// Creates an isolated tenant + owner user via the real HTTP register flow.
// Every test that needs a workspace calls this to get its own island of data.

const request = require('supertest');

let counter = 0;
function tag() {
  counter += 1;
  return `${Date.now().toString(36)}${counter}${Math.random().toString(36).slice(2, 5)}`;
}

/**
 * @returns {Promise<{
 *   email: string,
 *   password: string,
 *   userId: string,
 *   workspaceId: string,
 *   accessToken: string,
 *   refreshToken: string,
 *   authHeaders: Record<string,string>,
 * }>}
 */
async function createTenant(app, opts = {}) {
  const t = tag();
  const email = opts.email || `owner+${t}@test.local`;
  const password = opts.password || 'passwordtest';
  const organizationName = opts.organizationName || `Agency ${t}`;

  const res = await request(app)
    .post('/auth/register')
    .send({ email, password, fullName: opts.fullName || 'Test Owner', organizationName })
    .expect(201);

  const workspaceId = res.body.workspaces[0].id;
  return {
    email,
    password,
    userId: res.body.user.id,
    workspaceId,
    accessToken: res.body.accessToken,
    refreshToken: res.body.refreshToken,
    authHeaders: {
      Authorization: `Bearer ${res.body.accessToken}`,
      'X-Workspace-Id': workspaceId,
    },
  };
}

/** Convenience: create a creator inside a tenant's workspace. */
async function createCreator(app, tenant, overrides = {}) {
  const res = await request(app)
    .post(`/workspaces/${tenant.workspaceId}/creators`)
    .set(tenant.authHeaders)
    .send({
      stageName: overrides.stageName || `Ava ${tag()}`,
      revenueModel: overrides.revenueModel || 'revshare',
      revenueSplitPct: overrides.revenueSplitPct ?? 70,
      status: overrides.status || 'active',
    })
    .expect(201);
  return res.body;
}

module.exports = { createTenant, createCreator };
