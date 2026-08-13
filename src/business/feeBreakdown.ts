import type { RateCard, FeeBreakdownResult } from '../types';

export function feeBreakdown(amount: number, rc: RateCard): FeeBreakdownResult {
  const a = +amount || 0;
  const blendedFee = a * rc.blended / 100;
  const fixed = rc.fixed;
  const total = blendedFee + fixed;
  return {
    amount: a,
    blendedPct: rc.blended,
    blendedFee,
    fixed,
    total,
    pspPct: rc.psp,
    marginPct: rc.margin,
    pspFee: rc.psp != null ? a * rc.psp / 100 : null,
    marginFee: rc.margin != null ? a * rc.margin / 100 : null,
    effectivePct: a > 0 ? total / a * 100 : 0,
    net: a - total,
  };
}
