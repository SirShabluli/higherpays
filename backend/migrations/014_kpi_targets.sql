-- KPI targets / goals that a workspace admin sets for chatters (or the whole
-- team). Progress is computed live from the commission ledger. Tenant-isolated.
CREATE TABLE kpi_targets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  membership_id uuid REFERENCES memberships(id) ON DELETE CASCADE,  -- NULL => workspace-wide goal
  metric        text NOT NULL CHECK (metric IN ('gross','sales','aov','buyers','conversion')),
  target_value  numeric NOT NULL CHECK (target_value >= 0),
  period        text NOT NULL DEFAULT 'month' CHECK (period IN ('week','month','quarter')),
  created_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_kpi_targets_ws ON kpi_targets(workspace_id);
-- one target per (member-or-workspace, metric, period)
CREATE UNIQUE INDEX uq_kpi_target ON kpi_targets
  (workspace_id, COALESCE(membership_id, '00000000-0000-0000-0000-000000000000'::uuid), metric, period);

ALTER TABLE kpi_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE kpi_targets FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON kpi_targets
  USING (workspace_id = current_workspace_id())
  WITH CHECK (workspace_id = current_workspace_id());
