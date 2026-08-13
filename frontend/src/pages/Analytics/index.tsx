import { useState, useMemo, useRef, useCallback } from 'react';
import { useAppStore } from '../../store/appStore';
import { useCan, useActiveWorkspace } from '../../hooks/usePermission';
import { currentIdentity } from '../../rbac/permissions';
import { rateCard } from '../../business/rateCard';
import {
  genAnalyticsData,
  buildAgencyPayload,
  buildPlatformPayload,
  type AnalyticsData,
  type AgencyPayload,
  type PlatformPayload,
} from '../../demo/analyticsEngine';
import { toast } from '../../components/Toast';

const DAY = 86400000;
const now = Date.now();

const fmt = (n: number) => {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR' }).format(n); }
  catch { return 'EUR ' + n.toFixed(2); }
};
const pct1 = (v: number) => (+v).toFixed(1) + '%';
const pct2 = (v: number) => (+v).toFixed(2) + '%';

function diStr(ts: number): string {
  const d = new Date(ts);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// ---- Bar chart component ----
function BarChart({ buckets, days, metric }: { buckets: number[]; days: number; metric: string }) {
  const mx = Math.max(...buckets, 1);
  const [tip, setTip] = useState<{ i: number; v: number; left: number } | null>(null);
  const barsRef = useRef<HTMLDivElement>(null);

  return (
    <div className="chartwrap" style={{ position: 'relative' }}>
      <div className="bars" ref={barsRef} style={{ display: 'flex', alignItems: 'flex-end', gap: 2, minHeight: 160 }}>
        {buckets.map((v, i) => (
          <div
            key={i}
            className={`bar${tip?.i === i ? ' hi' : ''}`}
            style={{
              height: Math.max(3, v / mx * 140),
              flex: 1,
              background: 'var(--brand)',
              borderRadius: '3px 3px 0 0',
              cursor: 'crosshair',
              transition: 'height .2s ease',
              position: 'relative',
            }}
            onMouseEnter={e => {
              const rect = (e.target as HTMLElement).getBoundingClientRect();
              const parentRect = barsRef.current?.getBoundingClientRect();
              setTip({ i, v, left: rect.left - (parentRect?.left || 0) });
            }}
            onMouseLeave={() => setTip(null)}
          >
            {i % Math.ceil(days / 10) === 0 && (
              <span style={{ position: 'absolute', bottom: -20, left: '50%', transform: 'translateX(-50%)', fontSize: '10.5px', color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                {i + 1}
              </span>
            )}
          </div>
        ))}
      </div>
      {tip && (
        <div className="chart-tip" style={{
          position: 'absolute', bottom: '100%', left: tip.left, transform: 'translateX(-50%)',
          background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 8,
          padding: '4px 10px', fontSize: '12px', whiteSpace: 'nowrap', pointerEvents: 'none',
          marginBottom: 4, zIndex: 5,
        }}>
          Day {tip.i + 1}: {fmt(tip.v)} ({metric})
        </div>
      )}
    </div>
  );
}

// ---- Metric row component (reused for waterfall, concentration, etc.) ----
function MetricRow({ label, value, pct, color }: { label: string; value: string; pct: number; color: string }) {
  return (
    <div className="metric-row" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0' }}>
      <span className="ml" style={{ minWidth: 140, fontSize: '13.6px', color: 'var(--muted)' }}>{label}</span>
      <span className="mt" style={{ flex: 1, height: 8, background: 'var(--ink)', borderRadius: 4, overflow: 'hidden' }}>
        <span style={{ display: 'block', width: `${Math.min(100, pct)}%`, height: '100%', background: color, borderRadius: 4 }} />
      </span>
      <span className="mv" style={{ minWidth: 100, textAlign: 'right', fontSize: '13.6px' }}>{value}</span>
    </div>
  );
}

// ---- Heatmap component ----
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function Heatmap({ grid }: { grid: number[][] }) {
  const hmax = Math.max(...grid.flat(), 1);
  return (
    <div className="heat" style={{
      display: 'grid',
      gridTemplateColumns: '40px repeat(24, 1fr)',
      gap: 2,
      fontSize: '11px',
    }}>
      <div />
      {[...Array(24)].map((_, H) => (
        <div key={H} className="hh" style={{ textAlign: 'center', color: 'var(--muted)', fontSize: '10px' }}>
          {H % 3 === 0 ? H : ''}
        </div>
      ))}
      {grid.map((row, r) => (
        <React.Fragment key={r}>
          <div className="hl" style={{ display: 'flex', alignItems: 'center', fontSize: '11px', color: 'var(--muted)' }}>{DOW[r]}</div>
          {row.map((v, h) => {
            const a = v / hmax;
            const bg = v === 0 ? 'var(--ink)' : `rgba(21,195,175,${(0.12 + a * 0.85).toFixed(2)})`;
            return (
              <div key={h} className="hc" title={fmt(v)} style={{
                background: bg, borderRadius: 3, aspectRatio: '1', minHeight: 14,
              }} />
            );
          })}
        </React.Fragment>
      ))}
    </div>
  );
}

// ---- CSV export ----
function csvCell(v: unknown): string {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function downloadCSV(text: string, name: string) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---- Need React import for fragments ----
import React from 'react';

export default function AnalyticsPage() {
  const can = useCan();
  const role = useAppStore(s => s.role);
  const mode = useAppStore(s => s.mode);
  const identity = useAppStore(s => s.identity);
  const creators = useAppStore(s => s.creators);
  const chatters = useAppStore(s => s.chatters);
  const customers = useAppStore(s => s.customers);
  const workspaces = useAppStore(s => s.workspaces);
  const commission = useAppStore(s => s.commission);
  const fees = useAppStore(s => s.fees);
  const ws = useActiveWorkspace();

  const isLive = mode === 'live';
  const rc = rateCard(ws, fees, isLive);
  const isPlatform = can('platform.view');

  const idn = currentIdentity(role, identity);

  // Filters
  const [anFrom, setAnFrom] = useState(diStr(now - 30 * DAY));
  const [anTo, setAnTo] = useState(diStr(now));
  const [creatorFilter, setCreatorFilter] = useState('');
  const [chatterFilter, setChatterFilter] = useState('');
  const [anMetric, setAnMetric] = useState<'gross' | 'net'>('gross');

  // Generate analytics data once (memoized on stable deps)
  const analyticsRef = useRef<AnalyticsData | null>(null);
  const getAnalytics = useCallback(() => {
    if (!analyticsRef.current) {
      analyticsRef.current = genAnalyticsData(creators, chatters, customers, workspaces);
    }
    return analyticsRef.current;
  }, [creators, chatters, customers, workspaces]);

  // Compute window
  const fromMs = useMemo(() => {
    if (!anFrom) return now - 95 * DAY;
    const a = anFrom.split('-').map(Number);
    return new Date(a[0], a[1] - 1, a[2]).getTime();
  }, [anFrom]);

  const toMs = useMemo(() => {
    if (!anTo) return now;
    const a = anTo.split('-').map(Number);
    return new Date(a[0], a[1] - 1, a[2], 23, 59, 59).getTime();
  }, [anTo]);

  const days = Math.max(1, Math.min(120, Math.round((toMs - fromMs) / DAY)));

  // Build payload
  const agencyPayload = useMemo<AgencyPayload | null>(() => {
    if (isPlatform) return null;
    const analytics = getAnalytics();
    return buildAgencyPayload(
      analytics, ws?.name || '', fromMs, toMs,
      creators, chatters, customers, commission,
      idn, creatorFilter, chatterFilter, rc.blended,
    );
  }, [isPlatform, getAnalytics, ws?.name, fromMs, toMs, creators, chatters, customers, commission, idn, creatorFilter, chatterFilter, rc.blended]);

  const platformPayload = useMemo<PlatformPayload | null>(() => {
    if (!isPlatform) return null;
    const analytics = getAnalytics();
    return buildPlatformPayload(analytics, fromMs, toMs, creators, chatters, commission);
  }, [isPlatform, getAnalytics, fromMs, toMs, creators, chatters, commission]);

  // Compute bar chart buckets from timeseries
  const agencyBuckets = useMemo(() => {
    if (!agencyPayload) return [];
    const b = [...Array(days)].map(() => 0);
    (agencyPayload.timeseries || []).forEach(pt => {
      const ms = new Date(pt.d + 'T12:00:00').getTime();
      const off = Math.floor((toMs - ms) / DAY);
      if (off >= 0 && off < days) {
        b[days - 1 - off] += anMetric === 'net' ? pt.net : pt.gross;
      }
    });
    return b;
  }, [agencyPayload, days, toMs, anMetric]);

  const platformBuckets = useMemo(() => {
    if (!platformPayload) return [];
    const b = [...Array(days)].map(() => 0);
    (platformPayload.timeseries || []).forEach(pt => {
      const ms = new Date(pt.d + 'T12:00:00').getTime();
      const off = Math.floor((toMs - ms) / DAY);
      if (off >= 0 && off < days) b[days - 1 - off] += pt.gross;
    });
    return b;
  }, [platformPayload, days, toMs]);

  // Trend line
  const trendText = useMemo(() => {
    if (!agencyBuckets.length) return '';
    const avg = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
    const a7 = avg(agencyBuckets.slice(-7));
    const a30 = avg(agencyBuckets.slice(-30));

    // prev period comparison
    const analytics = getAnalytics();
    const span = toMs - fromMs;
    const prevSales = analytics.sales.filter(s =>
      s.agency === (ws?.name || '') &&
      (!idn || (idn.field === 'chatter' ? s.chatter : s.creator) === idn.name) &&
      s.ts >= fromMs - span && s.ts < fromMs,
    );
    const prevGross = prevSales.reduce((acc, s) => acc + s.amount, 0);
    const curGross = agencyPayload?.headline.gross || 0;
    const growth = prevGross ? ((curGross - prevGross) / prevGross * 100) : 0;

    return `7-day avg ${fmt(a7)}/day · 30-day avg ${fmt(a30)}/day · vs previous period ${growth >= 0 ? '▲' : '▼'} ${Math.abs(growth).toFixed(0)}%`;
  }, [agencyBuckets, getAnalytics, ws?.name, idn, fromMs, toMs, agencyPayload]);

  // Quick date shortcuts
  const setRange = (d: number) => {
    setAnTo(diStr(now));
    setAnFrom(d > 0 ? diStr(now - d * DAY) : diStr(now - 95 * DAY));
  };

  // Subtitle
  const subtitle = isPlatform
    ? 'Across every agency workspace.'
    : (idn
      ? `Your ${idn.field === 'chatter' ? 'chatter' : 'creator'} performance · ${ws?.name || ''}`
      : ws?.name || '');

  // Export CSV
  const exportCSV = () => {
    if (!agencyPayload) { toast('Nothing to export yet.'); return; }
    const p = agencyPayload;
    const rows: string[] = [];
    const push = (...a: unknown[]) => rows.push(a.map(csvCell).join(','));
    push('HigherPays analytics export');
    push('Workspace', ws?.name || '');
    push('Range', diStr(fromMs), 'to', diStr(toMs));
    push('Generated', new Date().toISOString());
    push('');
    push('SUMMARY'); push('Metric', 'Value');
    const H = p.headline, C = p.chargebacks;
    [['Gross', H.gross], ['Net', H.net], ['Take rate %', H.takeRatePct], ['AOV', H.aov],
      ['Paid sales', H.paidCount], ['Unique buyers', H.uniqueBuyers], ['Platform fee', H.platformFee],
      ['Creator payout', H.creatorPayout], ['Chatter payout', H.chatterPayout],
      ['Agency keep', H.agencyKeep], ['Chargeback rate %', C.ratePct],
    ].forEach(r => push(r[0], r[1]));
    push('');
    push('REVENUE OVER TIME'); push('Date', 'Gross', 'Net');
    (p.timeseries || []).forEach(t => push(t.d, t.gross, t.net));
    push('');
    push('CHATTER LEADERBOARD'); push('Chatter', 'Revenue', 'Sales', 'Conversion %', 'AOV');
    (p.chatters || []).forEach(c => push(c.name, c.revenue, c.sales, c.conversionPct, c.aov));
    push('');
    push('CREATOR PERFORMANCE'); push('Creator', 'Model', 'Revenue', 'Creator payout', 'Agency profit');
    (p.creators || []).forEach(c => push(c.name, c.model, c.revenue, c.creatorPayout, c.agencyProfit));
    downloadCSV(rows.join('\n'), 'higherpays-analytics-' + diStr(Date.now()) + '.csv');
    toast('Analytics exported to CSV.');
  };

  // ======================== RENDER ========================

  return (
    <div>
      {/* Header */}
      <div className="pagehead">
        <div>
          <h2>{isPlatform ? 'Platform Analytics' : 'Analytics'}</h2>
          <p>{subtitle}</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="field" style={{ minWidth: 0 }}><label>From</label><input type="date" value={anFrom} onChange={e => setAnFrom(e.target.value)} /></div>
          <div className="field" style={{ minWidth: 0 }}><label>To</label><input type="date" value={anTo} onChange={e => setAnTo(e.target.value)} /></div>
          <div style={{ display: 'flex', gap: 6 }}>
            {[{ d: 14, l: '14d' }, { d: 30, l: '30d' }, { d: 90, l: '90d' }, { d: 0, l: 'All' }].map(b => (
              <button key={b.d} className="btn ghost" style={{ padding: '7px 11px' }} onClick={() => setRange(b.d)}>{b.l}</button>
            ))}
          </div>
          {!isPlatform && (
            <>
              <select value={creatorFilter} onChange={e => setCreatorFilter(e.target.value)}>
                <option value="">All creators</option>
                {creators.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
              </select>
              <select value={chatterFilter} onChange={e => setChatterFilter(e.target.value)}>
                <option value="">All chatters</option>
                {chatters.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
              </select>
              <button className="btn ghost" style={{ padding: '7px 12px' }} onClick={exportCSV} title="Export analytics as CSV">Export CSV</button>
            </>
          )}
        </div>
      </div>

      {/* =================== PLATFORM VIEW =================== */}
      {isPlatform && platformPayload && (
        <>
          <div className="stats">
            <div className="card stat"><div className="lbl">Total volume</div><div className="val">{fmt(platformPayload.totalVolume)}</div><div className="sub">{platformPayload.activeAgencies} agencies</div></div>
            <div className="card stat"><div className="lbl">HigherPays margin</div><div className="val" style={{ color: 'var(--mint)' }}>{fmt(platformPayload.hpMargin)}</div><div className="sub up">operator revenue</div></div>
            <div className="card stat"><div className="lbl">Active agencies</div><div className="val">{platformPayload.activeAgencies}</div><div className="sub">with volume</div></div>
            <div className="card stat"><div className="lbl">Avg blended</div><div className="val">{pct1(platformPayload.avgBlended)}</div><div className="sub">PSP + margin</div></div>
            <div className="card stat"><div className="lbl">Net to agencies</div><div className="val">{fmt(platformPayload.netToAgencies)}</div><div className="sub">after platform fee</div></div>
            <div className="card stat"><div className="lbl">Platform CB rate</div><div className="val">{pct2(platformPayload.cbRatePct)}</div><div className="sub">by count</div></div>
          </div>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="sechead" style={{ marginTop: 0 }}>Platform revenue over time</div>
            <BarChart buckets={platformBuckets} days={days} metric="gross" />
          </div>
          <div className="card">
            <div className="sechead" style={{ marginTop: 0 }}>Per-agency breakdown</div>
            <div className="tablewrap" style={{ border: 'none' }}>
              <table>
                <thead><tr><th>Agency</th><th>Volume</th><th>Blended</th><th>HP margin</th><th>Sales</th><th>CB rate</th></tr></thead>
                <tbody>
                  {platformPayload.agencies.length > 0 ? platformPayload.agencies.map(a => (
                    <tr key={a.agency}>
                      <td className="cname">{a.agency}</td>
                      <td className="amt">{fmt(a.volume)}</td>
                      <td>{a.blended}%</td>
                      <td className="amt" style={{ color: 'var(--mint)' }}>{fmt(a.hpMargin)}</td>
                      <td>{a.sales}</td>
                      <td>{a.cbRatePct}%</td>
                    </tr>
                  )) : (
                    <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: 'var(--muted)' }}>No agency activity in range.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* =================== AGENCY VIEW =================== */}
      {!isPlatform && agencyPayload && (() => {
        const H = agencyPayload.headline;
        const C = agencyPayload.chargebacks;
        const F = agencyPayload.funnel;
        const CU = agencyPayload.customers;

        // Waterfall segments
        const base = (H.platformFee + H.creatorPayout + H.chatterPayout + H.agencyKeep) || 1;
        const wfSegs: [string, number, string][] = [
          ['Platform fee', H.platformFee, '#7C8AA5'],
          ['Creator', H.creatorPayout, '#15C3AF'],
          ['Chatter', H.chatterPayout, '#4ADE9E'],
          ['Agency', H.agencyKeep, '#F5C451'],
        ];

        // Top spenders
        const spenders = [...customers]
          .filter(c =>
            (!creatorFilter || c.creator === creatorFilter) &&
            (!chatterFilter || c.chatter === chatterFilter) &&
            (!idn || c[idn.field as keyof typeof c] === idn.name),
          )
          .sort((a, b) => b.spend - a.spend)
          .slice(0, 5);

        // Segment revenue max
        const segMax = Math.max(...CU.segments.map(s => s.revenue), 1);
        const nrTot = (CU.newVsReturning.newRev + CU.newVsReturning.retRev) || 1;
        const cbBt = (C.byBearer.creator + C.byBearer.agency) || 1;

        return (
          <>
            {/* Stat cards */}
            <div className="stats">
              <div className="card stat"><div className="lbl">Gross volume</div><div className="val">{fmt(H.gross)}</div><div className="sub up">{H.paidCount} paid sales · {days}d</div></div>
              <div className="card stat"><div className="lbl">Net (distributable)</div><div className="val">{fmt(H.net)}</div><div className="sub">after {rc.blended}% fee</div></div>
              <div className="card stat"><div className="lbl">Effective take rate</div><div className="val">{pct1(H.takeRatePct)}</div><div className="sub">agency keep ÷ gross</div></div>
              <div className="card stat"><div className="lbl">Avg order value</div><div className="val">{fmt(H.aov)}</div><div className="sub">per paid sale</div></div>
              <div className="card stat"><div className="lbl">Chargeback rate</div><div className="val">{pct1(C.ratePct)}</div><div className="sub">by count</div></div>
              <div className="card stat"><div className="lbl">Unique buyers</div><div className="val">{H.uniqueBuyers}</div><div className="sub">paying fans in range</div></div>
            </div>

            {/* Revenue chart */}
            <div className="card" style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, flexWrap: 'wrap', gap: 8 }}>
                <div className="sechead" style={{ margin: 0 }}>Revenue over time</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {(['gross', 'net'] as const).map(m => (
                    <button key={m} className={`btn ghost tgl${anMetric === m ? ' active' : ''}`} style={{ padding: '5px 11px' }} onClick={() => setAnMetric(m)}>
                      {m === 'gross' ? 'Gross' : 'Net'}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ fontSize: '13.2px', color: 'var(--muted)', marginBottom: 10 }}>{trendText}</div>
              <BarChart buckets={agencyBuckets} days={days} metric={anMetric} />
            </div>

            {/* Waterfall + Funnel */}
            <div className="grid2" style={{ marginBottom: 16 }}>
              <div className="card">
                <div className="sechead" style={{ marginTop: 0 }}>Where the money goes</div>
                {/* Waterfall bar */}
                <div style={{ display: 'flex', height: 18, borderRadius: 6, overflow: 'hidden', marginBottom: 14 }}>
                  {wfSegs.map(([, v, c]) => (
                    <span key={c} style={{ width: `${v / base * 100}%`, background: c }} />
                  ))}
                </div>
                {wfSegs.map(([n, v, c]) => (
                  <MetricRow key={n} label={n} value={`${fmt(v)} · ${Math.round(v / base * 100)}%`} pct={v / base * 100} color={c} />
                ))}
              </div>
              <div className="card">
                <div className="sechead" style={{ marginTop: 0 }}>Link funnel</div>
                <div style={{ marginBottom: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                    <span style={{ minWidth: 60, fontSize: '13.6px', color: 'var(--muted)' }}>Created</span>
                    <div style={{ flex: 1, height: 28, background: 'var(--brand)', borderRadius: 6, display: 'flex', alignItems: 'center', paddingLeft: 10, fontSize: '13.6px' }}>
                      {F.created}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ minWidth: 60, fontSize: '13.6px', color: 'var(--muted)' }}>Paid</span>
                    <div style={{ width: `${Math.max(12, F.conversionPct)}%`, height: 28, background: 'var(--mint)', borderRadius: 6, display: 'flex', alignItems: 'center', paddingLeft: 10, fontSize: '13.6px' }}>
                      {F.paid} · {F.conversionPct}%
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: '13.2px', color: 'var(--muted)' }}>
                  <span>Conversion <b style={{ color: 'var(--text)' }}>{F.conversionPct}%</b></span>
                  <span>Declined <b style={{ color: 'var(--text)' }}>{F.declinePct}%</b></span>
                  <span>Expired <b style={{ color: 'var(--text)' }}>{F.expiryPct}%</b></span>
                  <span>Revenue / link <b style={{ color: 'var(--text)' }}>{fmt(F.revenuePerLink)}</b></span>
                </div>
              </div>
            </div>

            {/* Chatter leaderboard */}
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="sechead" style={{ marginTop: 0 }}>Chatter leaderboard</div>
              <div className="tablewrap" style={{ border: 'none' }}>
                <table>
                  <thead><tr><th>#</th><th>Chatter</th><th>Revenue</th><th>Sales</th><th>Conversion</th><th>Avg order</th></tr></thead>
                  <tbody>
                    {agencyPayload.chatters.length > 0 ? agencyPayload.chatters.map((r, i) => (
                      <tr key={r.name}>
                        <td style={{ color: 'var(--muted)', fontWeight: 700 }}>{i + 1}</td>
                        <td className="cname">{r.name}</td>
                        <td className="amt">{fmt(r.revenue)}</td>
                        <td>{r.sales}</td>
                        <td>{r.conversionPct}%</td>
                        <td>{fmt(r.aov)}</td>
                      </tr>
                    )) : (
                      <tr><td colSpan={6} style={{ padding: 30, textAlign: 'center', color: 'var(--muted)' }}>No sales in range.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Creator performance */}
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="sechead" style={{ marginTop: 0 }}>Creator performance &amp; profitability</div>
              <div className="tablewrap" style={{ border: 'none' }}>
                <table>
                  <thead><tr><th>Creator</th><th>Model</th><th>Revenue</th><th>Creator payout</th><th>Agency profit</th><th>Note</th></tr></thead>
                  <tbody>
                    {agencyPayload.creators.length > 0 ? agencyPayload.creators.map(c => {
                      let note = '';
                      if (c.model === 'salary') {
                        const monthly = c.revenue * (30 / days);
                        note = `salary ${fmt(c.salary)}/mo vs ${fmt(monthly)} gen.`;
                      } else if (c.model === 'ai') {
                        note = 'AI — no creator payout';
                      } else {
                        const cr = creators.find(x => x.name === c.name);
                        note = `rev-share ${cr?.splitCreator || 70}%`;
                      }
                      return (
                        <tr key={c.name}>
                          <td className="cname">{c.name}</td>
                          <td><span className="seg">{c.model}</span></td>
                          <td className="amt">{fmt(c.revenue)}</td>
                          <td className="amt">{fmt(c.creatorPayout)}</td>
                          <td className="amt" style={{ color: 'var(--mint)' }}>{fmt(c.agencyProfit)}</td>
                          <td style={{ color: 'var(--muted)', fontSize: '13.2px' }}>{note}</td>
                        </tr>
                      );
                    }) : (
                      <tr><td colSpan={6} style={{ padding: 30, textAlign: 'center', color: 'var(--muted)' }}>No data.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Customer value + Top spenders */}
            <div className="grid2" style={{ marginBottom: 16 }}>
              <div className="card">
                <div className="sechead" style={{ marginTop: 0 }}>Customer value</div>
                <div className="stats" style={{ marginBottom: 14 }}>
                  <div className="card stat"><div className="lbl">Avg LTV</div><div className="val">{fmt(CU.avgLtv)}</div></div>
                  <div className="card stat"><div className="lbl">ARPU</div><div className="val">{fmt(CU.arpu)}</div></div>
                  <div className="card stat"><div className="lbl">Repeat rate</div><div className="val">{CU.repeatRatePct}%</div></div>
                  <div className="card stat"><div className="lbl">Buys / fan</div><div className="val">{CU.freq}</div></div>
                </div>
                <div className="sechead">Revenue concentration (whales)</div>
                <MetricRow label="Top 1% of fans" value={`${CU.concentration.top1}% of rev`} pct={CU.concentration.top1} color="var(--brand)" />
                <MetricRow label="Top 5% of fans" value={`${CU.concentration.top5}% of rev`} pct={CU.concentration.top5} color="var(--brand)" />
                <MetricRow label="Top 10% of fans" value={`${CU.concentration.top10}% of rev`} pct={CU.concentration.top10} color="var(--brand)" />
              </div>
              <div className="card">
                <div className="sechead" style={{ marginTop: 0 }}>Top spenders (whales)</div>
                {spenders.length > 0 ? spenders.map((c, i) => (
                  <div key={c.id} className="rankrow" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 0', borderBottom: '1px solid rgba(30,43,68,.3)' }}>
                    <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--panel-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '13px', color: 'var(--muted)' }}>{i + 1}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: '14.3px' }}>{c.username}</div>
                      <div style={{ fontSize: '12.5px', color: 'var(--muted)' }}>{c.name} · {c.purchases} buys</div>
                    </div>
                    <div style={{ fontWeight: 600, fontSize: '14.3px' }}>{fmt(c.spend)}</div>
                  </div>
                )) : (
                  <div style={{ color: 'var(--muted)', fontSize: '14.3px' }}>No customers.</div>
                )}
              </div>
            </div>

            {/* Segment revenue + New vs returning */}
            <div className="grid2" style={{ marginBottom: 16 }}>
              <div className="card">
                <div className="sechead" style={{ marginTop: 0 }}>Revenue by segment</div>
                {CU.segments.length > 0 ? CU.segments.map(s => (
                  <MetricRow key={s.segment} label={s.segment} value={fmt(s.revenue)} pct={s.revenue / segMax * 100} color="var(--brand)" />
                )) : (
                  <div style={{ color: 'var(--muted)', fontSize: '14.3px' }}>No data.</div>
                )}
              </div>
              <div className="card">
                <div className="sechead" style={{ marginTop: 0 }}>New vs returning revenue</div>
                <MetricRow label="New customers" value={`${fmt(CU.newVsReturning.newRev)} · ${Math.round(CU.newVsReturning.newRev / nrTot * 100)}%`} pct={CU.newVsReturning.newRev / nrTot * 100} color="var(--mint)" />
                <MetricRow label="Returning" value={`${fmt(CU.newVsReturning.retRev)} · ${Math.round(CU.newVsReturning.retRev / nrTot * 100)}%`} pct={CU.newVsReturning.retRev / nrTot * 100} color="var(--brand)" />
              </div>
            </div>

            {/* Chargeback risk */}
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="sechead" style={{ marginTop: 0 }}>Chargeback risk</div>
              {C.ratePct > 1 && (
                <div className="warnbar">⚠ Chargeback rate is {C.ratePct}% — above the ~1% threshold card networks monitor. Watch closely to protect the merchant account.</div>
              )}
              <div className="stats" style={{ marginBottom: 14 }}>
                <div className="card stat"><div className="lbl">CB rate (count)</div><div className="val">{pct2(C.ratePct)}</div></div>
                <div className="card stat"><div className="lbl">CB rate (value)</div><div className="val">{pct2(C.rateValuePct)}</div></div>
                <div className="card stat"><div className="lbl">CB cost (fees)</div><div className="val">{fmt(C.feeCost)}</div></div>
                <div className="card stat"><div className="lbl">Reversed value</div><div className="val">{fmt(C.valueReversed)}</div></div>
              </div>
              <div className="sechead">Who absorbs the loss</div>
              <MetricRow label="Creators (rev-share)" value={fmt(C.byBearer.creator)} pct={C.byBearer.creator / cbBt * 100} color="var(--amber)" />
              <MetricRow label="Agency (salary/AI)" value={fmt(C.byBearer.agency)} pct={C.byBearer.agency / cbBt * 100} color="var(--red)" />
            </div>

            {/* Heatmap */}
            <div className="card">
              <div className="sechead" style={{ marginTop: 0 }}>When fans buy — day × hour</div>
              <div className="tablewrap" style={{ border: 'none' }}>
                <Heatmap grid={agencyPayload.heatmap} />
              </div>
            </div>
          </>
        );
      })()}
    </div>
  );
}
