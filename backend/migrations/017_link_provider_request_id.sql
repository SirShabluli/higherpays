-- Cache the provider's numeric payment_request id on the link so the status
-- reconciler can poll it without re-scanning webhook_events each time.
ALTER TABLE payment_links ADD COLUMN IF NOT EXISTS provider_request_id text;
