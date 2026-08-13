BEGIN;

-- In-app notification feed (one row per workspace event).
CREATE TABLE notifications (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  event        text NOT NULL,                       -- e.g. 'payment.paid'
  title        text NOT NULL,
  body         text,
  amount       numeric(14,2),
  currency     char(3),
  entity_type  text,
  entity_id    uuid,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_notifications_ws ON notifications(workspace_id, created_at DESC);

-- Per-user read state.
CREATE TABLE notification_reads (
  notification_id uuid NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (notification_id, user_id)
);

-- External delivery channels. `target` is a Telegram chat id (never a secret).
CREATE TABLE notification_channels (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  type         text NOT NULL CHECK (type IN ('telegram')),
  target       text NOT NULL,
  label        text,
  events       text[] NOT NULL DEFAULT ARRAY['payment.paid'],
  active       boolean NOT NULL DEFAULT true,
  last_error   text,
  last_sent_at timestamptz,
  created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, type, target)
);
CREATE INDEX idx_notif_channels_ws ON notification_channels(workspace_id);

ALTER TABLE notifications          ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications          FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON notifications
  USING (workspace_id = current_workspace_id()) WITH CHECK (workspace_id = current_workspace_id());

ALTER TABLE notification_channels  ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_channels  FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON notification_channels
  USING (workspace_id = current_workspace_id()) WITH CHECK (workspace_id = current_workspace_id());

COMMIT;
