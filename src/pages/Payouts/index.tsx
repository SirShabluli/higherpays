import { useState, useMemo, useRef, useCallback } from 'react';
import { useAppStore } from '../../store/appStore';
import { useCan, useActiveWorkspace } from '../../hooks/usePermission';
import { splitSale } from '../../business/splitSale';
import { genAnalyticsData, type AnalyticsData } from '../../demo/analyticsEngine';
import { startOfWeekTZ, startOfMonthTZ, detectedTZ } from '../../business/timezone';
import { toast } from '../../components/Toast';

const DAY = 86400000;
const now = Date.now();
const _sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

const fmt = (n: number) => {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR' }).format(n); }
  catch { return 'EUR ' + n.toFixed(2); }
};

function lockCard(title: string, msg: string) {
  return (
    <div className="card" style={{ textAlign: 'center', padding: 40 }}>
      <h3 style={{ marginBottom: 8 }}>{title}</h3>
      <p className="sub">{msg}</p>
    </div>
  );
}

function nextPayoutDate(cycle: string): number {
  const d = new Date(now);
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

export default function PayoutsPage() {
  const can = useCan();
  const creators = useAppStore(s => s.creators);
  const chatters = useAppStore(s => s.chatters);
  const customers = useAppStore(s => s.customers);
  const workspaces = useAppStore(s => s.workspaces);
  const commission = useAppStore(s => s.commission);
  const settlements = useAppStore(s => s.settlements) || [];
  const ws = useActiveWorkspace();
  const tz = detectedTZ();

  // Filters
  const [poPeriod, setPoPeriod] = useState('month');
  const [poCycle, setPoCycle] = useState('monthly');

  // Track paid (demo only)
  const [paidCreators, setPaidCreators] = useState<Set<string>>(new Set());
  const [paidChatters, setPaidChatters] = useState<Set<string>>(new Set());

  // Analytics data (lazy)
  const analyticsRef = useRef<AnalyticsData | null>(null);
  const getAnalytics = useCallback(() => {
    if (!analyticsRef.current) {
      analyticsRef.current = genAnalyticsData(creators, chatters, customers, workspaces);
    }
    return analyticsRef.current;
  }, [creators, chatters, customers, workspaces]);

  // Period range
  const [fromMs, toMs] = useMemo(() => {
    if (poPeriod === 'week') return [startOfWeekTZ(now, tz), now];
    if (poPeriod === 'all') return [now - 365 * DAY, now];
    return [startOfMonthTZ(now, tz), now];
  }, [poPeriod, tz]);

  // Build payout data
  const payoutData = useMemo(() => {
    const analytics = getAnalytics();
    const agency = ws?.name || '';
    const sales = analytics.sales.filter(x => x.agency === agency && x.ts >= fromMs && x.ts <= toMs);

    const perCreator = creators.map(cr => {
      const ms = sales.filter(s => s.creator === cr.name).map(s =>
        splitSale(
          { amount: s.amount, creator: s.creator, chatter: s.chatter, psp: s.psp, margin: s.margin },
          creators, chatters, commission,
        ),
      );
      return {
        name: cr.name,
        model: cr.revModel,
        salary: +(cr.salary || 0),
        revenue: _sum(ms.map(x => x.g)),
        owed: paidCreators.has(cr.name) ? 0 : _sum(ms.map(x => x.creatorCut)),
      };
    }).sort((a, b) => b.owed - a.owed);

    const perChatter = chatters.map(ch => {
      const ms = sales.filter(s => s.chatter === ch.name).map(s =>
        splitSale(
          { amount: s.amount, creator: s.creator, chatter: s.chatter, psp: s.psp, margin: s.margin },
          creators, chatters, commission,
        ),
      );
      return {
        name: ch.name,
        owed: paidChatters.has(ch.name) ? 0 : _sum(ms.map(x => x.chatterCut)),
        sales: ms.length,
      };
    }).sort((a, b) => b.owed - a.owed);

    const pct = ws?.reservePct != null ? +ws.reservePct : 0;
    const gross = _sum(sales.map(s => s.amount));
    const owed = _sum(perCreator.map(c => c.owed)) + _sum(perChatter.map(c => c.owed));
    const held = +(gross * pct / 100).toFixed(2);

    return {
      perCreator,
      perChatter,
      reserve: {
        pct,
        releaseDays: ws?.reserveReleaseDays != null ? +ws.reserveReleaseDays : 0,
        held,
        source: settlements.length ? 'settlements' : 'estimated',
      },
      cash: { owed: +owed.toFixed(2), heldInReserve: held },
    };
  }, [getAnalytics, ws, fromMs, toMs, creators, chatters, commission, paidCreators, paidChatters, settlements]);

  const canPay = can('commissions.manage');

  // Payout handlers
  const payCreator = (name: string) => {
    setPaidCreators(prev => new Set([...prev, name]));
    toast(`Marked ${name} as paid (demo).`);
  };
  const payAllCreators = () => {
    setPaidCreators(new Set(creators.map(c => c.name)));
    toast('All creators marked as paid (demo).');
  };
  const payChatter = (name: string) => {
    setPaidChatters(prev => new Set([...prev, name]));
    toast(`Marked ${name} as paid (demo).`);
  };
  const payAllChatters = () => {
    setPaidChatters(new Set(chatters.map(c => c.name)));
    toast('All chatters marked as paid (demo).');
  };

  if (!can('commissions.view')) {
    return <div>{lockCard('No access to payouts', 'Ask an owner or admin if you need it.')}</div>;
  }

  const creatorsOwed = _sum(payoutData.perCreator.map(c => c.owed));
  const chattersOwed = _sum(payoutData.perChatter.map(c => c.owed));
  const rsv = payoutData.reserve;
  const nd = nextPayoutDate(poCycle);
  const ndLabel = new Date(nd).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const owedNow = creatorsOwed + chattersOwed;

  const Accruing = () => <span className="seg" style={{ background: 'rgba(21,195,175,.15)', color: 'var(--mint)' }}>accruing</span>;
  const Dash = () => <span className="seg">—</span>;

  return (
    <div>
      <div className="pagehead">
        <div>
          <h2>Payouts</h2>
          <p>Accrued balances and estimated payout dates for your team.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="field" style={{ minWidth: 0 }}>
            <label>Period</label>
            <select value={poPeriod} onChange={e => setPoPeriod(e.target.value)}>
              <option value="month">This month</option>
              <option value="week">This week</option>
              <option value="all">All time</option>
            </select>
          </div>
          <div className="field" style={{ minWidth: 0 }}>
            <label>Payout cycle</label>
            <select value={poCycle} onChange={e => setPoCycle(e.target.value)}>
              <option value="weekly">Weekly (Fri)</option>
              <option value="biweekly">Bi-weekly</option>
              <option value="monthly">Monthly (1st)</option>
            </select>
          </div>
        </div>
      </div>

      {/* Summary stats */}
      <div className="stats">
        <div className="card stat">
          <div className="lbl">Creators owed</div>
          <div className="val" style={{ color: 'var(--mint)' }}>{fmt(creatorsOwed)}</div>
          <div className="sub">rev-share this period</div>
        </div>
        <div className="card stat">
          <div className="lbl">Chatters owed</div>
          <div className="val" style={{ color: 'var(--brand)' }}>{fmt(chattersOwed)}</div>
          <div className="sub">commission this period</div>
        </div>
        <div className="card stat">
          <div className="lbl">Held in reserve</div>
          <div className="val" style={{ color: 'var(--amber)' }}>{fmt(rsv.held)}</div>
          <div className="sub">
            {rsv.pct ? `${rsv.pct}% · released after ${rsv.releaseDays}d · ${rsv.source}` : 'no reserve configured'}
          </div>
        </div>
        <div className="card stat">
          <div className="lbl">Next payout</div>
          <div className="val">{ndLabel}</div>
          <div className="sub">{poCycle} cycle</div>
        </div>
      </div>

      {/* Cash position (if reserve exists) */}
      {rsv.held > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="sechead" style={{ marginTop: 0 }}>Cash position</div>
          <p className="sub" style={{ marginTop: 0 }}>
            The reserve is <b>your money</b>, held by the provider and released later. If you pay everyone their full share today, you front that amount yourself.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0' }}>
            <span style={{ minWidth: 240, fontSize: '13.6px', color: 'var(--muted)' }}>Owed to creators &amp; chatters</span>
            <span style={{ flex: 1, height: 8, background: 'var(--ink)', borderRadius: 4, overflow: 'hidden' }}>
              <span style={{ display: 'block', width: `${Math.min(100, owedNow / Math.max(owedNow, rsv.held, 1) * 100)}%`, height: '100%', background: 'var(--brand)', borderRadius: 4 }} />
            </span>
            <span style={{ minWidth: 100, textAlign: 'right', fontSize: '13.6px' }}>{fmt(owedNow)}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0' }}>
            <span style={{ minWidth: 240, fontSize: '13.6px', color: 'var(--muted)' }}>Held in reserve (not yet available)</span>
            <span style={{ flex: 1, height: 8, background: 'var(--ink)', borderRadius: 4, overflow: 'hidden' }}>
              <span style={{ display: 'block', width: `${Math.min(100, rsv.held / Math.max(owedNow, rsv.held, 1) * 100)}%`, height: '100%', background: 'var(--amber)', borderRadius: 4 }} />
            </span>
            <span style={{ minWidth: 100, textAlign: 'right', fontSize: '13.6px' }}>{fmt(rsv.held)}</span>
          </div>
          {rsv.source === 'estimated' && (
            <div className="warnbar" style={{ marginTop: 10 }}>
              ⚠ Estimated from your {rsv.pct}% rate — import a settlement report for the exact figure.
            </div>
          )}
        </div>
      )}

      {/* Creator payouts */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="sechead" style={{ marginTop: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          Creator payouts
          {canPay && (
            <button className="btn ghost" style={{ padding: '5px 11px', fontWeight: 400 }} onClick={payAllCreators}>
              Pay all creators
            </button>
          )}
        </div>
        <div className="tablewrap" style={{ border: 'none' }}>
          <table>
            <thead><tr><th>Creator</th><th>Model</th><th>Revenue</th><th>Owed (balance)</th><th>Est. payout</th><th>Status</th></tr></thead>
            <tbody>
              {payoutData.perCreator.length > 0 ? payoutData.perCreator.map(c => {
                const owed = c.model === 'salary' ? c.salary : c.owed;
                return (
                  <tr key={c.name}>
                    <td className="cname">{c.name}</td>
                    <td><span className="seg">{c.model}</span></td>
                    <td className="amt">{fmt(c.revenue)}</td>
                    <td className="amt" style={{ color: 'var(--mint)' }}>{fmt(owed)}{c.model === 'salary' ? '/mo' : ''}</td>
                    <td className="time">{ndLabel}</td>
                    <td>
                      {c.model === 'salary' ? (
                        <span className="seg">salary</span>
                      ) : c.owed > 0 ? (
                        <>
                          <Accruing />
                          {canPay && (
                            <button className="btn ghost" style={{ padding: '3px 9px', marginLeft: 6, fontWeight: 400 }} onClick={() => payCreator(c.name)}>
                              Pay
                            </button>
                          )}
                        </>
                      ) : <Dash />}
                    </td>
                  </tr>
                );
              }) : (
                <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: 'var(--muted)' }}>No creators.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Chatter payouts */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="sechead" style={{ marginTop: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          Chatter payouts
          {canPay && (
            <button className="btn ghost" style={{ padding: '5px 11px', fontWeight: 400 }} onClick={payAllChatters}>
              Pay all chatters
            </button>
          )}
        </div>
        <div className="tablewrap" style={{ border: 'none' }}>
          <table>
            <thead><tr><th>Chatter</th><th>Sales</th><th>Commission owed</th><th>Est. payout</th><th>Status</th></tr></thead>
            <tbody>
              {payoutData.perChatter.length > 0 ? payoutData.perChatter.map(c => (
                <tr key={c.name}>
                  <td className="cname">{c.name}</td>
                  <td>{c.sales}</td>
                  <td className="amt" style={{ color: 'var(--brand)' }}>{fmt(c.owed)}</td>
                  <td className="time">{ndLabel}</td>
                  <td>
                    {c.owed > 0 ? (
                      <>
                        <Accruing />
                        {canPay && (
                          <button className="btn ghost" style={{ padding: '3px 9px', marginLeft: 6, fontWeight: 400 }} onClick={() => payChatter(c.name)}>
                            Pay
                          </button>
                        )}
                      </>
                    ) : <Dash />}
                  </td>
                </tr>
              )) : (
                <tr><td colSpan={5} style={{ padding: 24, textAlign: 'center', color: 'var(--muted)' }}>No chatters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="sub" style={{ marginTop: 12 }}>
          Balances accrue from paid sales in the selected period; disbursement happens on the payout cycle.
        </p>
      </div>

      {/* Settlements (if any) */}
      {can('commissions.manage') && settlements.length > 0 && (
        <div className="card">
          <div className="sechead" style={{ marginTop: 0 }}>Settlement reports</div>
          <div className="tablewrap" style={{ border: 'none', marginTop: 12 }}>
            <table>
              <thead><tr><th>Period</th><th>Volume</th><th>Fees</th><th>Reserve</th><th>Payable</th><th>Reconciliation</th></tr></thead>
              <tbody>
                {settlements.map((s, i) => (
                  <tr key={i}>
                    <td className="cname">{s.period}</td>
                    <td className="amt">{fmt(s.volume)}</td>
                    <td className="amt">{fmt(s.fees)}</td>
                    <td className="amt" style={{ color: 'var(--amber)' }}>{fmt(s.reserve)}</td>
                    <td className="amt" style={{ color: 'var(--mint)' }}>{fmt(s.payable)}</td>
                    <td>
                      <span className={`pill ${s.reconciliation.status === 'matched' ? 'ok' : 'no'}`}>
                        {s.reconciliation.status === 'matched' ? 'Matched' : 'Variance'}
                      </span>
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
