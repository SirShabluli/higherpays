-- Workspace-level guardrails for payment link amounts (both optional).
-- Enforced server-side on link creation; the console also validates up front.
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS min_link_amount numeric(14,2);
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS max_link_amount numeric(14,2);
ALTER TABLE workspaces ADD CONSTRAINT ws_link_limits_sane
  CHECK (min_link_amount IS NULL OR max_link_amount IS NULL OR max_link_amount >= min_link_amount);
