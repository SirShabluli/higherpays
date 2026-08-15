/**
 * Pure money math for a single sale.
 *
 * Takes the gross amount, the two rate components, and the resolved
 * rev-share rules, and returns every cut. No lookups, no side effects,
 * no defaults injected mid-calc — everything the function needs is in
 * its argument list. That makes it trivial to test and cheap to reuse.
 */

import type { RevshareRules } from './revshareRules';
import type { RevenueModel } from '../types';

export interface AmountSplit {
  /** What the customer paid (before any surcharge). */
  gross: number;
  /** Combined PSP + platform-margin fee taken by the provider + HigherPays. */
  platformFee: number;
  /** Amount left to divide between creator, chatter, and agency. */
  distributable: number;
  creatorCut: number;
  chatterCut: number;
  agencyCut: number;
  /** Component fees, useful for reporting. */
  pspFee: number;
  marginFee: number;
  /** `pspPct + marginPct`, for display. */
  blendedPct: number;
  /** The revenue model that was applied. */
  model: RevenueModel;
}

/**
 * Compute the split for one sale.
 *
 * Note: this is the *flat* fee model (each pct applied to the original
 * gross). The *cascade* model exists in the SQL layer only — see
 * migration 026 — and is not currently mirrored client-side because the
 * frontend only needs to *display* the split, not compute the ledger.
 */
export function splitAmount(
  gross: number,
  pspPct: number,
  marginPct: number,
  rules: RevshareRules,
): AmountSplit {
  const g = Number.isFinite(gross) ? gross : 0;
  const psp = Number.isFinite(pspPct) ? pspPct : 0;
  const marg = Number.isFinite(marginPct) ? marginPct : 0;
  const blended = psp + marg;
  const platformFee = g * blended / 100;
  const distributable = g - platformFee;

  const creatorCut = rules.model === 'revshare'
    ? distributable * rules.creatorSplitPct / 100
    : 0;
  const chatterCut = distributable * rules.chatterPct / 100;
  const agencyCut = distributable - creatorCut - chatterCut;

  return {
    gross: g,
    platformFee,
    distributable,
    creatorCut,
    chatterCut,
    agencyCut,
    pspFee: g * psp / 100,
    marginFee: g * marg / 100,
    blendedPct: blended,
    model: rules.model,
  };
}
