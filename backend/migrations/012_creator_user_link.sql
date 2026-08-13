-- Link a creator record to a login user, so a creator-role user's analytics
-- can be scoped to their own numbers (mirrors chatter scoping via membership).
ALTER TABLE creators ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_creators_user ON creators(user_id) WHERE user_id IS NOT NULL;
-- a given user maps to at most one creator per workspace
CREATE UNIQUE INDEX IF NOT EXISTS uq_creator_user_per_ws ON creators(workspace_id, user_id) WHERE user_id IS NOT NULL;
