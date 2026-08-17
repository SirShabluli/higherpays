BEGIN;
-- Migration 006 gave every tenant table a controlled platform-admin bypass, but
-- tables added afterwards (targets, notifications, settlements) were created with
-- workspace-only policies. Trusted server contexts — notably the provider webhook,
-- which must write a notification before any user session exists — were therefore
-- rejected by RLS in production. Bring them to parity.
DO $$
DECLARE
  t text;
  later_tables text[] := ARRAY[
    'kpi_targets','notifications','notification_channels','notification_preferences','settlements'
  ];
BEGIN
  FOREACH t IN ARRAY later_tables LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
      EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
      EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I;', t);
      EXECUTE format($f$CREATE POLICY tenant_isolation ON %I
        USING      (is_platform_context() OR workspace_id = current_workspace_id())
        WITH CHECK (is_platform_context() OR workspace_id = current_workspace_id());$f$, t);
    END IF;
  END LOOP;
END $$;
COMMIT;
