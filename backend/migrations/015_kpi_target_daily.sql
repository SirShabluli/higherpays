-- Allow a 'day' period for KPI targets (daily goals).
ALTER TABLE kpi_targets DROP CONSTRAINT IF EXISTS kpi_targets_period_check;
ALTER TABLE kpi_targets ADD  CONSTRAINT kpi_targets_period_check CHECK (period IN ('day','week','month','quarter'));
