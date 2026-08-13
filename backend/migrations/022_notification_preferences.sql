BEGIN;
-- Which in-app events each user wants to see, per workspace.
-- Absent row => the user receives every event their role permits.
CREATE TABLE notification_preferences (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  events       text[] NOT NULL DEFAULT ARRAY['payment.paid','payment.failed','payment.refunded','payment.chargeback','payout.paid'],
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);

ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_preferences FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON notification_preferences
  USING (workspace_id = current_workspace_id()) WITH CHECK (workspace_id = current_workspace_id());
COMMIT;
