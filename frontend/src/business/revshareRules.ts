/**
 * Determine, for a given sale, *how* it should be split — what fraction goes
 * to the creator vs. the chatter — but nothing about the money math.
 *
 * Isolated from `splitAmount` so the pure math can be tested without wiring
 * up creator/chatter dictionaries, and so that changing the *rules* (e.g.
 * making salary creators share a flat bonus) doesn't touch the arithmetic.
 */

import type { Creator, Chatter, Commission, RevenueModel } from '../types';

export interface RevshareRules {
  /** Determines whether the creator receives a variable share of `distributable`. */
  model: RevenueModel;
  /**
   * Creator's percentage of the distributable amount, `0..100`.
   * Only applied when `model === 'revshare'`; salary/AI creators receive 0.
   */
  creatorSplitPct: number;
  /** Chatter's percentage of the distributable amount, `0..100`. */
  chatterPct: number;
}

/**
 * Look up the creator + chatter overrides and merge with workspace defaults.
 * Missing entries fall back to `defaults`. Non-finite numeric fields default
 * to 0 rather than propagating NaN through the ledger.
 */
export function resolveRevshareRules(
  creatorName: string,
  chatterName: string | undefined,
  creators: readonly Creator[],
  chatters: readonly Chatter[],
  defaults: Commission,
): RevshareRules {
  const creator = creators.find((c) => c.name === creatorName);
  const chatter = chatterName ? chatters.find((c) => c.name === chatterName) : undefined;

  const creatorSplit = creator ? +creator.splitCreator : defaults.creatorSplit;
  const chatterPct = chatter && chatter.commissionPct != null
    ? +chatter.commissionPct
    : (defaults.chatterPct ?? 0);

  return {
    model: creator?.revModel ?? 'revshare',
    creatorSplitPct: Number.isFinite(creatorSplit) ? creatorSplit : defaults.creatorSplit,
    chatterPct: Number.isFinite(chatterPct) ? chatterPct : 0,
  };
}
