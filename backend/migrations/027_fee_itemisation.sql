BEGIN;
-- Every fee, itemised, per transaction — so an agency's true cost can be traced
-- rather than inferred from a single blended number.
--
-- Existing columns keep their meaning:
--   platform_fee    total deducted from gross (PSP cost + HigherPays margin)
--   platform_margin HigherPays' own margin
--   psp_fee         total provider cost
-- New columns break psp_fee into its parts, and record the surcharge separately.
ALTER TABLE commission_entries
  ADD COLUMN IF NOT EXISTS fee_mdr        numeric(14,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fee_fixed      numeric(14,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fee_settlement numeric(14,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fee_surcharge  numeric(14,4) NOT NULL DEFAULT 0;

COMMENT ON COLUMN commission_entries.fee_mdr        IS 'Provider processing commission (MDR).';
COMMENT ON COLUMN commission_entries.fee_fixed      IS 'Provider per-approved-transaction fee.';
COMMENT ON COLUMN commission_entries.fee_settlement IS 'Provider settlement fee.';
COMMENT ON COLUMN commission_entries.fee_surcharge  IS 'Surcharge collected FROM the payer (revenue, not a cost).';

-- Surcharge charged on top of the deal, recorded on the transaction itself.
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS surcharge numeric(14,2) NOT NULL DEFAULT 0;
COMMENT ON COLUMN transactions.surcharge IS
  'Extra amount charged to the payer on top of gross (provider "EC"). Platform revenue.';

-- Itemised provider cost under the org''s effective fee model.
CREATE OR REPLACE FUNCTION psp_cost_breakdown(org uuid, gross numeric, at timestamptz)
RETURNS TABLE(mdr numeric, fixed numeric, settlement numeric, total numeric) AS $$
DECLARE
  r record; m numeric; s numeric; f numeric; bal numeric;
BEGIN
  SELECT fee_model, psp_rate_pct, mdr_pct, settlement_pct, psp_fixed_fee
    INTO r FROM platform_fee_rates
   WHERE organization_id = org AND effective_from <= at
   ORDER BY effective_from DESC LIMIT 1;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 0::numeric, 0::numeric, 0::numeric, 0::numeric; RETURN;
  END IF;

  f := COALESCE(r.psp_fixed_fee, 0);
  m := COALESCE(r.mdr_pct, r.psp_rate_pct, 0);
  s := COALESCE(r.settlement_pct, 0);
  IF r.mdr_pct IS NULL THEN s := 0; END IF;   -- rate not itemised: all of it is MDR

  IF r.fee_model = 'cascade' THEN
    mdr := gross * m / 100;
    bal := gross - mdr;
    fixed := f;
    bal := bal - fixed;
    settlement := bal * s / 100;
  ELSE
    mdr := gross * m / 100;
    fixed := f;
    settlement := gross * s / 100;
  END IF;
  total := mdr + fixed + settlement;
  RETURN QUERY SELECT mdr, fixed, settlement, total;
END;
$$ LANGUAGE plpgsql STABLE;

-- fn_post_sale records each component instead of only the totals.
CREATE OR REPLACE FUNCTION fn_post_sale(tx uuid) RETURNS commission_entries AS $$
DECLARE
  t transactions; cr creators; org uuid;
  margin numeric := 0; chatpct numeric := 0; m_chatpct numeric;
  b record; margin_val numeric; plat_fee numeric;
  model creator_revenue_model := 'ai';
  split numeric := 0; dist numeric; c_amt numeric; ch_amt numeric; ag_amt numeric;
  psp_fee_val numeric; entry commission_entries;
BEGIN
  SELECT * INTO t FROM transactions WHERE id = tx;
  IF NOT FOUND THEN RAISE EXCEPTION 'transaction % not found', tx; END IF;

  IF t.creator_id IS NOT NULL THEN
    SELECT * INTO cr FROM creators WHERE id = t.creator_id;
    IF FOUND THEN model := cr.revenue_model; split := cr.revenue_split_pct; END IF;
  END IF;

  SELECT organization_id INTO org FROM workspaces WHERE id = t.workspace_id;
  SELECT margin_rate_pct INTO margin FROM effective_platform_fee(org, t.occurred_at);
  margin := COALESCE(margin, 0);

  SELECT * INTO b FROM psp_cost_breakdown(org, t.gross, t.occurred_at);
  margin_val := (t.gross * margin) / 100;
  plat_fee   := b.total + margin_val;

  SELECT chatter_pct INTO chatpct FROM commission_rules
    WHERE workspace_id = t.workspace_id AND creator_id IS NULL AND effective_from <= t.occurred_at
    ORDER BY effective_from DESC LIMIT 1;
  chatpct := COALESCE(chatpct, 0);
  IF t.attributed_membership_id IS NOT NULL THEN
    SELECT commission_pct INTO m_chatpct FROM memberships WHERE id = t.attributed_membership_id;
    IF m_chatpct IS NOT NULL THEN chatpct := m_chatpct; END IF;
  END IF;

  IF t.fee IS NOT NULL AND t.fee > 0 THEN psp_fee_val := t.fee; ELSE psp_fee_val := b.total; END IF;

  dist := t.gross - plat_fee;
  IF model = 'revshare' THEN c_amt := (dist * split) / 100; ELSE c_amt := 0; END IF;
  ch_amt := (dist * chatpct) / 100;
  ag_amt := dist - c_amt - ch_amt;

  INSERT INTO commission_entries(
    workspace_id,transaction_id,creator_id,chatter_membership_id,entry_type,revenue_model,
    gross,platform_fee,platform_margin,psp_fee,distributable,
    creator_amount,chatter_amount,agency_amount,chargeback_fee,status,
    fee_mdr,fee_fixed,fee_settlement,fee_surcharge)
  VALUES(
    t.workspace_id,t.id,t.creator_id,t.attributed_membership_id,'sale',model,
    t.gross,plat_fee,margin_val,psp_fee_val,dist,
    c_amt,ch_amt,ag_amt,0,'locked',
    b.mdr,b.fixed,b.settlement,COALESCE(t.surcharge,0))
  RETURNING * INTO entry;
  RETURN entry;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
COMMIT;
