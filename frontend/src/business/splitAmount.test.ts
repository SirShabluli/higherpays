import { describe, it, expect } from 'vitest';
import { splitAmount } from './splitAmount';
import type { RevshareRules } from './revshareRules';

const revshareRules: RevshareRules = {
  model: 'revshare',
  creatorSplitPct: 70,
  chatterPct: 10,
};

describe('splitAmount', () => {
  it('applies the flat blended fee before splitting the rest', () => {
    // EUR 100 * (8% + 5%) = 13 platform fee, 87 to distribute
    // creator 70% of 87 = 60.9; chatter 10% of 87 = 8.7; agency = 17.4
    const s = splitAmount(100, 8, 5, revshareRules);
    expect(s.gross).toBe(100);
    expect(s.platformFee).toBeCloseTo(13, 4);
    expect(s.distributable).toBeCloseTo(87, 4);
    expect(s.creatorCut).toBeCloseTo(60.9, 4);
    expect(s.chatterCut).toBeCloseTo(8.7, 4);
    expect(s.agencyCut).toBeCloseTo(17.4, 4);
  });

  it('gives salary-model creators no cut and hands the rest to the agency', () => {
    const rules: RevshareRules = { model: 'salary', creatorSplitPct: 70, chatterPct: 10 };
    const s = splitAmount(100, 8, 5, rules);
    expect(s.creatorCut).toBe(0);
    expect(s.chatterCut).toBeCloseTo(8.7, 4);
    // agency keeps what would have gone to the creator
    expect(s.agencyCut).toBeCloseTo(78.3, 4);
  });

  it('gives AI-model creators no cut', () => {
    const rules: RevshareRules = { model: 'ai', creatorSplitPct: 70, chatterPct: 0 };
    const s = splitAmount(100, 8, 5, rules);
    expect(s.creatorCut).toBe(0);
    expect(s.chatterCut).toBe(0);
    expect(s.agencyCut).toBeCloseTo(87, 4);
  });

  it('exposes pspFee, marginFee, and blendedPct on the result', () => {
    const s = splitAmount(200, 8, 5, revshareRules);
    expect(s.pspFee).toBeCloseTo(16, 4);
    expect(s.marginFee).toBeCloseTo(10, 4);
    expect(s.blendedPct).toBe(13);
  });

  it('coerces non-finite input to 0 without producing NaN', () => {
    const s = splitAmount(Number.NaN, 8, 5, revshareRules);
    expect(s.gross).toBe(0);
    expect(s.distributable).toBe(0);
    expect(s.agencyCut).toBe(0);
    expect(Number.isNaN(s.chatterCut)).toBe(false);
  });

  it('conserves money: all cuts + platformFee sum to gross', () => {
    const s = splitAmount(137.42, 8, 5, revshareRules);
    const total = s.creatorCut + s.chatterCut + s.agencyCut + s.platformFee;
    expect(total).toBeCloseTo(s.gross, 6);
  });
});
