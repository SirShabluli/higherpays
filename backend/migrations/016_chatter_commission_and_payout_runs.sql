BEGIN;
-- Per-chatter commission override (NULL => fall back to the workspace rule).
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS commission_pct numeric
  CHECK (commission_pct IS NULL OR (commission_pct >= 0 AND commission_pct <= 100));

-- Track which payout run settled each PARTY of a ledger entry (one entry holds
-- creator, chatter and agency amounts, so each is settled independently).
ALTER TABLE commission_entries ADD COLUMN IF NOT EXISTS creator_payout_id uuid REFERENCES payouts(id) ON DELETE SET NULL;
ALTER TABLE commission_entries ADD COLUMN IF NOT EXISTS chatter_payout_id uuid REFERENCES payouts(id) ON DELETE SET NULL;
ALTER TABLE commission_entries ADD COLUMN IF NOT EXISTS creator_paid_at timestamptz;
ALTER TABLE commission_entries ADD COLUMN IF NOT EXISTS chatter_paid_at timestamptz;

-- Redefine fn_post_sale so a chatter's own commission_pct takes precedence.
CREATE OR REPLACE FUNCTION fn_post_sale(tx uuid) RETURNS commission_entries AS $$
DECLARE
  t transactions; cr creators; org uuid;
  psp numeric := 0; margin numeric := 0; blended numeric := 0; chatpct numeric := 0; m_chatpct numeric;
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

  -- workspace default chatter rate, then a per-chatter override if present
  SELECT chatter_pct INTO chatpct FROM commission_rules
    WHERE workspace_id = t.workspace_id AND creator_id IS NULL AND effective_from <= t.occurred_at
    ORDER BY effective_from DESC LIMIT 1;
  chatpct := COALESCE(chatpct,0);
  IF t.attributed_membership_id IS NOT NULL THEN
    SELECT commission_pct INTO m_chatpct FROM memberships WHERE id = t.attributed_membership_id;
    IF m_chatpct IS NOT NULL THEN chatpct := m_chatpct; END IF;
  END IF;

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
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMIT;
