-- ============================================================================
-- Migration 009: webhook endpoints
--
-- Each workspace gets a hard-to-guess endpoint id (used in the webhook URL the
-- provider posts to) and a signing secret (used to verify the signature on each
-- call). Both are auto-generated; the secret is never exposed to the browser.
-- ============================================================================

BEGIN;

ALTER TABLE workspaces
  ADD COLUMN webhook_endpoint_id text UNIQUE
    DEFAULT replace(gen_random_uuid()::text, '-', ''),
  ADD COLUMN webhook_secret text
    DEFAULT (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''));

-- Backfill any rows that predate the columns.
UPDATE workspaces
SET webhook_endpoint_id = replace(gen_random_uuid()::text, '-', ''),
    webhook_secret      = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
WHERE webhook_endpoint_id IS NULL;

CREATE INDEX idx_ws_webhook_endpoint ON workspaces(webhook_endpoint_id);

COMMIT;
