import type { Creator, Chatter, Commission, SplitResult, RevenueModel } from '../types';

interface SplitInput {
  amount: number;
  creator: string;
  chatter?: string;
  psp?: number | null;
  margin?: number | null;
}

export function splitSale(
  s: SplitInput,
  creators: Creator[],
  chatters: Chatter[],
  commission: Commission,
): SplitResult {
  const g = s.amount;
  const psp = s.psp != null ? +s.psp : 8;
  const marg = s.margin != null ? +s.margin : 0;
  const blended = psp + marg;
  const platformFee = g * blended / 100;
  const dist = g - platformFee;

  const cObj = creators.find(c => c.name === s.creator);
  const model: RevenueModel = cObj ? cObj.revModel : 'revshare';
  const cSplit = cObj ? (+cObj.splitCreator || 70) : commission.creatorSplit;

  const chObj = s.chatter ? chatters.find(c => c.name === s.chatter) : null;
  const chatterPct = (chObj && chObj.commissionPct != null) ? +chObj.commissionPct : (commission.chatterPct || 0);

  const creatorCut = model === 'revshare' ? dist * cSplit / 100 : 0;
  const chatterCut = dist * chatterPct / 100;
  const agencyCut = dist - creatorCut - chatterCut;

  return {
    g,
    platformFee,
    dist,
    creatorCut,
    chatterCut,
    agencyCut,
    pspFee: g * psp / 100,
    margin: g * marg / 100,
    model,
    blended,
  };
}
