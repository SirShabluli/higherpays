-- ============================================================================
-- Migration 011: agency-visible blended platform rate
--
-- Each workspace's blended platform fee (PSP + HigherPays margin) is the rate the
-- agency actually sees and is charged. This SECURITY DEFINER function returns
-- ONLY the blended number for a workspace (never the PSP/margin breakdown, which
-- is HigherPays-internal), so the agency console can display its own rate without
-- being granted read access to platform_fee_rates.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION workspace_blended_rate(ws uuid) RETURNS numeric AS $$
  SELECT COALESCE((
    SELECT pf.blended_rate_pct
    FROM platform_fee_rates pf
    JOIN workspaces w ON w.organization_id = pf.organization_id
    WHERE w.id = ws
    ORDER BY pf.effective_from DESC
    LIMIT 1
  ), 0);
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

COMMIT;
