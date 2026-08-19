'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { app } = require('../helpers/setup');
const { createTenant } = require('../helpers/tenant');

test('POST /auth/register creates a tenant + returns tokens', async () => {
  const t = await createTenant(app);
  assert.match(t.accessToken, /^ey/);
  assert.ok(t.refreshToken.length > 20);
  assert.ok(t.workspaceId);
});

test('POST /auth/login accepts correct credentials', async () => {
  const t = await createTenant(app);
  const res = await request(app)
    .post('/auth/login')
    .send({ email: t.email, password: t.password })
    .expect(200);
  assert.match(res.body.accessToken, /^ey/);
  assert.equal(res.body.workspaces[0].id, t.workspaceId);
});

test('POST /auth/login rejects wrong password with 401', async () => {
  const t = await createTenant(app);
  await request(app)
    .post('/auth/login')
    .send({ email: t.email, password: 'wrong-password' })
    .expect(401);
});

test('POST /auth/refresh rotates the refresh token and returns a new access token', async () => {
  const t = await createTenant(app);
  const res = await request(app)
    .post('/auth/refresh')
    .send({ refreshToken: t.refreshToken })
    .expect(200);
  assert.match(res.body.accessToken, /^ey/);
  assert.notEqual(res.body.refreshToken, t.refreshToken);

  // Old refresh token is now revoked.
  await request(app)
    .post('/auth/refresh')
    .send({ refreshToken: t.refreshToken })
    .expect(401);
});

test('GET /auth/me requires a bearer token', async () => {
  await request(app).get('/auth/me').expect(401);

  const t = await createTenant(app);
  const res = await request(app)
    .get('/auth/me')
    .set('Authorization', `Bearer ${t.accessToken}`)
    .expect(200);
  assert.equal(res.body.user.id, t.userId);
});
