/**
 * Payouts page.
 *
 * Reads a `PayoutBreakdown` from `usePayoutsData` (demo-computed or fetched)
 * and renders three cards: creators owed, chatters owed, reserve.
 *
 * In demo mode "Pay" marks a name as paid client-side. In live mode we call
 * `payoutsApi.run` and refetch the breakdown.
 */

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '../../store/appStore';
import { useCan } from '../../hooks/usePermission';
import { useCurrentSession } from '../../hooks/useCurrentSession';
import { formatMoney } from '../../lib/format';
import { payoutsApi } from '../../api/endpoints';
import { toast } from '../../components/Toast';
import { PageHeader, StatCard, StatGrid, Money, Pill } from '../../components/ui';
import { usePayoutsData, type PayoutPeriod } from './usePayoutsData';

function nextPayoutDate(cycle: 'weekly' | 'biweekly' | 'monthly'): number {
  const d = new Date();
  if (cycle === 'monthly') return new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
  const day = d.getDay();
  let add = (5 - day + 7) % 7;
  if (add === 0) add = 7;
  if (cycle === 'biweekly') add += 7;
  const nf = new Date(d);
  nf.setDate(d.getDate() + add);
  nf.setHours(0, 0, 0, 0);
  return nf.getTime();
}

function lockCard(title: string, msg: string) {
  return (
    <div className="card" style={{ textAlign: 'center', padding: 40 }}>
      <h3 style={{ marginBottom: 8 }}>{title}</h3>
      <p className="sub">{msg}</p>
    </div>
  );
}

export default function PayoutsPage() {
  const can = useCan();
  const { isDemo, activeWorkspaceId } = useCurrentSession();
  const settlements = useAppStore((s) => s.settlements) ?? [];
  const qc = useQueryClient();

  const [period, setPeriod] = useState<PayoutPeriod>('month');
  const [cycle, setCycle] = useState<'weekly' | 'biweekly' | 'monthly'>('monthly');
  const [paidCreators, setPaidCreators] = useState<Set<string>>(new Set());
  const [paidChatters, setPaidChatters] = useState<Set<string>>(new Set());

  const { data, isLoading, isError } = usePayoutsData({ period, paidCreators, paidChatters });

  const runPayout = useMutation({
    mutationFn: (input: { payeeType: 'creator' | 'chatter'; targetId?: string }) =>
      payoutsApi.run(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payouts-breakdown', activeWorkspaceId] });
      toast('Payout initiated.');
    },
    onError: (err) => {
      toast(err instanceof Error ? err.message : 'Payout failed.');
    },
  });

  const canPay = can('commissions.manage');

  if (!can('commissions.view')) {
    return <div>{lockCard('No access to payouts', 'Ask an owner or admin if you need it.')}</div>;
  }

  if (isLoading) {
    return (
      <div>
        <PageHeader title="Payouts" subtitle="Accrued balances and estimated payout dates." />
        <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
          Loading payout breakdown…
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div>
        <PageHeader title="Payouts" subtitle="Accrued balances and estimated payout dates." />
        <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
          <p style={{ marginBottom: 8, color: 'var(--red)' }}>Couldn't load the breakdown.</p>
          <p className="sub">Check the API URL in Settings, or try again in a moment.</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div>
        <PageHeader title="Payouts" subtitle="Accrued balances and estimated payout dates." />
        <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
          Nothing owed for this period yet.
        </div>
      </div>
    );
  }

  const creatorsOwed = data.perCreator.reduce((s, c) => s + c.owed, 0);
  const chattersOwed = data.perChatter.reduce((s, c) => s + c.owed, 0);
  const owedNow = creatorsOwed + chattersOwed;
  const nd = nextPayoutDate(cycle);
  const ndLabel = new Date(nd).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

  const payCreator = (name: string) => {
    if (isDemo) {
      setPaidCreators((s) => new Set([...s, name]));
      toast(`Marked ${name} as paid (demo).`);
      return;
    }
    runPayout.mutate({ payeeType: 'creator' });
  };
  const payChatter = (name: string) => {
    if (isDemo) {
      setPaidChatters((s) => new Set([...s, name]));
      toast(`Marked ${name} as paid (demo).`);
      return;
    }
    runPayout.mutate({ payeeType: 'chatter' });
  };
  const payAllCreators = () => {
    if (isDemo) {
      setPaidCreators(new Set(data.perCreator.map((c) => c.name)));
      toast('All creators marked as paid (demo).');
      return;
    }
    runPayout.mutate({ payeeType: 'creator' });
  };
  const payAllChatters = () => {
    if (isDemo) {
      setPaidChatters(new Set(data.perChatter.map((c) => c.name)));
      toast('All chatters marked as paid (demo).');
      return;
    }
    runPayout.mutate({ payeeType: 'chatter' });
  };

  return (
    <div>
      <PageHeader
        eyebrow="Money out"
        title="Payouts"
        subtitle="What you owe your creators and team, and when it goes out."
        actions={
          <>
            <div className="field" style={{ minWidth: 0 }}>
              <label>Period</label>
              <select value={period} onChange={(e) => setPeriod(e.target.value as PayoutPeriod)}>
                <option value="month">This month</option>
                <option value="week">This week</option>
                <option value="all">All time</option>
              </select>
            </div>
            <div className="field" style={{ minWidth: 0 }}>
              <label>Cycle</label>
              <select value={cycle} onChange={(e) => setCycle(e.target.value as typeof cycle)}>
                <option value="weekly">Weekly (Fri)</option>
                <option value="biweekly">Bi-weekly</option>
                <option value="monthly">Monthly (1st)</option>
              </select>
            </div>
          </>
        }
      />

      <StatGrid>
        <StatCard label="Owed to creators" value={<Money amount={creatorsOwed} direction="out" emphasis />} sub="rev-share this period" />
        <StatCard label="Owed to team" value={<Money amount={chattersOwed} direction="out" emphasis />} sub="commissions this period" />
        <StatCard
          label="Held in reserve"
          value={<Money amount={data.reserve.held} />}
          sub={data.reserve.pct
            ? `${data.reserve.pct}% · released after ${data.reserve.releaseDays}d`
            : 'no reserve configured'}
        />
        <StatCard label="Next payout" value={ndLabel} sub={`${cycle} cycle`} />
      </StatGrid>

      {data.reserve.held > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="sechead" style={{ marginTop: 0 }}>Cash position</div>
          <p className="sub" style={{ marginTop: 0 }}>
            The reserve is <b>your money</b>, held by MantaPay and released later. If you pay everyone in full today, you front the reserve amount yourself.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0' }}>
            <span style={{ minWidth: 240, fontSize: 13.5, color: 'var(--muted)' }}>Owed to creators &amp; team</span>
            <span style={{ flex: 1, height: 6, background: 'var(--surface-2)', borderRadius: 3, overflow: 'hidden' }}>
              <span style={{ display: 'block', width: `${Math.min(100, (owedNow / Math.max(owedNow, data.reserve.held, 1)) * 100)}%`, height: '100%', background: 'var(--ink)', borderRadius: 3 }} />
            </span>
            <span className="mono" style={{ minWidth: 100, textAlign: 'right', fontSize: 13.5 }}>{formatMoney(owedNow)}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0' }}>
            <span style={{ minWidth: 240, fontSize: 13.5, color: 'var(--muted)' }}>Held in reserve (not yet available)</span>
            <span style={{ flex: 1, height: 6, background: 'var(--surface-2)', borderRadius: 3, overflow: 'hidden' }}>
              <span style={{ display: 'block', width: `${Math.min(100, (data.reserve.held / Math.max(owedNow, data.reserve.held, 1)) * 100)}%`, height: '100%', background: 'var(--accent)', borderRadius: 3 }} />
            </span>
            <span className="mono" style={{ minWidth: 100, textAlign: 'right', fontSize: 13.5 }}>{formatMoney(data.reserve.held)}</span>
          </div>
          {data.reserve.source === 'estimated' && (
            <div className="warnbar" style={{ marginTop: 10 }}>
              Estimated from your {data.reserve.pct}% rate — import a settlement report for the exact figure.
            </div>
          )}
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="sechead" style={{ marginTop: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          Creator payouts
          {canPay && data.perCreator.some((c) => c.owed > 0) && (
            <button className="btn ghost" style={{ padding: '5px 11px', fontWeight: 400 }} onClick={payAllCreators}>
              Pay all creators
            </button>
          )}
        </div>
        <div className="tablewrap" style={{ border: 'none' }}>
          <table>
            <thead>
              <tr>
                <th>Creator</th><th>Model</th><th>Revenue</th>
                <th>Owed (balance)</th><th>Est. payout</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.perCreator.length ? data.perCreator.map((c) => {
                const owed = c.model === 'salary' ? c.salary : c.owed;
                return (
                  <tr key={c.name}>
                    <td className="cname">{c.name}</td>
                    <td><Pill>{c.model}</Pill></td>
                    <td><Money amount={c.revenue} direction="in" /></td>
                    <td>
                      <Money amount={owed} direction="out" emphasis />{c.model === 'salary' ? '/mo' : ''}
                    </td>
                    <td className="time">{ndLabel}</td>
                    <td>
                      {c.model === 'salary' ? (
                        <Pill>salary</Pill>
                      ) : c.owed > 0 ? (
                        <>
                          <Pill tone="ok">accruing</Pill>
                          {canPay && (
                            <button
                              className="btn ghost"
                              style={{ padding: '3px 9px', marginLeft: 6, fontWeight: 400 }}
                              onClick={() => payCreator(c.name)}
                              disabled={runPayout.isPending}
                            >
                              Pay
                            </button>
                          )}
                        </>
                      ) : <Pill>—</Pill>}
                    </td>
                  </tr>
                );
              }) : (
                <tr>
                  <td colSpan={6} style={{ padding: 24, textAlign: 'center', color: 'var(--muted)' }}>
                    No creators.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="sechead" style={{ marginTop: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          Chatter payouts
          {canPay && data.perChatter.some((c) => c.owed > 0) && (
            <button className="btn ghost" style={{ padding: '5px 11px', fontWeight: 400 }} onClick={payAllChatters}>
              Pay all chatters
            </button>
          )}
        </div>
        <div className="tablewrap" style={{ border: 'none' }}>
          <table>
            <thead>
              <tr>
                <th>Chatter</th><th>Sales</th><th>Commission owed</th><th>Est. payout</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.perChatter.length ? data.perChatter.map((c) => (
                <tr key={c.name}>
                  <td className="cname">{c.name}</td>
                  <td>{c.sales}</td>
                  <td><Money amount={c.owed} direction="out" emphasis /></td>
                  <td className="time">{ndLabel}</td>
                  <td>
                    {c.owed > 0 ? (
                      <>
                        <Pill tone="ok">accruing</Pill>
                        {canPay && (
                          <button
                            className="btn ghost"
                            style={{ padding: '3px 9px', marginLeft: 6, fontWeight: 400 }}
                            onClick={() => payChatter(c.name)}
                            disabled={runPayout.isPending}
                          >
                            Pay
                          </button>
                        )}
                      </>
                    ) : <Pill>—</Pill>}
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={5} style={{ padding: 24, textAlign: 'center', color: 'var(--muted)' }}>
                    No chatters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="sub" style={{ marginTop: 12 }}>
          Balances accrue from paid sales in the selected period; disbursement happens on the payout cycle.
        </p>
      </div>

      {can('commissions.manage') && settlements.length > 0 && (
        <div className="card">
          <div className="sechead" style={{ marginTop: 0 }}>Settlement reports</div>
          <div className="tablewrap" style={{ border: 'none', marginTop: 12 }}>
            <table>
              <thead>
                <tr>
                  <th>Period</th><th>Volume</th><th>Fees</th>
                  <th>Reserve</th><th>Payable</th><th>Reconciliation</th>
                </tr>
              </thead>
              <tbody>
                {settlements.map((s, i) => (
                  <tr key={i}>
                    <td className="cname">{s.period}</td>
                    <td><Money amount={s.volume} direction="in" /></td>
                    <td><Money amount={s.fees} direction="out" /></td>
                    <td><Money amount={s.reserve} /></td>
                    <td><Money amount={s.payable} direction="in" emphasis /></td>
                    <td>
                      <Pill tone={s.reconciliation.status === 'matched' ? 'ok' : 'no'}>
                        {s.reconciliation.status === 'matched' ? 'Matched' : 'Variance'}
                      </Pill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
