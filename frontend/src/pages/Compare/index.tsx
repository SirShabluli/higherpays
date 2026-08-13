import { useState, useMemo, useRef, useCallback } from 'react';
import { useAppStore } from '../../store/appStore';
import { useCan, useActiveWorkspace } from '../../hooks/usePermission';
import { splitSale } from '../../business/splitSale';
import { genAnalyticsData, type AnalyticsData } from '../../demo/analyticsEngine';
import { startOfMonthTZ, startOfWeekTZ, detectedTZ } from '../../business/timezone';
import { toast } from '../../components/Toast';

const DAY = 86400000;
const now = Date.now();
const _sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

const fmt = (n: number) => {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR' }).format(n); }
  catch { return 'EUR ' + n.toFixed(2); }
};

function fmtMetric(k: string, v: number): string {
  if (k === 'conversion' || k === 'takeRate') return (+v || 0).toFixed(1) + '%';
  if (k === 'sales' || k === 'buyers') return Math.round(v || 0).toLocaleString();
  return fmt(v || 0);
}

function diStr(ts: number): string {
  const d = new Date(ts);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

const CMP_METRICS_ALL = [
  { k: 'gross', label: 'Gross volume' },
  { k: 'net', label: 'Net' },
  { k: 'sales', label: 'Sales' },
  { k: 'aov', label: 'Avg order' },
  { k: 'conversion', label: 'Conversion' },
  { k: 'takeRate', label: 'Take rate' },
  { k: 'buyers', label: 'Unique buyers' },
  { k: 'hpMargin', label: 'HigherPays margin' },
];

const CMP_COLORS = ['#15C3AF', '#F5C451', '#4ADE9E', '#7C8AA5', '#06A185'];

const CMP_PRESETS = [
  { k: 'mom', label: 'Month over month' },
  { k: 'wow', label: 'Week over week' },
  { k: '7v7', label: 'Last 7d vs prev 7d' },
  { k: 'chatters', label: 'Chatters head-to-head' },
  { k: 'creators', label: 'Creators head-to-head' },
];

interface SeriesDef {
  label: string;
  entity: string;
  from: string;
  to: string;
}

export default function ComparePage() {
  const can = useCan();
  const creators = useAppStore(s => s.creators);
  const chatters = useAppStore(s => s.chatters);
  const customers = useAppStore(s => s.customers);
  const workspaces = useAppStore(s => s.workspaces);
  const commission = useAppStore(s => s.commission);
  const ws = useActiveWorkspace();
  const tz = detectedTZ();

  const cmpMetrics = CMP_METRICS_ALL.filter(m => m.k !== 'hpMargin' || can('platform.view'));

  const analyticsRef = useRef<AnalyticsData | null>(null);
  const getAnalytics = useCallback(() => {
    if (!analyticsRef.current) {
      analyticsRef.current = genAnalyticsData(creators, chatters, customers, workspaces);
    }
    return analyticsRef.current;
  }, [creators, chatters, customers, workspaces]);

  const defaultSeries = (): SeriesDef[] => [
    { label: 'Series A', entity: 'all', from: diStr(now - 30 * DAY), to: diStr(now) },
    { label: 'Series B', entity: 'all', from: diStr(now - 30 * DAY), to: diStr(now) },
  ];

  const [series, setSeries] = useState<SeriesDef[]>(defaultSeries);
  const [results, setResults] = useState<Record<string, number>[] | null>(null);
  const [chartMetric, setChartMetric] = useState('gross');

  const entityOptions = useMemo(() => [
    { value: 'all', label: 'All (workspace)' },
    ...chatters.map(c => ({ value: `chatter:${c.name}`, label: `Chatter · ${c.name}` })),
    ...creators.map(c => ({ value: `creator:${c.name}`, label: `Creator · ${c.name}` })),
  ], [chatters, creators]);

  // Compute metrics for a series
  const computeSeriesMetrics = useCallback((s: SeriesDef): Record<string, number> => {
    const analytics = getAnalytics();
    const agency = ws?.name || '';
    const parts = s.entity.split(':');
    const type = parts[0];
    const name = parts[1];
    const fromMs = s.from ? new Date(s.from + 'T00:00:00').getTime() : now - 30 * DAY;
    const toMs = s.to ? new Date(s.to + 'T23:59:59').getTime() : now;

    const f = (x: { agency: string; ts: number; chatter: string; creator: string }) =>
      x.agency === agency && x.ts >= fromMs && x.ts <= toMs &&
      (type === 'all' || (type === 'chatter' && x.chatter === name) || (type === 'creator' && x.creator === name));

    const sales = analytics.sales.filter(f);
    const declines = analytics.declines.filter(f);
    const expired = analytics.expired.filter(f);

    const sp = sales.map(ss => splitSale(
      { amount: ss.amount, creator: ss.creator, chatter: ss.chatter, psp: ss.psp, margin: ss.margin },
      creators, chatters, commission,
    ));

    const gross = _sum(sp.map(x => x.g));
    const platformFee = _sum(sp.map(x => x.platformFee));
    const net = gross - platformFee;
    const agencyKeep = _sum(sp.map(x => x.agencyCut));
    const hpMargin = _sum(sp.map(x => x.margin));
    const salesN = sales.length;
    const buyers = new Set(sales.map(ss => ss.custId)).size;
    const created = salesN + declines.length + expired.length;

    return {
      gross,
      net,
      sales: salesN,
      aov: salesN ? gross / salesN : 0,
      conversion: created ? +(salesN / created * 100).toFixed(1) : 0,
      takeRate: gross ? +(agencyKeep / gross * 100).toFixed(1) : 0,
      buyers,
      hpMargin,
    };
  }, [getAnalytics, ws?.name, creators, chatters, commission]);

  // Run comparison
  const runCompare = () => {
    const vals = series.map(computeSeriesMetrics);
    setResults(vals);
  };

  // Update a series field
  const updateSeries = (i: number, field: keyof SeriesDef, value: string) => {
    setSeries(prev => prev.map((s, idx) => idx === i ? { ...s, [field]: value } : s));
  };

  // Remove a series
  const removeSeries = (i: number) => {
    setSeries(prev => prev.filter((_, idx) => idx !== i));
  };

  // Add series
  const addSeries = () => {
    setSeries(prev => [...prev, {
      label: 'Series ' + String.fromCharCode(65 + prev.length),
      entity: 'all',
      from: diStr(now - 30 * DAY),
      to: diStr(now),
    }]);
  };

  // Preset
  const applyPreset = (k: string) => {
    let s: SeriesDef[] = [];
    const range = (a: number, b: number) => ({ from: diStr(a), to: diStr(b) });
    if (k === 'mom') {
      const tm = startOfMonthTZ(now, tz);
      const lmEnd = tm - DAY;
      const lmStart = startOfMonthTZ(lmEnd, tz);
      s = [
        { label: 'This month', entity: 'all', ...range(tm, now) },
        { label: 'Last month', entity: 'all', ...range(lmStart, lmEnd) },
      ];
    } else if (k === 'wow') {
      const tw = startOfWeekTZ(now, tz);
      const lwEnd = tw - DAY;
      const lwStart = tw - 7 * DAY;
      s = [
        { label: 'This week', entity: 'all', ...range(tw, now) },
        { label: 'Last week', entity: 'all', ...range(lwStart, lwEnd) },
      ];
    } else if (k === '7v7') {
      s = [
        { label: 'Last 7 days', entity: 'all', ...range(now - 7 * DAY, now) },
        { label: 'Previous 7 days', entity: 'all', ...range(now - 14 * DAY, now - 7 * DAY) },
      ];
    } else if (k === 'chatters') {
      s = chatters.slice(0, 4).map(c => ({
        label: c.name,
        entity: 'chatter:' + c.name,
        ...range(now - 30 * DAY, now),
      }));
    } else if (k === 'creators') {
      s = creators.slice(0, 4).map(c => ({
        label: c.name,
        entity: 'creator:' + c.name,
        ...range(now - 30 * DAY, now),
      }));
    }
    if (s.length < 2) { toast('Not enough data for this preset.'); return; }
    setSeries(s);
    // Auto-run
    setTimeout(() => {
      const vals = s.map(computeSeriesMetrics);
      setResults(vals);
    }, 0);
  };

  const labels = series.map(s => s.label);

  return (
    <div>
      <div className="pagehead">
        <div>
          <h2>Compare</h2>
          <p>Compare chatters, creators, or the same metric across different date ranges.</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn ghost" onClick={addSeries}>+ Add series</button>
          <button className="btn" onClick={runCompare}>Run comparison</button>
        </div>
      </div>

      {/* Quick presets */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="sechead" style={{ marginTop: 0 }}>Quick presets</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {CMP_PRESETS.map(p => (
            <button key={p.k} className="btn ghost" style={{ padding: '7px 12px' }} onClick={() => applyPreset(p.k)}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Series config */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="sechead" style={{ marginTop: 0 }}>Series</div>
        {series.map((s, i) => (
          <div key={i} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12 }}>
            <div className="field" style={{ minWidth: 110 }}>
              <label>Label</label>
              <input type="text" value={s.label} onChange={e => updateSeries(i, 'label', e.target.value)} />
            </div>
            <div className="field" style={{ minWidth: 150 }}>
              <label>Data</label>
              <select value={s.entity} onChange={e => updateSeries(i, 'entity', e.target.value)}>
                {entityOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label>From</label>
              <input type="date" value={s.from} onChange={e => updateSeries(i, 'from', e.target.value)} />
            </div>
            <div className="field">
              <label>To</label>
              <input type="date" value={s.to} onChange={e => updateSeries(i, 'to', e.target.value)} />
            </div>
            {series.length > 2 && (
              <button className="btn ghost" style={{ padding: '9px 11px' }} onClick={() => removeSeries(i)}>✕</button>
            )}
          </div>
        ))}
      </div>

      {/* Results */}
      {results && (
        <>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="sechead" style={{ marginTop: 0 }}>Comparison</div>
            <div className="tablewrap" style={{ border: 'none' }}>
              <table>
                <thead>
                  <tr>
                    <th>Metric</th>
                    {labels.map(l => <th key={l}>{l}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {cmpMetrics.map(m => (
                    <tr key={m.k}>
                      <td>{m.label}</td>
                      {results.map((v, i) => {
                        const val = v[m.k] || 0;
                        const base = results[0][m.k] || 0;
                        let delta = '';
                        if (i > 0 && base) {
                          const p = (val - base) / base * 100;
                          delta = ` ${p >= 0 ? '▲' : '▼'}${Math.abs(p).toFixed(0)}%`;
                        }
                        return (
                          <td key={i}>
                            {fmtMetric(m.k, val)}
                            {i > 0 && delta && (
                              <span style={{ fontSize: '11px', marginLeft: 4, color: delta.includes('▲') ? 'var(--mint)' : 'var(--red)' }}>
                                {delta}
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <div className="sechead" style={{ margin: 0 }}>Visual compare</div>
              <select value={chartMetric} onChange={e => setChartMetric(e.target.value)}>
                {cmpMetrics.map(m => <option key={m.k} value={m.k}>{m.label}</option>)}
              </select>
            </div>
            <div style={{ marginTop: 12 }}>
              {results.map((v, i) => {
                const val = v[chartMetric] || 0;
                const mx = Math.max(...results.map(r => r[chartMetric] || 0), 1);
                return (
                  <div key={i} className="metric-row" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0' }}>
                    <span style={{ minWidth: 120, fontSize: '13.6px', color: 'var(--muted)' }}>{labels[i]}</span>
                    <span style={{ flex: 1, height: 8, background: 'var(--ink)', borderRadius: 4, overflow: 'hidden' }}>
                      <span style={{ display: 'block', width: `${val / mx * 100}%`, height: '100%', background: CMP_COLORS[i % 5], borderRadius: 4 }} />
                    </span>
                    <span style={{ minWidth: 100, textAlign: 'right', fontSize: '13.6px' }}>{fmtMetric(chartMetric, val)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
