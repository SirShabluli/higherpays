import { useState, useMemo, useRef, useCallback } from 'react';
import { useAppStore } from '../../store/appStore';
import { useCan, useActiveWorkspace } from '../../hooks/usePermission';
import { currentIdentity } from '../../rbac/permissions';
import { genAnalyticsData, type AnalyticsData } from '../../demo/analyticsEngine';
import { startOfDayTZ, startOfWeekTZ, startOfMonthTZ, startOfQuarterTZ, detectedTZ } from '../../business/timezone';
import { toast } from '../../components/Toast';
import type { GoalTarget } from '../../types';

const now = Date.now();
const _sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

const fmt = (n: number) => {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR' }).format(n); }
  catch { return 'EUR ' + n.toFixed(2); }
};

const GOAL_METRICS = [
  { k: 'gross', label: 'Revenue' },
  { k: 'sales', label: 'Sales' },
  { k: 'conversion', label: 'Conversion' },
  { k: 'aov', label: 'Avg order' },
  { k: 'buyers', label: 'Buyers' },
];

function fmtMetric(k: string, v: number): string {
  if (k === 'conversion' || k === 'takeRate') return (+v || 0).toFixed(1) + '%';
  if (k === 'sales' || k === 'buyers') return Math.round(v || 0).toLocaleString();
  return fmt(v || 0);
}

function diStr(ts: number): string {
  const d = new Date(ts);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function fmtD(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

type Period = 'day' | 'week' | 'month' | 'quarter';
const PERIOD_LABELS: Record<Period, string> = { day: 'Daily', week: 'Weekly', month: 'Monthly', quarter: 'Quarterly' };

interface LeaderboardRow {
  membershipId: string;
  name: string;
  actuals: Record<string, number>;
  targets: Record<string, number>;
}

export default function GoalsPage() {
  const can = useCan();
  const role = useAppStore(s => s.role);
  const idOverride = useAppStore(s => s.identity);
  const creators = useAppStore(s => s.creators);
  const chatters = useAppStore(s => s.chatters);
  const customers = useAppStore(s => s.customers);
  const workspaces = useAppStore(s => s.workspaces);
  const targets = useAppStore(s => s.targets) || [];
  const updateState = useAppStore(s => s.updateState);
  const ws = useActiveWorkspace();
  const tz = detectedTZ();

  const idn = currentIdentity(role, idOverride);
  const admin = can('team.manage');

  // Filters
  const [period, setPeriod] = useState<Period>('month');
  const [metric, setMetric] = useState('gross');
  const [goalFrom, setGoalFrom] = useState('');
  const [goalTo, setGoalTo] = useState('');

  // Goal input state
  const [goalInputs, setGoalInputs] = useState<Record<string, string>>({});

  // Analytics data (lazy)
  const analyticsRef = useRef<AnalyticsData | null>(null);
  const getAnalytics = useCallback(() => {
    if (!analyticsRef.current) {
      analyticsRef.current = genAnalyticsData(creators, chatters, customers, workspaces);
    }
    return analyticsRef.current;
  }, [creators, chatters, customers, workspaces]);

  // Period defaults
  const periodDefault = (p: Period): [number, number] => {
    if (p === 'day') return [startOfDayTZ(now, tz), now];
    if (p === 'week') return [startOfWeekTZ(now, tz), now];
    if (p === 'quarter') return [startOfQuarterTZ(now, tz), now];
    return [startOfMonthTZ(now, tz), now];
  };

  // Compute window
  const [fromMs, toMs] = useMemo(() => {
    const def = periodDefault(period);
    const from = goalFrom
      ? new Date(goalFrom + 'T00:00:00').getTime()
      : def[0];
    const to = goalTo
      ? new Date(goalTo + 'T23:59:59').getTime()
      : def[1];
    return [Math.min(from, to), Math.max(from, to)];
  }, [goalFrom, goalTo, period, tz]);

  // Demo leaderboard builder
  const demoTargetsFor = useCallback((name: string | null, p: string): Record<string, number> => {
    const o: Record<string, number> = {};
    targets.forEach(t => {
      if ((t.memberName || null) === (name || null) && t.period === p) {
        o[t.metric] = t.targetValue;
      }
    });
    return o;
  }, [targets]);

  const leaderboardData = useMemo(() => {
    const analytics = getAnalytics();
    const agency = ws?.name || '';
    const f = (x: { agency: string; ts: number }) => x.agency === agency && x.ts >= fromMs && x.ts <= toMs;
    const sales = analytics.sales.filter(f);
    const declines = analytics.declines.filter(f);
    const expired = analytics.expired.filter(f);

    const rows: LeaderboardRow[] = chatters.map(c => {
      const ms = sales.filter(s => s.chatter === c.name);
      const created = ms.length + declines.filter(d => d.chatter === c.name).length + expired.filter(e => e.chatter === c.name).length;
      const gross = _sum(ms.map(s => s.amount));
      const salesN = ms.length;
      const buyers = new Set(ms.map(s => s.custId)).size;
      return {
        membershipId: c.name,
        name: c.name,
        actuals: {
          gross,
          sales: salesN,
          buyers,
          aov: salesN ? gross / salesN : 0,
          conversion: created ? +(salesN / created * 100).toFixed(1) : 0,
        },
        targets: demoTargetsFor(c.name, period),
      };
    }).sort((a, b) => b.actuals.gross - a.actuals.gross);

    return { rows, workspaceTargets: demoTargetsFor(null, period) };
  }, [getAnalytics, ws?.name, fromMs, toMs, chatters, period, demoTargetsFor]);

  const { rows, workspaceTargets } = leaderboardData;
  const mdef = GOAL_METRICS.find(m => m.k === metric) || GOAL_METRICS[0];
  const pl = `${PERIOD_LABELS[period]} · ${fmtD(fromMs)} – ${fmtD(toMs)}`;
  const max = Math.max(...rows.map(r => r.actuals[metric] || 0), 1);

  // Medal icons
  const medal = (i: number) => i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`;

  // Period change handler
  const handlePeriod = (p: Period) => {
    setPeriod(p);
    const [f, t] = periodDefault(p);
    setGoalFrom(diStr(f));
    setGoalTo(diStr(t));
  };

  // Save goals
  const saveGoals = () => {
    const updates: { memberName: string | null; value: number }[] = [];
    Object.entries(goalInputs).forEach(([key, val]) => {
      if (val.trim() === '') return;
      const name = key === '__workspace__' ? null : key;
      updates.push({ memberName: name, value: +val });
    });
    if (updates.length === 0) { toast('No goals to save.'); return; }

    const newTargets: GoalTarget[] = [...targets];
    updates.forEach(u => {
      const ex = newTargets.find(t =>
        (t.memberName || null) === (u.memberName || null) &&
        t.metric === metric && t.period === period,
      );
      if (ex) {
        ex.targetValue = u.value;
      } else {
        newTargets.push({
          memberName: u.memberName || '',
          metric,
          targetValue: u.value,
          period,
        });
      }
    });
    updateState({ targets: newTargets });
    toast('Goals saved (demo).');
  };

  // Initialize goal inputs when data changes
  const inputsKey = `${metric}:${period}:${rows.length}`;
  const prevInputsKey = useRef('');
  if (prevInputsKey.current !== inputsKey) {
    prevInputsKey.current = inputsKey;
    const newInputs: Record<string, string> = {};
    rows.forEach(r => {
      const t = r.targets[metric];
      newInputs[r.name] = t ? String(t) : '';
    });
    newInputs['__workspace__'] = workspaceTargets[metric] ? String(workspaceTargets[metric]) : '';
    if (Object.keys(goalInputs).length === 0 || true) {
      // Always reset when key changes
      setGoalInputs(newInputs);
    }
  }

  // "Your goals" for chatter identity
  const me = (idn && idn.field === 'chatter') ? rows.find(r => r.name === idn.name) : null;

  return (
    <div>
      <div className="pagehead">
        <div>
          <h2>Team Goals</h2>
          <p>{admin ? 'Set KPI targets for your team and track the live leaderboard.' : 'Your KPI targets and how the team is tracking.'}</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <select value={metric} onChange={e => setMetric(e.target.value)}>
            {GOAL_METRICS.map(m => <option key={m.k} value={m.k}>{m.label}</option>)}
          </select>
          <div style={{ display: 'flex', gap: 6 }}>
            {(['day', 'week', 'month', 'quarter'] as const).map(p => (
              <button key={p} className={`btn ghost tgl${period === p ? ' active' : ''}`} style={{ padding: '7px 12px' }} onClick={() => handlePeriod(p)}>
                {PERIOD_LABELS[p].replace(/ly$/, '')}
              </button>
            ))}
          </div>
          <div className="field" style={{ minWidth: 0 }}><label>From</label><input type="date" value={goalFrom} onChange={e => setGoalFrom(e.target.value)} /></div>
          <div className="field" style={{ minWidth: 0 }}><label>To</label><input type="date" value={goalTo} onChange={e => setGoalTo(e.target.value)} /></div>
        </div>
      </div>

      {/* Your goals (for chatter identity) */}
      {me && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="sechead" style={{ marginTop: 0 }}>Your goals · {pl}</div>
          {GOAL_METRICS.map(m => {
            const a = me.actuals[m.k] || 0;
            const t = (me.targets[m.k]) || workspaceTargets[m.k] || 0;
            const pct = t ? Math.min(100, Math.round(a / t * 100)) : 0;
            return (
              <div key={m.k} className="metric-row" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0' }}>
                <span style={{ minWidth: 100, fontSize: '13.6px', color: 'var(--muted)' }}>{m.label}</span>
                <span style={{ flex: 1, height: 8, background: 'var(--ink)', borderRadius: 4, overflow: 'hidden' }}>
                  <span style={{ display: 'block', width: `${pct}%`, height: '100%', background: pct >= 100 ? 'var(--mint)' : 'var(--brand)', borderRadius: 4 }} />
                </span>
                <span style={{ minWidth: 140, textAlign: 'right', fontSize: '13.6px' }}>
                  {fmtMetric(m.k, a)}
                  {t ? ` / ${fmtMetric(m.k, t)}` : <span style={{ color: 'var(--muted)' }}> no goal</span>}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Leaderboard */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="sechead" style={{ marginTop: 0 }}>Leaderboard – {mdef.label} · {pl}</div>
        {rows.length > 0 ? rows.map((r, i) => {
          const actual = r.actuals[metric] || 0;
          const target = (r.targets[metric]) || workspaceTargets[metric] || 0;
          const pct = target ? Math.min(100, Math.round(actual / target * 100)) : null;
          const isMine = idn && idn.field === 'chatter' && r.name === idn.name;
          const w = target && pct != null ? pct : Math.round(actual / max * 100);
          return (
            <div key={r.name} style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0',
              borderBottom: '1px solid rgba(30,43,68,.3)',
              background: isMine ? 'rgba(21,195,175,.06)' : undefined,
              borderRadius: isMine ? 8 : undefined,
              paddingLeft: isMine ? 10 : undefined,
              paddingRight: isMine ? 10 : undefined,
            }}>
              <div style={{ width: 36, textAlign: 'center', fontSize: '16px' }}>{medal(i)}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: '14.3px', marginBottom: 4 }}>
                  {r.name}
                  {isMine && <span style={{ color: 'var(--brand)', fontSize: 12, marginLeft: 6 }}>you</span>}
                </div>
                <div style={{ height: 8, background: 'var(--ink)', borderRadius: 4, overflow: 'hidden' }}>
                  <span style={{
                    display: 'block',
                    width: `${w}%`,
                    height: '100%',
                    background: pct != null && pct >= 100 ? 'var(--mint)' : 'var(--brand)',
                    borderRadius: 4,
                    transition: 'width .3s ease',
                  }} />
                </div>
              </div>
              <div style={{ minWidth: 140, textAlign: 'right', fontSize: '14.3px' }}>
                {fmtMetric(metric, actual)}
                {target ? (
                  <span style={{ color: 'var(--muted)', fontSize: '12.5px' }}> / {fmtMetric(metric, target)} · {pct}%</span>
                ) : null}
              </div>
            </div>
          );
        }) : (
          <div style={{ color: 'var(--muted)' }}>No chatters yet.</div>
        )}
      </div>

      {/* Admin: set goals */}
      {admin && (
        <div className="card">
          <div className="sechead" style={{ marginTop: 0 }}>Set {mdef.label} goals ({pl})</div>
          <p className="sub" style={{ marginTop: 0 }}>A goal per chatter, or one workspace-wide goal applied to everyone without their own.</p>
          <div className="tablewrap" style={{ border: 'none' }}>
            <table>
              <thead><tr><th>Chatter</th><th>Current</th><th>{mdef.label} target</th></tr></thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.name}>
                    <td className="cname">{r.name}</td>
                    <td className="amt">{fmtMetric(metric, r.actuals[metric] || 0)}</td>
                    <td>
                      <input
                        type="number"
                        value={goalInputs[r.name] ?? ''}
                        onChange={e => setGoalInputs(prev => ({ ...prev, [r.name]: e.target.value }))}
                        placeholder="—"
                        style={{ width: 120 }}
                      />
                    </td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={2} style={{ textAlign: 'right', color: 'var(--muted)' }}>Workspace-wide goal</td>
                  <td>
                    <input
                      type="number"
                      value={goalInputs['__workspace__'] ?? ''}
                      onChange={e => setGoalInputs(prev => ({ ...prev, '__workspace__': e.target.value }))}
                      placeholder="—"
                      style={{ width: 120 }}
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div style={{ textAlign: 'right', marginTop: 12 }}>
            <button className="btn" onClick={saveGoals}>Save {mdef.label} goals</button>
          </div>
        </div>
      )}
    </div>
  );
}
