-- ============================================================================
-- Migration 005: platform fees (white-label)
--
-- The fee an agency pays is a BLENDED rate = PSP cut + HigherPays margin.
--   Own agency:       psp 8% + margin 0%  = 8%  blended
--   External agency:  psp 8% + margin 5%  = 13% blended  (what they see)
--
-- Stored per organization and versioned. The blended rate is applied to gross
-- BEFORE the creator / agency / chatter splits. Those splits are NOT set here —
-- they live in commission_rules and are configured by the workspace owner.
--
-- Waterfall:
--   gross
--    − platform_fee (gross * blended)  -> distributable        [agency-facing]
--        distributable * creator_split -> creator payout
--        distributable * chatter_pct   -> chatter commission
--        remainder                     -> agency net
--   gross * margin                     -> HigherPays margin     [internal]
--   (PSP cost = gross * psp, also confirmed by transactions.fee from webhook)
-- ============================================================================

BEGIN;

CREATE TABLE platform_fee_rates (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  psp_rate_pct     numeric(5,2) NOT NULL CHECK (psp_rate_pct    >= 0 AND psp_rate_pct    <= 100),
  margin_rate_pct  numeric(5,2) NOT NULL DEFAULT 0 CHECK (margin_rate_pct >= 0 AND margin_rate_pct <= 100),
  blended_rate_pct numeric(6,2) GENERATED ALWAYS AS (psp_rate_pct + margin_rate_pct) STORED,
  effective_from   timestamptz NOT NULL DEFAULT now(),
  created_by       uuid REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_platform_fee_org ON platform_fee_rates(organization_id, effective_from);

-- Snapshot on each transaction so historical payouts never shift when a rate
-- is later changed.
ALTER TABLE transactions
  ADD COLUMN platform_fee_rate numeric(6,2),   -- blended rate applied (e.g. 13.00)
  ADD COLUMN platform_fee      numeric(14,2),  -- gross * blended (agency-facing)
  ADD COLUMN platform_margin   numeric(14,2);  -- gross * margin  (HigherPays cut)

-- The fee components in effect for an organization at a given time.
CREATE OR REPLACE FUNCTION effective_platform_fee(org uuid, at timestamptz)
RETURNS TABLE(psp_rate_pct numeric, margin_rate_pct numeric, blended_rate_pct numeric) AS $$
  SELECT psp_rate_pct, margin_rate_pct, blended_rate_pct
  FROM platform_fee_rates
  WHERE organization_id = org AND effective_from <= at
  ORDER BY effective_from DESC
  LIMIT 1;
$$ LANGUAGE sql STABLE;

COMMIT;
