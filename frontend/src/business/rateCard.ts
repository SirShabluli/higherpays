import type { Workspace, Fees, RateCard } from '../types';

const PSP_FIXED_FEE = 0.50;

export function rateCard(workspace: Workspace | undefined, fees: Fees | undefined, isLive: boolean): RateCard {
  if (isLive && fees) {
    const hasSplit = fees.psp != null && fees.margin != null;
    const blended = fees.blended != null
      ? +fees.blended
      : ((+(fees.psp || 0)) + (+(fees.margin || 0)));
    return {
      blended,
      psp: hasSplit ? +fees.psp! : null,
      margin: hasSplit ? +fees.margin! : null,
      fixed: +fees.fixed || 0,
      refundFee: +fees.refundFee || 0,
      chargebackFee: +fees.chargebackFee || 0,
      declineFee: +fees.declineFee || 0,
      reservePct: +fees.reservePct || 0,
      reserveReleaseDays: +fees.reserveReleaseDays || 0,
    };
  }

  const w = workspace;
  const psp = w ? +w.pspRate : 8;
  const margin = w ? +w.marginRate : 0;
  return {
    blended: psp + margin,
    psp,
    margin,
    fixed: w && w.pspFixedFee != null ? +w.pspFixedFee : PSP_FIXED_FEE,
    refundFee: w && w.refundFee != null ? +w.refundFee : 15,
    chargebackFee: w && w.chargebackFee != null ? +w.chargebackFee : 60,
    declineFee: w && w.declineFee != null ? +w.declineFee : 0,
    reservePct: w && w.reservePct != null ? +w.reservePct : 0,
    reserveReleaseDays: w && w.reserveReleaseDays != null ? +w.reserveReleaseDays : 0,
  };
}
