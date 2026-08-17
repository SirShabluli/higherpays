'use strict';

// Server-side permission matrix. This is the source of truth — the frontend
// role gating is only cosmetic; every protected route checks against this.
//
// Roles match the membership_role enum in the database:
//   owner, admin, manager, analyst, chatter, creator
// (In the earlier HTML console the chatter role was labelled "operator".)

const PERMISSIONS = [
  'payments.view', 'payments.export',
  'links.view', 'links.create',
  'analytics.view',
  'workspaces.view', 'workspaces.create',
  'creators.view', 'creators.manage',
  'compliance.view', 'compliance.manage',
  'customers.view', 'customers.manage', 'customers.export',
  'sales.view',
  'commissions.view', 'commissions.manage',
  'team.view', 'team.manage',
  'settings.view', 'settings.edit', 'settings.danger',
];

const ROLE_PERMISSIONS = {
  owner: new Set(PERMISSIONS), // everything

  admin: new Set(PERMISSIONS.filter(p => p !== 'settings.danger')),

  manager: new Set([
    'payments.view',
    'links.view', 'links.create',
    'analytics.view',
    'workspaces.view',
    'creators.view', 'creators.manage',
    'compliance.view',
    'customers.view',
    'sales.view',
    'commissions.view',
    'team.view',
    'settings.view',
  ]),

  analyst: new Set([
    'payments.view', 'payments.export',
    'links.view',
    'analytics.view',
    'workspaces.view',
    'creators.view',
    'compliance.view',
    'customers.view',
    'sales.view',
    'commissions.view',
    'team.view',
    'settings.view',
  ]),

  // Chatter: operational. Creates links, sees only what they need.
  // Row-level scoping (only assigned creators / own customers) is enforced in
  // the entity queries, not here — this just gates the capability.
  chatter: new Set([
    'analytics.view',
    'payments.view',
    'links.view', 'links.create',
    'creators.view',
    'customers.view',
    'sales.view',
  ]),

  // Creator: their own dashboard only. Data is scoped to self in queries.
  creator: new Set([
    'analytics.view',
    'payments.view',
  ]),
};

function can(role, permission) {
  const set = ROLE_PERMISSIONS[role];
  return !!set && set.has(permission);
}

// Seed the system roles into a workspace's roles table (called on workspace
// creation). After this, roles live in the DB and can be edited or extended.
async function seedRolesForWorkspace(client, workspaceId) {
  for (const [name, perms] of Object.entries(ROLE_PERMISSIONS)) {
    await client.query(
      `INSERT INTO roles (workspace_id, name, permissions, is_system)
       VALUES ($1,$2,$3,true)
       ON CONFLICT (workspace_id, name) DO NOTHING`,
      [workspaceId, name, JSON.stringify([...perms])]
    );
  }
}

module.exports = { PERMISSIONS, ROLE_PERMISSIONS, can, seedRolesForWorkspace };
