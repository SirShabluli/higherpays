-- ============================================================================
-- Migration 004: payment link pricing modes
--
-- Two ways to price a link:
--   fixed — the chatter sets the amount; the link is for exactly that amount.
--   open  — no preset amount; the fan enters it on the provider's hosted page.
--
-- The real paid amount always arrives via webhook into `transactions`.
-- For fixed links, payment_links.amount is the expected amount; for open links
-- it is NULL.
-- ============================================================================

BEGIN;

CREATE TYPE pricing_mode AS ENUM ('fixed','open');

ALTER TABLE payment_links ADD COLUMN pricing_mode pricing_mode NOT NULL DEFAULT 'fixed';

-- amount becomes optional (NULL for open links)
ALTER TABLE payment_links ALTER COLUMN amount DROP NOT NULL;

-- replace the old "amount > 0" check with one that enforces mode consistency
ALTER TABLE payment_links DROP CONSTRAINT payment_links_amount_check;
ALTER TABLE payment_links ADD CONSTRAINT payment_links_pricing_ck CHECK (
  (pricing_mode = 'fixed' AND amount IS NOT NULL AND amount > 0)
  OR
  (pricing_mode = 'open'  AND amount IS NULL)
);

COMMIT;
