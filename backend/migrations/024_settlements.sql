BEGIN;
-- Imported settlement batches from the provider's daily report.
-- One row per (currency, period). This is the source of TRUTH for fees:
-- our per-transaction fees are estimates until a settlement is imported.
CREATE TABLE settlements (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  currency           char(3) NOT NULL,
  period_start       date NOT NULL,
  period_end         date NOT NULL,
  settlement_date    date,
  paid               boolean NOT NULL DEFAULT false,
  first_transaction  text,
  last_transaction   text,
  total_transactions integer NOT NULL DEFAULT 0,
  refunds            integer NOT NULL DEFAULT 0,
  chargebacks        integer NOT NULL DEFAULT 0,
  declined           integer NOT NULL DEFAULT 0,
  volume             numeric(16,4) NOT NULL DEFAULT 0,
  approved_cost      numeric(16,4) NOT NULL DEFAULT 0,
  decline_cost       numeric(16,4) NOT NULL DEFAULT 0,
  refund_cost        numeric(16,4) NOT NULL DEFAULT 0,
  chargeback_cost    numeric(16,4) NOT NULL DEFAULT 0,
  mdr                numeric(16,4) NOT NULL DEFAULT 0,
  volume_fee         numeric(16,4) NOT NULL DEFAULT 0,
  reserve            numeric(16,4) NOT NULL DEFAULT 0,   -- held this period (your money)
  total_fees         numeric(16,4) NOT NULL DEFAULT 0,
  net                numeric(16,4) NOT NULL DEFAULT 0,
  debit              numeric(16,4) NOT NULL DEFAULT 0,   -- you owe them (carried forward)
  credit             numeric(16,4) NOT NULL DEFAULT 0,   -- due to be paid out to you
  report_settings    jsonb,                              -- fee rates printed in the report headers
  source_file        text,
  imported_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  imported_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, currency, period_start, period_end)
);
CREATE INDEX idx_settlements_ws ON settlements(workspace_id, period_end DESC);

ALTER TABLE settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE settlements FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON settlements
  USING (workspace_id = current_workspace_id()) WITH CHECK (workspace_id = current_workspace_id());
COMMIT;
