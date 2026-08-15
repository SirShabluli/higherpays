/**
 * Data hook for the Payouts page.
 *
 * Emits a normalized "breakdown" object (creators owed, chatters owed, reserve
 * held) whether we're in demo mode (computed on the fly from local state) or
 * live (fetched from `/payouts/breakdown`). Keeps the page a pure view.
 */

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAppStore } from '../../store/appStore';
import { useCurrentSession } from '../../hooks/useCurrentSession';
import { payoutsApi, type PayoutBreakdown } from '../../api/endpoints';
import { splitSale } from '../../business/splitSale';
import { startOfMonthTZ, startOfWeekTZ, detectedTZ } from '../../business/timezone';
import { genAnalyticsData } from '../../demo/analyticsEngine';
import { sum } from '../../lib/format';

export type PayoutPeriod = 'week' | 'month' | 'all';

interface UsePayoutsDataInput {
  period: PayoutPeriod;
  paidCreators: Set<string>;
  paidChatters: Set<string>;
}

const DAY = 86_400_000;

export function usePayoutsData(input: UsePayoutsDataInput): {
  data: PayoutBreakdown | null;
  isLoading: boolean;
  isError: boolean;
} {
  const { isDemo, activeWorkspaceId } = useCurrentSession();
  const creators = useAppStore((s) => s.creators);
  const chatters = useAppStore((s) => s.chatters);
  const customers = useAppStore((s) => s.customers);
  const workspaces = useAppStore((s) => s.workspaces);
  const commission = useAppStore((s) => s.commission);
  const settlementsRaw = useAppStore((s) => s.settlements);
  const settlements = useMemo(() => settlementsRaw ?? [], [settlementsRaw]);
  const activeWsId = useAppStore((s) => s.activeWsId);
  const ws = workspaces.find((w) => w.id === activeWsId);

  const { period, paidCreators, paidChatters } = input;

  const [now] = useState(() => Date.now());
  const [fromMs, toMs] = useMemo(() => {
    const tz = detectedTZ();
    if (period === 'week') return [startOfWeekTZ(now, tz), now];
    if (period === 'all') return [now - 365 * DAY, now];
    return [startOfMonthTZ(now, tz), now];
  }, [period, now]);

  const fromIso = new Date(fromMs).toISOString().slice(0, 10);
  const toIso = new Date(toMs).toISOString().slice(0, 10);

  const liveQuery = useQuery({
    queryKey: ['payouts-breakdown', activeWorkspaceId, fromIso, toIso],
    queryFn: () => payoutsApi.getBreakdown(fromIso, toIso),
    enabled: !isDemo && Boolean(activeWorkspaceId),
  });

  const demoBreakdown: PayoutBreakdown | null = useMemo(() => {
    if (!isDemo) return null;
    const analytics = genAnalyticsData(creators, chatters, customers, workspaces);
    const agency = ws?.name ?? '';
    const sales = analytics.sales.filter((s) => s.agency === agency && s.ts >= fromMs && s.ts <= toMs);

    const perCreator = creators.map((cr) => {
      const ms = sales.filter((s) => s.creator === cr.name).map((s) =>
        splitSale(
          { amount: s.amount, creator: s.creator, chatter: s.chatter, psp: s.psp, margin: s.margin },
          creators, chatters, commission,
        ),
      );
      return {
        name: cr.name,
        model: cr.revModel,
        salary: +(cr.salary ?? 0),
        revenue: sum(ms.map((x) => x.g)),
        owed: paidCreators.has(cr.name) ? 0 : sum(ms.map((x) => x.creatorCut)),
      };
    }).sort((a, b) => b.owed - a.owed);

    const perChatter = chatters.map((ch) => {
      const ms = sales.filter((s) => s.chatter === ch.name).map((s) =>
        splitSale(
          { amount: s.amount, creator: s.creator, chatter: s.chatter, psp: s.psp, margin: s.margin },
          creators, chatters, commission,
        ),
      );
      return {
        name: ch.name,
        owed: paidChatters.has(ch.name) ? 0 : sum(ms.map((x) => x.chatterCut)),
        sales: ms.length,
      };
    }).sort((a, b) => b.owed - a.owed);

    const pct = ws?.reservePct != null ? +ws.reservePct : 0;
    const gross = sum(sales.map((s) => s.amount));
    const owed = sum(perCreator.map((c) => c.owed)) + sum(perChatter.map((c) => c.owed));
    const held = +((gross * pct) / 100).toFixed(2);

    return {
      range: { from: fromIso, to: toIso },
      perCreator,
      perChatter,
      reserve: {
        pct,
        releaseDays: ws?.reserveReleaseDays != null ? +ws.reserveReleaseDays : 0,
        held,
        source: settlements.length ? 'settlements' : 'estimated',
      },
      cash: {
        owed: +owed.toFixed(2),
        heldInReserve: held,
        shortfallIfPaidNow: Math.max(0, +owed.toFixed(2) - held),
      },
    };
  }, [
    isDemo, creators, chatters, customers, workspaces, ws,
    fromMs, toMs, fromIso, toIso, commission, paidCreators, paidChatters, settlements,
  ]);

  if (isDemo) {
    return { data: demoBreakdown, isLoading: false, isError: false };
  }
  return {
    data: liveQuery.data ?? null,
    isLoading: liveQuery.isLoading,
    isError: liveQuery.isError,
  };
}
