BEGIN;
-- Per-declined-transaction fee (a real cost with no matching sale).
ALTER TABLE settlement_fee_config ADD COLUMN IF NOT EXISTS decline_fee numeric NOT NULL DEFAULT 0
  CHECK (decline_fee >= 0);

CREATE OR REPLACE FUNCTION effective_decline_fee(org uuid, at timestamptz) RETURNS numeric AS $$
  SELECT COALESCE((SELECT decline_fee FROM settlement_fee_config
                   WHERE organization_id = org AND effective_from <= at
                   ORDER BY effective_from DESC LIMIT 1), 0);
$$ LANGUAGE sql STABLE;
COMMIT;
