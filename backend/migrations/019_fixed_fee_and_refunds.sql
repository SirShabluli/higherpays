BEGIN;

-- 1) Fixed per-approved-transaction PSP fee (e.g. €0.50). Part of the rate card,
--    effective-dated like the percentages. Defaults to 0 => existing behaviour.
ALTER TABLE platform_fee_rates ADD COLUMN IF NOT EXISTS psp_fixed_fee numeric(14,2) NOT NULL DEFAULT 0
  CHECK (psp_fixed_fee >= 0);

CREATE OR REPLACE FUNCTION effective_psp_fixed_fee(org uuid, at timestamptz) RETURNS numeric AS $$
  SELECT COALESCE((SELECT psp_fixed_fee FROM platform_fee_rates
                   WHERE organization_id = org AND effective_from <= at
                   ORDER BY effective_from DESC LIMIT 1), 0);
$$ LANGUAGE sql STABLE;

-- 2) Refund fee (flat, per refund). Distinct from the chargeback fee.
ALTER TABLE settlement_fee_config ADD COLUMN IF NOT EXISTS refund_fee numeric NOT NULL DEFAULT 0
  CHECK (refund_fee >= 0);

CREATE OR REPLACE FUNCTION effective_refund_fee(org uuid, at timestamptz) RETURNS numeric AS $$
  SELECT COALESCE((SELECT refund_fee FROM settlement_fee_config
                   WHERE organization_id = org AND effective_from <= at
                   ORDER BY effective_from DESC LIMIT 1), 0);
$$ LANGUAGE sql STABLE;

-- 3) Ledger now recognises refunds.
ALTER TABLE commission_entries DROP CONSTRAINT IF EXISTS commission_entries_entry_type_check;
ALTER TABLE commission_entries ADD  CONSTRAINT commission_entries_entry_type_check
  CHECK (entry_type IN ('sale','chargeback','refund'));

-- 4) fn_post_sale: platform fee now includes the fixed PSP fee.
--    (margin is unchanged — the fixed fee is a PSP cost, not HigherPays margin.)
CREATE OR REPLACE FUNCTION fn_post_sale(tx uuid) RETURNS commission_entries AS $$
DECLARE
  t transactions; cr creators; org uuid;
  psp numeric := 0; margin numeric := 0; blended numeric := 0; chatpct numeric := 0; m_chatpct numeric;
  fixed_fee numeric := 0; plat_fee numeric;
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
  SELECT psp_rate_pct, margin_rate_pct, blended_rate_pct
    INTO psp, margin, blended FROM effective_platform_fee(org, t.occurred_at);
  psp := COALESCE(psp,0); margin := COALESCE(margin,0); blended := COALESCE(blended,0);
  fixed_fee := effective_psp_fixed_fee(org, t.occurred_at);

  SELECT chatter_pct INTO chatpct FROM commission_rules
    WHERE workspace_id = t.workspace_id AND creator_id IS NULL AND effective_from <= t.occurred_at
    ORDER BY effective_from DESC LIMIT 1;
  chatpct := COALESCE(chatpct,0);
  IF t.attributed_membership_id IS NOT NULL THEN
    SELECT commission_pct INTO m_chatpct FROM memberships WHERE id = t.attributed_membership_id;
    IF m_chatpct IS NOT NULL THEN chatpct := m_chatpct; END IF;
  END IF;

  IF t.fee IS NOT NULL AND t.fee > 0 THEN psp_fee_val := t.fee;
  ELSE psp_fee_val := (t.gross * psp) / 100 + fixed_fee; END IF;

  plat_fee := (t.gross * blended) / 100 + fixed_fee;
  dist := t.gross - plat_fee;
  IF model = 'revshare' THEN c_amt := (dist * split) / 100; ELSE c_amt := 0; END IF;
  ch_amt := (dist * chatpct) / 100;
  ag_amt := dist - c_amt - ch_amt;

  INSERT INTO commission_entries(
    workspace_id,transaction_id,creator_id,chatter_membership_id,entry_type,revenue_model,
    gross,platform_fee,platform_margin,psp_fee,distributable,creator_amount,chatter_amount,agency_amount,chargeback_fee,status)
  VALUES(
    t.workspace_id,t.id,t.creator_id,t.attributed_membership_id,'sale',model,
    t.gross,plat_fee,(t.gross*margin)/100,psp_fee_val,dist,c_amt,ch_amt,ag_amt,0,'locked')
  RETURNING * INTO entry;
  RETURN entry;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5) fn_post_refund — mirrors the chargeback waterfall, with the refund fee.
--    Chatter always loses the commission. Rev-share creator bears her share + fee;
--    salary/AI => the agency absorbs it.
CREATE OR REPLACE FUNCTION fn_post_refund(tx uuid) RETURNS commission_entries AS $$
DECLARE
  s commission_entries; org uuid; rfee numeric := 0;
  c_amt numeric; ch_amt numeric; ag_amt numeric; entry commission_entries;
BEGIN
  SELECT * INTO s FROM commission_entries WHERE transaction_id = tx AND entry_type = 'sale';
  IF NOT FOUND THEN RAISE EXCEPTION 'no sale entry for transaction %', tx; END IF;
  IF EXISTS (SELECT 1 FROM commission_entries WHERE transaction_id = tx AND entry_type IN ('refund','chargeback')) THEN
    RAISE EXCEPTION 'transaction % already reversed', tx;
  END IF;

  SELECT organization_id INTO org FROM workspaces WHERE id = s.workspace_id;
  rfee := effective_refund_fee(org, now());

  ch_amt := - s.chatter_amount;
  IF s.revenue_model = 'revshare' THEN
    c_amt  := - s.creator_amount - rfee;
    ag_amt := - s.agency_amount;
  ELSE
    c_amt  := 0;
    ag_amt := - s.agency_amount - rfee;
  END IF;

  INSERT INTO commission_entries(
    workspace_id,transaction_id,creator_id,chatter_membership_id,entry_type,revenue_model,
    gross,platform_fee,platform_margin,psp_fee,distributable,creator_amount,chatter_amount,agency_amount,chargeback_fee,status)
  VALUES(
    s.workspace_id,s.transaction_id,s.creator_id,s.chatter_membership_id,'refund',s.revenue_model,
    - s.gross, - s.platform_fee, - s.platform_margin, - s.psp_fee, - s.distributable, c_amt, ch_amt, ag_amt, rfee, 'locked')
  RETURNING * INTO entry;

  UPDATE commission_entries SET status = 'reversed' WHERE id = s.id;
  RETURN entry;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 6) A chargeback must not be posted on top of a refund either.
CREATE OR REPLACE FUNCTION fn_post_chargeback(tx uuid) RETURNS commission_entries AS $$
DECLARE
  s commission_entries; org uuid; cbfee numeric := 0;
  c_amt numeric; ch_amt numeric; ag_amt numeric; entry commission_entries;
BEGIN
  SELECT * INTO s FROM commission_entries WHERE transaction_id = tx AND entry_type = 'sale';
  IF NOT FOUND THEN RAISE EXCEPTION 'no sale entry for transaction %', tx; END IF;
  IF EXISTS (SELECT 1 FROM commission_entries WHERE transaction_id = tx AND entry_type IN ('chargeback','refund')) THEN
    RAISE EXCEPTION 'transaction % already reversed', tx;
  END IF;

  SELECT organization_id INTO org FROM workspaces WHERE id = s.workspace_id;
  SELECT chargeback_fee INTO cbfee FROM effective_settlement_fees(org, now());
  cbfee := COALESCE(cbfee,0);

  ch_amt := - s.chatter_amount;
  IF s.revenue_model = 'revshare' THEN
    c_amt  := - s.creator_amount - cbfee;
    ag_amt := - s.agency_amount;
  ELSE
    c_amt  := 0;
    ag_amt := - s.agency_amount - cbfee;
  END IF;

  INSERT INTO commission_entries(
    workspace_id,transaction_id,creator_id,chatter_membership_id,entry_type,revenue_model,
    gross,platform_fee,platform_margin,psp_fee,distributable,creator_amount,chatter_amount,agency_amount,chargeback_fee,status)
  VALUES(
    s.workspace_id,s.transaction_id,s.creator_id,s.chatter_membership_id,'chargeback',s.revenue_model,
    - s.gross, - s.platform_fee, - s.platform_margin, - s.psp_fee, - s.distributable, c_amt, ch_amt, ag_amt, cbfee, 'locked')
  RETURNING * INTO entry;

  UPDATE commission_entries SET status = 'reversed' WHERE id = s.id;
  RETURN entry;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

COMMIT;
