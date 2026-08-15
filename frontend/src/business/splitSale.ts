/**
 * Backward-compatible facade over `resolveRevshareRules` + `splitAmount`.
 *
 * New code should call those two directly. This wrapper exists only so that
 * the pre-migration pages (Payments, Payouts, Analytics, Compare, Goals)
 * keep compiling with their existing imports and property names.
 */

import type { Creator, Chatter, Commission, SplitResult } from '../types';
import { resolveRevshareRules } from './revshareRules';
import { splitAmount } from './splitAmount';

interface SplitInput {
  amount: number;
  creator: string;
  chatter?: string;
  psp?: number | null;
  margin?: number | null;
}

const DEFAULT_PSP_PCT = 8;
const DEFAULT_MARGIN_PCT = 0;

export function splitSale(
  input: SplitInput,
  creators: readonly Creator[],
  chatters: readonly Chatter[],
  commission: Commission,
): SplitResult {
  const rules = resolveRevshareRules(input.creator, input.chatter, creators, chatters, commission);
  const psp = input.psp != null ? +input.psp : DEFAULT_PSP_PCT;
  const margin = input.margin != null ? +input.margin : DEFAULT_MARGIN_PCT;
  const s = splitAmount(input.amount, psp, margin, rules);
  return {
    g: s.gross,
    platformFee: s.platformFee,
    dist: s.distributable,
    creatorCut: s.creatorCut,
    chatterCut: s.chatterCut,
    agencyCut: s.agencyCut,
    pspFee: s.pspFee,
    margin: s.marginFee,
    model: s.model,
    blended: s.blendedPct,
  };
}
