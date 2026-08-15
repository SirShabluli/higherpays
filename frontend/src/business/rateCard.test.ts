import { describe, it, expect } from 'vitest';
import { rateCard, serverRateCard, defaultRateCard } from './rateCard';
import type { Workspace, Fees } from '../types';

const workspace: Workspace = {
  id: 'ws1', name: 'Aurora', initial: 'A', color: '#0f0', client: '', contact: '', mid: '',
  reservePct: 5, reserveReleaseDays: 180,
  declineFee: 0.2, refundFee: 15, chargebackFee: 60,
  currencies: ['EUR'],
  pspRate: 7, marginRate: 5, pspFixedFee: 0.5,
  minLink: 20, maxLink: 400, status: 'live',
};

describe('rateCard', () => {
  it('returns a card derived from the workspace when isLive=false', () => {
    const card = rateCard(workspace, undefined, false);
    expect(card.psp).toBe(7);
    expect(card.margin).toBe(5);
    expect(card.blended).toBe(12);
    expect(card.fixed).toBe(0.5);
    expect(card.reservePct).toBe(5);
  });

  it('falls through to defaults when isLive=true but no fees supplied', () => {
    const card = rateCard(workspace, undefined, true);
    expect(card.psp).toBe(7);
    expect(card.blended).toBe(12);
  });

  it('uses the server fees when isLive=true and fees provided', () => {
    const fees: Fees = {
      blended: 13, psp: 8, margin: 5, fixed: 0.6,
      refundFee: 12, chargebackFee: 65, declineFee: 0.1,
      reservePct: 6, reserveReleaseDays: 120,
    };
    const card = rateCard(workspace, fees, true);
    expect(card.blended).toBe(13);
    expect(card.psp).toBe(8);
    expect(card.margin).toBe(5);
    expect(card.fixed).toBe(0.6);
    expect(card.reservePct).toBe(6);
  });
});

describe('serverRateCard', () => {
  it('recomputes blended when only the components are known', () => {
    const fees: Fees = {
      blended: null as unknown as number, psp: 8, margin: 5, fixed: 0.5,
      refundFee: 15, chargebackFee: 60, declineFee: 0, reservePct: 0, reserveReleaseDays: 0,
    };
    const card = serverRateCard(fees);
    expect(card.blended).toBe(13);
  });

  it('nulls out psp/margin when the server did not send a split', () => {
    const fees: Fees = {
      blended: 13, psp: null, margin: null, fixed: 0.5,
      refundFee: 15, chargebackFee: 60, declineFee: 0, reservePct: 0, reserveReleaseDays: 0,
    };
    const card = serverRateCard(fees);
    expect(card.psp).toBeNull();
    expect(card.margin).toBeNull();
    expect(card.blended).toBe(13);
  });
});

describe('defaultRateCard', () => {
  it('falls back to conservative defaults when the workspace is undefined', () => {
    const card = defaultRateCard(undefined);
    expect(card.psp).toBe(8);
    expect(card.margin).toBe(0);
    expect(card.fixed).toBe(0.5);
    expect(card.refundFee).toBe(15);
    expect(card.chargebackFee).toBe(60);
  });
});
