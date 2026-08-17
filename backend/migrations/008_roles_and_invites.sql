-- ============================================================================
-- Migration 008: roles-as-data + sign-up invites
--
-- Roles become editable data instead of a fixed list. Each workspace gets its
-- own set of roles (system defaults seeded on creation, plus any custom roles
-- the owner adds). memberships.role now stores the role NAME (text) that must
-- exist in the workspace's roles table. Permission checks read from here.
-- ============================================================================

BEGIN;

-- memberships.role: enum -> text so custom role names are allowed.
ALTER TABLE memberships ALTER COLUMN role TYPE text USING role::text;

CREATE TABLE roles (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name         text NOT NULL,
  permissions  jsonb NOT NULL DEFAULT '[]',   -- array of permission strings
  is_system    boolean NOT NULL DEFAULT false, -- system roles can't be deleted
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, name)
);
CREATE INDEX idx_roles_ws ON roles(workspace_id);

ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON roles
  USING (is_platform_context()
         OR workspace_id = current_workspace_id()
         OR EXISTS (SELECT 1 FROM memberships m WHERE m.workspace_id = roles.workspace_id AND m.user_id = current_user_id()))
  WITH CHECK (is_platform_context() OR workspace_id = current_workspace_id());

-- Invites: for new members AND creator sign-ups (rev-share creators get a login).
-- Not under RLS: the accept flow is public and keyed by a secret token; listing
-- is always filtered by workspace_id in the query.
CREATE TABLE invites (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email        text NOT NULL,
  role         text NOT NULL,
  creator_id   uuid REFERENCES creators(id) ON DELETE SET NULL, -- set for creator sign-ups
  token_hash   text NOT NULL UNIQUE,
  invited_by   uuid REFERENCES users(id),
  expires_at   timestamptz NOT NULL,
  accepted_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_invites_ws ON invites(workspace_id);

COMMIT;
