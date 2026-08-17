BEGIN;
-- Rolling reserve is negotiated per merchant (percentage held + release schedule).
-- It is NOT a fee: it is the agency's own money, held and released later.
ALTER TABLE settlement_fee_config
  ADD COLUMN IF NOT EXISTS reserve_pct numeric NOT NULL DEFAULT 0 CHECK (reserve_pct >= 0 AND reserve_pct <= 100),
  ADD COLUMN IF NOT EXISTS reserve_release_days integer NOT NULL DEFAULT 0 CHECK (reserve_release_days >= 0);

CREATE OR REPLACE FUNCTION effective_reserve(org uuid, at timestamptz)
RETURNS TABLE(reserve_pct numeric, reserve_release_days integer) AS $$
  SELECT reserve_pct, reserve_release_days FROM settlement_fee_config
   WHERE organization_id = org AND effective_from <= at
   ORDER BY effective_from DESC LIMIT 1;
$$ LANGUAGE sql STABLE;
COMMIT;
