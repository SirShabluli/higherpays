-- ============================================================================
-- Migration 006: platform administration (Super-Admin)
--
-- A platform admin operates ABOVE any single workspace/organization — it is the
-- HigherPays operator who sees every agency and the real back office. This is a
-- separate grant from workspace memberships, not a workspace role.
--
-- Because a platform admin intentionally crosses the tenant boundary, we add an
-- EXPLICIT, auditable bypass to the RLS policies, gated on a session flag that
-- the app sets ONLY after verifying the user is a platform admin:
--     SET LOCAL app.platform_admin = 'on';
-- Without that flag, tenant isolation applies exactly as before.
-- ============================================================================

BEGIN;

CREATE TYPE platform_role AS ENUM ('super_admin', 'support', 'finance');

CREATE TABLE platform_admins (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  role       platform_role NOT NULL DEFAULT 'super_admin',
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- True when the current transaction has been marked as a platform-admin context.
CREATE OR REPLACE FUNCTION is_platform_context() RETURNS boolean AS $$
  SELECT current_setting('app.platform_admin', true) = 'on';
$$ LANGUAGE sql STABLE;

-- Recreate tenant policies so a verified platform-admin context can read/write
-- across tenants, while normal requests stay confined to their workspace.
DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY[
    'workspaces','memberships','creators','creator_compliance','creator_assignments',
    'customers','content_items','payment_links','transactions','commission_rules',
    'payouts','audit_log','platform_fee_rates'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I;', t);

    IF t = 'workspaces' THEN
      EXECUTE format($f$CREATE POLICY tenant_isolation ON %I
        USING (is_platform_context()
               OR id = current_workspace_id()
               OR EXISTS (SELECT 1 FROM memberships m
                          WHERE m.workspace_id = workspaces.id AND m.user_id = current_user_id()))
        WITH CHECK (is_platform_context() OR id = current_workspace_id());$f$, t);

    ELSIF t = 'memberships' THEN
      EXECUTE format($f$CREATE POLICY tenant_isolation ON %I
        USING (is_platform_context() OR workspace_id = current_workspace_id() OR user_id = current_user_id())
        WITH CHECK (is_platform_context() OR workspace_id = current_workspace_id());$f$, t);

    ELSIF t = 'platform_fee_rates' THEN
      -- keyed by organization, not workspace. A workspace member may READ their
      -- own organization's rate (for display); only a platform admin may WRITE.
      EXECUTE format($f$CREATE POLICY tenant_isolation ON %I
        USING (is_platform_context()
               OR organization_id = (SELECT organization_id FROM workspaces WHERE id = current_workspace_id()))
        WITH CHECK (is_platform_context());$f$, t);

    ELSIF t = 'audit_log' THEN
      -- Append-only system log: reads are tenant-scoped, but writes are always
      -- allowed (the app sets workspace_id explicitly and is the only writer).
      EXECUTE format($f$CREATE POLICY tenant_isolation ON %I
        USING (is_platform_context() OR workspace_id = current_workspace_id())
        WITH CHECK (true);$f$, t);

    ELSE
      EXECUTE format($f$CREATE POLICY tenant_isolation ON %I
        USING (is_platform_context() OR workspace_id = current_workspace_id())
        WITH CHECK (is_platform_context() OR workspace_id = current_workspace_id());$f$, t);
    END IF;
  END LOOP;
END $$;

COMMIT;
