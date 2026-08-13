-- ============================================================================
-- Migration 010: use the ACTUAL PSP fee for reconciliation
--
-- The QRMoney webhook reports the real `fee` per payment. When a transaction has
-- that actual fee, fn_post_sale now uses it for psp_fee (so the expected-
-- settlement figure reconciles against what really lands), falling back to the
-- configured PSP rate only when no actual fee is present (e.g. manual posting).
-- Agency-facing platform_fee and the intended margin are unchanged.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION fn_post_sale(tx uuid) RETURNS commission_entries AS $$
DECLARE
  t transactions; cr creators; org uuid;
  psp numeric := 0; margin numeric := 0; blended numeric := 0; chatpct numeric := 0;
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

  SELECT chatter_pct INTO chatpct FROM commission_rules
    WHERE workspace_id = t.workspace_id AND creator_id IS NULL AND effective_from <= t.occurred_at
    ORDER BY effective_from DESC LIMIT 1;
  chatpct := COALESCE(chatpct,0);

  -- actual fee from the provider when available, else the configured expectation
  IF t.fee IS NOT NULL AND t.fee > 0 THEN psp_fee_val := t.fee;
  ELSE psp_fee_val := (t.gross * psp) / 100; END IF;

  dist  := t.gross - (t.gross * blended) / 100;
  IF model = 'revshare' THEN c_amt := (dist * split) / 100; ELSE c_amt := 0; END IF;
  ch_amt := (dist * chatpct) / 100;
  ag_amt := dist - c_amt - ch_amt;

  INSERT INTO commission_entries(
    workspace_id,transaction_id,creator_id,chatter_membership_id,entry_type,revenue_model,
    gross,platform_fee,platform_margin,psp_fee,distributable,creator_amount,chatter_amount,agency_amount,chargeback_fee,status)
  VALUES(
    t.workspace_id,t.id,t.creator_id,t.attributed_membership_id,'sale',model,
    t.gross,(t.gross*blended)/100,(t.gross*margin)/100,psp_fee_val,dist,c_amt,ch_amt,ag_amt,0,'locked')
  RETURNING * INTO entry;
  RETURN entry;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

COMMIT;
