/**
 * Rate card resolution.
 *
 * Two possible sources:
 *   - The backend's `/workspaces/:id/fees` endpoint returns a live `Fees`
 *     record. When present, prefer it — that's the source of truth.
 *   - Otherwise, derive a rate card from the local `Workspace` config.
 *
 * The two branches are extracted into pure functions so each is trivially
 * testable, and `rateCard` becomes a five-line selector that stitches them
 * together.
 */

import type { Workspace, Fees, RateCard } from '../types';

/** PSP's default per-transaction fixed fee when the workspace doesn't override it. */
const DEFAULT_PSP_FIXED_FEE = 0.5;
const DEFAULT_PSP_PCT = 8;
const DEFAULT_MARGIN_PCT = 0;
const DEFAULT_REFUND_FEE = 15;
const DEFAULT_CHARGEBACK_FEE = 60;

/** Build a rate card from the workspace's own configured rates. */
export function defaultRateCard(workspace: Workspace | undefined): RateCard {
  const psp = workspace ? +workspace.pspRate : DEFAULT_PSP_PCT;
  const margin = workspace ? +workspace.marginRate : DEFAULT_MARGIN_PCT;
  return {
    blended: psp + margin,
    psp,
    margin,
    fixed: workspace?.pspFixedFee != null ? +workspace.pspFixedFee : DEFAULT_PSP_FIXED_FEE,
    refundFee: workspace?.refundFee != null ? +workspace.refundFee : DEFAULT_REFUND_FEE,
    chargebackFee: workspace?.chargebackFee != null ? +workspace.chargebackFee : DEFAULT_CHARGEBACK_FEE,
    declineFee: workspace?.declineFee != null ? +workspace.declineFee : 0,
    reservePct: workspace?.reservePct != null ? +workspace.reservePct : 0,
    reserveReleaseDays: workspace?.reserveReleaseDays != null ? +workspace.reserveReleaseDays : 0,
  };
}

/** Build a rate card from a `/workspaces/:id/fees` server response. */
export function serverRateCard(fees: Fees): RateCard {
  const hasSplit = fees.psp != null && fees.margin != null;
  const blended = fees.blended != null
    ? +fees.blended
    : (+(fees.psp ?? 0)) + (+(fees.margin ?? 0));
  return {
    blended,
    psp: hasSplit ? +(fees.psp as number) : null,
    margin: hasSplit ? +(fees.margin as number) : null,
    fixed: +fees.fixed || 0,
    refundFee: +fees.refundFee || 0,
    chargebackFee: +fees.chargebackFee || 0,
    declineFee: +fees.declineFee || 0,
    reservePct: +fees.reservePct || 0,
    reserveReleaseDays: +fees.reserveReleaseDays || 0,
  };
}

/**
 * Legacy 3-argument selector. Kept for the pre-migration pages that already
 * import `rateCard(ws, fees, isLive)`. New code should call either
 * `serverRateCard` or `defaultRateCard` directly.
 */
export function rateCard(
  workspace: Workspace | undefined,
  fees: Fees | undefined,
  isLive: boolean,
): RateCard {
  if (isLive && fees) return serverRateCard(fees);
  return defaultRateCard(workspace);
}
