-- ============================================================================
-- Migration 003 (OPTIONAL — only if you enabled RLS in 002)
-- Let a user read their OWN membership rows regardless of active workspace.
--
-- Why: at login we don't yet have a workspace context, but we must list every
-- workspace the user belongs to. This adds a self-access clause keyed to the
-- app.user_id GUC (set by the app alongside app.workspace_id).
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION current_user_id() RETURNS uuid AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid;
$$ LANGUAGE sql STABLE;

DROP POLICY IF EXISTS tenant_isolation ON memberships;
CREATE POLICY tenant_isolation ON memberships
  USING (
    workspace_id = current_workspace_id()
    OR user_id = current_user_id()
  )
  WITH CHECK (workspace_id = current_workspace_id());

COMMIT;
