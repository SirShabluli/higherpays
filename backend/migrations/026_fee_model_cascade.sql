BEGIN;
-- Providers apply their fees differently, and the difference is real money:
--
--   FLAT    every percentage applies to the original gross
--           $100 -> 7% (7.00) + fixed (0.50) + 1% (1.00) = 8.50, net 91.50
--   CASCADE each fee applies to the running balance, in order
--           $100 -> -7% = 93.00 -> -0.50 = 92.50 -> -1% = 91.575
--
-- QRMoney documented percentages as "calculated directly from the volume" (flat).
-- Mantapay confirmed the sequential order (cascade). Both must be supported while
-- agencies migrate, so the model is part of the effective-dated rate card.
--
-- MDR and settlement were previously conflated into one psp_rate_pct (e.g. 8%).
-- Cascade needs them separated because they apply at different steps.
ALTER TABLE platform_fee_rates
  ADD COLUMN IF NOT EXISTS fee_model      text NOT NULL DEFAULT 'flat'
    CHECK (fee_model IN ('flat','cascade')),
  ADD COLUMN IF NOT EXISTS mdr_pct        numeric(5,2) CHECK (mdr_pct IS NULL OR (mdr_pct >= 0 AND mdr_pct <= 100)),
  ADD COLUMN IF NOT EXISTS settlement_pct numeric(5,2) CHECK (settlement_pct IS NULL OR (settlement_pct >= 0 AND settlement_pct <= 100));

COMMENT ON COLUMN platform_fee_rates.mdr_pct IS
  'Processing commission. NULL => fall back to psp_rate_pct as a single combined rate.';
COMMENT ON COLUMN platform_fee_rates.settlement_pct IS
  'Settlement fee, applied after the fixed fee under the cascade model.';

-- Compute the PSP cost for a gross amount under the org''s effective model.
-- Exact NUMERIC throughout — never floating point.
CREATE OR REPLACE FUNCTION psp_cost(org uuid, gross numeric, at timestamptz)
RETURNS numeric AS $$
DECLARE
  r record; mdr numeric; sett numeric; fixed numeric; bal numeric; cost numeric;
BEGIN
  SELECT fee_model, psp_rate_pct, mdr_pct, settlement_pct, psp_fixed_fee
    INTO r
    FROM platform_fee_rates
   WHERE organization_id = org AND effective_from <= at
   ORDER BY effective_from DESC LIMIT 1;
  IF NOT FOUND THEN RETURN 0; END IF;

  fixed := COALESCE(r.psp_fixed_fee, 0);
  -- When mdr/settlement are not itemised, treat psp_rate_pct as the whole percentage.
  mdr   := COALESCE(r.mdr_pct, r.psp_rate_pct, 0);
  sett  := COALESCE(r.settlement_pct, 0);
  IF r.mdr_pct IS NULL THEN sett := 0; END IF;

  IF r.fee_model = 'cascade' THEN
    bal  := gross - (gross * mdr / 100);   -- 1) processing commission
    bal  := bal - fixed;                   -- 2) per-approved-transaction fee
    bal  := bal - (bal * sett / 100);      -- 3) settlement fee on the remainder
    cost := gross - bal;
  ELSE
    cost := (gross * mdr / 100) + fixed + (gross * sett / 100);
  END IF;
  RETURN cost;
END;
$$ LANGUAGE plpgsql STABLE;

COMMIT;

BEGIN;
-- fn_post_sale now sources the PSP cost from psp_cost() so the flat/cascade
-- choice is honoured. HigherPays margin is unchanged: a straight percentage of
-- gross (the deal value), never cascaded — it is our fee, not a processing cost.
CREATE OR REPLACE FUNCTION fn_post_sale(tx uuid) RETURNS commission_entries AS $$
DECLARE
  t transactions; cr creators; org uuid;
  psp numeric := 0; margin numeric := 0; chatpct numeric := 0; m_chatpct numeric;
  psp_cost_val numeric; margin_val numeric; plat_fee numeric;
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
  SELECT psp_rate_pct, margin_rate_pct INTO psp, margin
    FROM effective_platform_fee(org, t.occurred_at);
  psp := COALESCE(psp,0); margin := COALESCE(margin,0);

  -- provider cost under the org's fee model (flat or cascade)
  psp_cost_val := psp_cost(org, t.gross, t.occurred_at);
  -- our margin: a plain percentage of the deal value
  margin_val   := (t.gross * margin) / 100;
  plat_fee     := psp_cost_val + margin_val;

  SELECT chatter_pct INTO chatpct FROM commission_rules
    WHERE workspace_id = t.workspace_id AND creator_id IS NULL AND effective_from <= t.occurred_at
    ORDER BY effective_from DESC LIMIT 1;
  chatpct := COALESCE(chatpct,0);
  IF t.attributed_membership_id IS NOT NULL THEN
    SELECT commission_pct INTO m_chatpct FROM memberships WHERE id = t.attributed_membership_id;
    IF m_chatpct IS NOT NULL THEN chatpct := m_chatpct; END IF;
  END IF;

  -- prefer the ACTUAL fee the provider reported, when we have it
  IF t.fee IS NOT NULL AND t.fee > 0 THEN psp_fee_val := t.fee;
  ELSE psp_fee_val := psp_cost_val; END IF;

  dist := t.gross - plat_fee;
  IF model = 'revshare' THEN c_amt := (dist * split) / 100; ELSE c_amt := 0; END IF;
  ch_amt := (dist * chatpct) / 100;
  ag_amt := dist - c_amt - ch_amt;

  INSERT INTO commission_entries(
    workspace_id,transaction_id,creator_id,chatter_membership_id,entry_type,revenue_model,
    gross,platform_fee,platform_margin,psp_fee,distributable,creator_amount,chatter_amount,agency_amount,chargeback_fee,status)
  VALUES(
    t.workspace_id,t.id,t.creator_id,t.attributed_membership_id,'sale',model,
    t.gross,plat_fee,margin_val,psp_fee_val,dist,c_amt,ch_amt,ag_amt,0,'locked')
  RETURNING * INTO entry;
  RETURN entry;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
COMMIT;
