-- ============================================================================
-- Migration 002 (OPTIONAL): Row-Level Security for defence-in-depth tenancy
--
-- The application already filters every query by workspace_id. RLS adds a second
-- wall at the database: even a buggy query cannot read another tenant's rows.
--
-- HOW IT WORKS
--   The app sets a per-connection/transaction GUC before running queries:
--       SET LOCAL app.workspace_id = '<uuid>';
--   Policies below restrict every tenant table to rows matching that value.
--
-- IMPORTANT
--   * The DB role your app connects as MUST NOT be a superuser and MUST NOT have
--     the BYPASSRLS attribute, or these policies are ignored.
--   * If app.workspace_id is not set, tenant tables return zero rows (fail-closed).
--   * Run migrations / admin jobs as a separate role that is allowed to bypass,
--     or wrap them so the GUC is set appropriately.
--   * Test thoroughly in staging before enabling in production.
--
-- To roll back: ALTER TABLE <t> DISABLE ROW LEVEL SECURITY;  (and DROP POLICY)
-- ============================================================================

BEGIN;

-- Helper: read the current workspace from the session GUC (NULL if unset).
CREATE OR REPLACE FUNCTION current_workspace_id() RETURNS uuid AS $$
  SELECT NULLIF(current_setting('app.workspace_id', true), '')::uuid;
$$ LANGUAGE sql STABLE;

-- Apply a uniform policy to every workspace-scoped table.
DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY[
    'workspaces','memberships','creators','creator_compliance','creator_assignments',
    'customers','content_items','payment_links','transactions','commission_rules',
    'payouts','audit_log'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);

    IF t = 'workspaces' THEN
      -- workspaces: the row's own id must match the active workspace
      EXECUTE format($f$
        CREATE POLICY tenant_isolation ON %I
        USING (id = current_workspace_id())
        WITH CHECK (id = current_workspace_id());
      $f$, t);
    ELSE
      EXECUTE format($f$
        CREATE POLICY tenant_isolation ON %I
        USING (workspace_id = current_workspace_id())
        WITH CHECK (workspace_id = current_workspace_id());
      $f$, t);
    END IF;
  END LOOP;
END $$;

COMMIT;

-- Example usage from the application (pseudocode):
--   BEGIN;
--   SET LOCAL app.workspace_id = '31a2f7be-...';
--   SELECT * FROM customers;      -- only this workspace's customers are visible
--   COMMIT;
