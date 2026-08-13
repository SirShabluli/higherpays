-- ============================================================================
-- Migration 007: payout / commission engine
--
-- Computes, per transaction, exactly who is owed what — with ALL money math in
-- Postgres NUMERIC (exact decimal, never floating point). Nothing is rounded or
-- altered; values are stored at full precision.
--
-- Waterfall per sale:
--   gross
--    − platform_fee (gross * blended%)      -> distributable
--        revshare: creator = distributable * creator_split%
--        salary/ai: creator = 0 (paid a fixed salary instead)
--        chatter   = distributable * chatter%
--        agency    = distributable − creator − chatter
--
-- Chargeback (payment reversed after it was counted):
--   • chatter ALWAYS loses the commission for that sale
--   • revshare  -> the creator is charged back her share + the chargeback fee
--   • salary/ai -> the agency absorbs it (creator not charged per-sale)
--
-- Settlement/PSP/chargeback fees are super-admin editable (mock values for now).
-- ============================================================================

BEGIN;

-- ---- creator revenue models (backend for the console's revenue-model field) --
CREATE TYPE creator_revenue_model AS ENUM ('revshare','salary','ai');
ALTER TABLE creators
  ADD COLUMN revenue_model      creator_revenue_model NOT NULL DEFAULT 'revshare',
  ADD COLUMN salary             numeric,              -- monthly salary (salary model)
  ADD COLUMN salary_increase_pct numeric DEFAULT 0;   -- optional monthly auto-increase

-- ---- super-admin editable settlement / chargeback fees (versioned per org) ---
CREATE TABLE settlement_fee_config (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  chargeback_fee      numeric NOT NULL DEFAULT 0 CHECK (chargeback_fee >= 0),      -- flat, per chargeback
  settlement_fee_pct  numeric NOT NULL DEFAULT 0 CHECK (settlement_fee_pct >= 0),  -- % of settled volume
  settlement_fee_flat numeric NOT NULL DEFAULT 0 CHECK (settlement_fee_flat >= 0), -- flat per settlement
  effective_from      timestamptz NOT NULL DEFAULT now(),
  created_by          uuid REFERENCES users(id),
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_settlement_fee_org ON settlement_fee_config(organization_id, effective_from);

CREATE OR REPLACE FUNCTION effective_settlement_fees(org uuid, at timestamptz)
RETURNS TABLE(chargeback_fee numeric, settlement_fee_pct numeric, settlement_fee_flat numeric) AS $$
  SELECT chargeback_fee, settlement_fee_pct, settlement_fee_flat
  FROM settlement_fee_config
  WHERE organization_id = org AND effective_from <= at
  ORDER BY effective_from DESC LIMIT 1;
$$ LANGUAGE sql STABLE;

-- ---- the ledger: one row per posted event (sale or chargeback) ---------------
CREATE TABLE commission_entries (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  transaction_id       uuid NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  creator_id           uuid REFERENCES creators(id) ON DELETE SET NULL,
  chatter_membership_id uuid REFERENCES memberships(id) ON DELETE SET NULL,
  entry_type           text NOT NULL CHECK (entry_type IN ('sale','chargeback')),
  revenue_model        creator_revenue_model,
  -- exact NUMERIC (no scale cap => no rounding)
  gross                numeric NOT NULL,
  platform_fee         numeric NOT NULL,   -- blended (agency-facing)
  platform_margin      numeric NOT NULL,   -- HigherPays margin
  psp_fee              numeric NOT NULL,   -- expected PSP cost (for reconciliation)
  distributable        numeric NOT NULL,
  creator_amount       numeric NOT NULL,
  chatter_amount       numeric NOT NULL,
  agency_amount        numeric NOT NULL,
  chargeback_fee       numeric NOT NULL DEFAULT 0,
  status               text NOT NULL DEFAULT 'locked',  -- 'locked' | 'reversed'
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ce_ws       ON commission_entries(workspace_id);
CREATE INDEX idx_ce_txn      ON commission_entries(transaction_id);
CREATE INDEX idx_ce_creator  ON commission_entries(creator_id);
-- at most one sale entry per transaction
CREATE UNIQUE INDEX idx_ce_one_sale ON commission_entries(transaction_id) WHERE entry_type='sale';

-- ---- post a SALE: compute the waterfall and lock it in -----------------------
CREATE OR REPLACE FUNCTION fn_post_sale(tx uuid) RETURNS commission_entries AS $$
DECLARE
  t transactions; cr creators; org uuid;
  psp numeric := 0; margin numeric := 0; blended numeric := 0; chatpct numeric := 0;
  model creator_revenue_model := 'ai';
  split numeric := 0; dist numeric; c_amt numeric; ch_amt numeric; ag_amt numeric;
  entry commission_entries;
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

  -- exact NUMERIC arithmetic (× then ÷100 both terminate → no rounding)
  dist  := t.gross - (t.gross * blended) / 100;
  IF model = 'revshare' THEN c_amt := (dist * split) / 100; ELSE c_amt := 0; END IF;
  ch_amt := (dist * chatpct) / 100;
  ag_amt := dist - c_amt - ch_amt;

  INSERT INTO commission_entries(
    workspace_id,transaction_id,creator_id,chatter_membership_id,entry_type,revenue_model,
    gross,platform_fee,platform_margin,psp_fee,distributable,creator_amount,chatter_amount,agency_amount,chargeback_fee,status)
  VALUES(
    t.workspace_id,t.id,t.creator_id,t.attributed_membership_id,'sale',model,
    t.gross,(t.gross*blended)/100,(t.gross*margin)/100,(t.gross*psp)/100,dist,c_amt,ch_amt,ag_amt,0,'locked')
  RETURNING * INTO entry;
  RETURN entry;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ---- post a CHARGEBACK: reverse the sale and assign the loss -----------------
CREATE OR REPLACE FUNCTION fn_post_chargeback(tx uuid) RETURNS commission_entries AS $$
DECLARE
  s commission_entries; org uuid; cbfee numeric := 0;
  c_amt numeric; ch_amt numeric; ag_amt numeric; entry commission_entries;
BEGIN
  SELECT * INTO s FROM commission_entries WHERE transaction_id = tx AND entry_type = 'sale';
  IF NOT FOUND THEN RAISE EXCEPTION 'no sale entry for transaction %', tx; END IF;
  IF EXISTS (SELECT 1 FROM commission_entries WHERE transaction_id = tx AND entry_type = 'chargeback') THEN
    RAISE EXCEPTION 'chargeback already posted for transaction %', tx;
  END IF;

  SELECT organization_id INTO org FROM workspaces WHERE id = s.workspace_id;
  SELECT chargeback_fee INTO cbfee FROM effective_settlement_fees(org, now());
  cbfee := COALESCE(cbfee,0);

  -- chatter always loses the commission
  ch_amt := - s.chatter_amount;
  IF s.revenue_model = 'revshare' THEN
    -- creator is charged back her share + the chargeback fee; agency loses its own share
    c_amt  := - s.creator_amount - cbfee;
    ag_amt := - s.agency_amount;
  ELSE
    -- salary/ai: agency absorbs the distributable + the fee; creator not charged
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

-- ---- RLS (mirror the tenant/platform pattern from migration 006) -------------
ALTER TABLE commission_entries   ENABLE ROW LEVEL SECURITY;
ALTER TABLE commission_entries   FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON commission_entries
  USING (is_platform_context() OR workspace_id = current_workspace_id())
  WITH CHECK (is_platform_context() OR workspace_id = current_workspace_id());

ALTER TABLE settlement_fee_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE settlement_fee_config FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON settlement_fee_config
  USING (is_platform_context()
         OR organization_id = (SELECT organization_id FROM workspaces WHERE id = current_workspace_id()))
  WITH CHECK (is_platform_context());

COMMIT;
