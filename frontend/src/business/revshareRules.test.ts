import { describe, it, expect } from 'vitest';
import { resolveRevshareRules } from './revshareRules';
import type { Creator, Chatter, Commission } from '../types';

const commission: Commission = { creatorSplit: 70, agencySplit: 30, chatterPct: 8 };

const creators: Creator[] = [
  { id: '1', name: 'Ava', handle: '@ava', color: '#000', status: 'active', revModel: 'revshare', splitCreator: 72, mrr: 0 },
  { id: '2', name: 'Mia', handle: '@mia', color: '#000', status: 'active', revModel: 'salary', splitCreator: 0, salary: 3000, mrr: 0 },
  { id: '3', name: 'Nova', handle: '@nova', color: '#000', status: 'paused', revModel: 'ai', splitCreator: 0, mrr: 0 },
];

const chatters: Chatter[] = [
  { id: '1', name: 'Sam', email: 's@x', status: 'active', shift: 'Day', assigned: [], commissionPct: 15 },
  { id: '2', name: 'Priya', email: 'p@x', status: 'active', shift: 'Night', assigned: [], commissionPct: 8 },
];

describe('resolveRevshareRules', () => {
  it('reads model + split from the matching creator', () => {
    const r = resolveRevshareRules('Ava', 'Sam', creators, chatters, commission);
    expect(r.model).toBe('revshare');
    expect(r.creatorSplitPct).toBe(72);
    expect(r.chatterPct).toBe(15);
  });

  it('preserves the salary model even when splitCreator is 0', () => {
    const r = resolveRevshareRules('Mia', 'Priya', creators, chatters, commission);
    expect(r.model).toBe('salary');
    expect(r.creatorSplitPct).toBe(0);
  });

  it('falls back to workspace defaults when the creator is unknown', () => {
    const r = resolveRevshareRules('Unknown', 'Sam', creators, chatters, commission);
    expect(r.model).toBe('revshare');
    expect(r.creatorSplitPct).toBe(70);
    expect(r.chatterPct).toBe(15);
  });

  it('falls back to the default chatter percentage when the chatter is unknown', () => {
    const r = resolveRevshareRules('Ava', 'Ghost', creators, chatters, commission);
    expect(r.chatterPct).toBe(8);
  });

  it('handles a missing chatter (unassigned sale)', () => {
    const r = resolveRevshareRules('Ava', undefined, creators, chatters, commission);
    expect(r.chatterPct).toBe(8);
  });
});
