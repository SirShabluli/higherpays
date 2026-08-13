import { useState, useMemo } from 'react';
import { useAppStore } from '../../store/appStore';
import { useCan, useActiveWorkspace } from '../../hooks/usePermission';
import { rateCard } from '../../business/rateCard';
import { feeBreakdown } from '../../business/feeBreakdown';
import { tzParts } from '../../business/timezone';
import Modal from '../../components/Modal';
import { toast } from '../../components/Toast';
import type { PaymentLink } from '../../types';

const fmt = (n: number) => {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR' }).format(n); }
  catch { return 'EUR ' + n.toFixed(2); }
};

const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const LINK_PILL: Record<string, string> = { Paid: 'ok', Created: '', Failed: 'no', Expired: '' };
const LINK_TTL_MS = 10 * 60 * 1000;

function effectiveLinkStatus(l: PaymentLink): string {
  return (l.status === 'Created' && (Date.now() - l.ts) > LINK_TTL_MS) ? 'Expired' : l.status;
}

export default function LinksPage() {
  const can = useCan();
  const links = useAppStore(s => s.links);
  const creators = useAppStore(s => s.creators);
  const chatters = useAppStore(s => s.chatters);
  const linkLimits = useAppStore(s => s.linkLimits);
  const mode = useAppStore(s => s.mode);
  const fees = useAppStore(s => s.fees);
  const updateState = useAppStore(s => s.updateState);
  const tzMode = useAppStore(s => s.tzMode);
  const tzManual = useAppStore(s => s.tzManual);
  const ws = useActiveWorkspace();

  const activeTZ = () => {
    if (tzMode === 'manual' && tzManual) return tzManual;
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
  };

  const fmtDate = (ts: number) => {
    const p = tzParts(ts, activeTZ());
    const hh = String(p.h).padStart(2, '0'), mm = String(p.mi).padStart(2, '0');
    return { date: `${p.d} ${MON[p.mo - 1]} ${p.y}`, time: `${hh}:${mm}` };
  };

  // Filters
  const [fCreator, setFCreator] = useState('');
  const [fChatter, setFChatter] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [fMin, setFMin] = useState('');
  const [fMax, setFMax] = useState('');
  const [fFrom, setFFrom] = useState('');
  const [fTo, setFTo] = useState('');
  const [fSearch, setFSearch] = useState('');

  // Create link modal
  const [createModal, setCreateModal] = useState(false);
  const [plCreator, setPlCreator] = useState('');
  const [plChatter, setPlChatter] = useState('');
  const [plName, setPlName] = useState('');
  const [plUser, setPlUser] = useState('');
  const [plAmt, setPlAmt] = useState('');

  const filtered = useMemo(() => {
    const q = fSearch.trim().toLowerCase();
    const min = parseFloat(fMin), max = parseFloat(fMax);
    const fromTs = fFrom ? new Date(fFrom + 'T00:00:00').getTime() : null;
    const toTs = fTo ? new Date(fTo + 'T23:59:59').getTime() : null;
    return links.filter(l => {
      if (fCreator && l.creator !== fCreator) return false;
      if (fChatter && l.chatter !== fChatter) return false;
      if (fStatus && effectiveLinkStatus(l) !== fStatus) return false;
      if (!isNaN(min) && l.amount < min) return false;
      if (!isNaN(max) && l.amount > max) return false;
      if (fromTs && l.ts < fromTs) return false;
      if (toTs && l.ts > toTs) return false;
      if (q && !((l.customerName || '') + (l.customerUsername || '')).toLowerCase().includes(q)) return false;
      return true;
    });
  }, [links, fCreator, fChatter, fStatus, fMin, fMax, fFrom, fTo, fSearch]);

  const paid = filtered.filter(l => l.status === 'Paid');
  const conv = filtered.length ? Math.round(paid.length / filtered.length * 100) : 0;
  const revenue = paid.reduce((s, l) => s + l.amount, 0);

  const clearFilters = () => {
    setFCreator(''); setFChatter(''); setFStatus('');
    setFMin(''); setFMax(''); setFFrom(''); setFTo(''); setFSearch('');
  };

  const badge = (s: string) => {
    const c = LINK_PILL[s];
    return c != null && c !== '' ? <span className={`pill ${c}`}>{s}</span> : <span className="seg">{s}</span>;
  };

  // Fee indicator
  const isLive = mode === 'live';
  const rc = rateCard(ws, fees, isLive);
  const showSplit = can('platform.view');

  const amtNum = parseFloat(plAmt) || 0;
  const amtValid = amtNum > 0;
  const belowMin = linkLimits.min != null && amtNum < linkLimits.min;
  const aboveMax = linkLimits.max != null && amtNum > linkLimits.max;
  const fb = amtValid && !belowMin && !aboveMax ? feeBreakdown(amtNum, rc) : null;

  const openCreate = () => {
    const activeCreators = creators.filter(c => c.status !== 'paused' && c.status !== 'suspended');
    setPlCreator(activeCreators[0]?.name || '');
    setPlChatter(chatters[0]?.name || '');
    setPlName(''); setPlUser(''); setPlAmt('');
    setCreateModal(true);
  };

  const createLink = () => {
    const amt = parseFloat(plAmt);
    const floor = linkLimits.min ?? linkLimits.providerMin;
    if (!(amt >= floor)) { toast('Minimum link amount is ' + fmt(floor) + '.'); return; }
    if (linkLimits.max != null && amt > linkLimits.max) { toast('Maximum link amount is ' + fmt(linkLimits.max) + '.'); return; }
    if (!plName.trim()) { toast('Customer name is required.'); return; }
    let user = plUser.trim();
    if (user && !user.startsWith('@')) user = '@' + user;

    const newLink: PaymentLink = {
      id: 'pl' + (links.length + 1),
      creator: plCreator, chatter: plChatter,
      customerName: plName.trim(), customerUsername: user,
      amount: amt, unit: 'EUR', status: 'Created', ts: Date.now(),
    };
    updateState({ links: [newLink, ...links] });
    setCreateModal(false);
    toast('Hosted payment link generated.');
  };

  const hintText = (() => {
    const parts: string[] = [];
    if (linkLimits.min) parts.push('Minimum ' + fmt(linkLimits.min));
    if (linkLimits.max) parts.push('Maximum ' + fmt(linkLimits.max));
    return parts.join(' \u00b7 ');
  })();

  return (
    <div>
      <div className="pagehead">
        <div><h2>Payment Links</h2><p>PPV links generated by chatters.</p></div>
        <div style={{ display: 'flex', gap: 8 }}>
          {can('commissions.manage') && (
            <button className="btn ghost" onClick={() => toast(mode === 'live' ? 'Reconciling...' : 'Nothing to reconcile \u2013 demo has no live provider.')}>
              Reconcile
            </button>
          )}
          {can('links.create') && (
            <button className="btn" onClick={openCreate}>+ New link</button>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="stats">
        <div className="card stat"><div className="lbl">Links</div><div className="val">{filtered.length}</div><div className="sub">in view</div></div>
        <div className="card stat"><div className="lbl">Paid</div><div className="val">{paid.length}</div><div className="sub">conversions</div></div>
        <div className="card stat"><div className="lbl">Conversion</div><div className="val">{conv}%</div><div className="sub">paid / total</div></div>
        <div className="card stat"><div className="lbl">Revenue</div><div className="val">{fmt(revenue)}</div><div className="sub up">from paid links</div></div>
      </div>

      {/* Filters */}
      <div className="filters">
        <select value={fCreator} onChange={e => setFCreator(e.target.value)}>
          <option value="">All creators</option>
          {[...new Set(creators.map(c => c.name))].map(n => <option key={n}>{n}</option>)}
        </select>
        <select value={fChatter} onChange={e => setFChatter(e.target.value)}>
          <option value="">All chatters</option>
          {[...new Set(chatters.map(c => c.name))].map(n => <option key={n}>{n}</option>)}
        </select>
        <select value={fStatus} onChange={e => setFStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option>Created</option><option>Paid</option><option>Failed</option><option>Expired</option>
        </select>
        <input type="number" placeholder="Min \u20ac" value={fMin} onChange={e => setFMin(e.target.value)} style={{ maxWidth: 100 }} />
        <input type="number" placeholder="Max \u20ac" value={fMax} onChange={e => setFMax(e.target.value)} style={{ maxWidth: 100 }} />
        <input type="date" value={fFrom} onChange={e => setFFrom(e.target.value)} />
        <input type="date" value={fTo} onChange={e => setFTo(e.target.value)} />
        <input type="text" placeholder="Search customer..." value={fSearch} onChange={e => setFSearch(e.target.value)} style={{ maxWidth: 180 }} />
        <button className="btn ghost" onClick={clearFilters}>Clear</button>
      </div>

      {/* Table */}
      <div className="card">
        <div className="tablewrap">
          <table>
            <thead>
              <tr><th>Ref</th><th>Creator</th><th>Chatter</th><th>Customer</th><th>Amount</th><th>Status</th><th>Date</th></tr>
            </thead>
            <tbody>
              {filtered.length > 0 ? filtered.map(l => {
                const d = fmtDate(l.ts);
                const status = effectiveLinkStatus(l);
                return (
                  <tr key={l.id}>
                    <td><span className="ref">{l.id}</span></td>
                    <td>{l.creator}</td>
                    <td>{l.chatter}</td>
                    <td><div className="cname">{l.customerName || '\u2013'}</div><div className="cemail">{l.customerUsername || ''}</div></td>
                    <td className="amt">{fmt(l.amount)}</td>
                    <td>{badge(status)}</td>
                    <td className="time">{d.date}<br /><span style={{ color: '#4d5a72' }}>{d.time}</span></td>
                  </tr>
                );
              }) : (
                <tr><td colSpan={7} style={{ padding: 36, textAlign: 'center', color: 'var(--muted)' }}>No links match these filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div style={{ padding: '8px 12px', fontSize: '13.2px', color: 'var(--muted)' }}>Showing {filtered.length}</div>
      </div>

      {/* Create link modal */}
      <Modal open={createModal} onClose={() => setCreateModal(false)}>
        <h3>Create PPV link</h3>
        <p className="sub">Generates a hosted payment link. The customer pays on the provider's page &mdash; card details never touch this system.</p>
        <div className="field">
          <label>Creator</label>
          <select value={plCreator} onChange={e => setPlCreator(e.target.value)}>
            {creators.filter(c => c.status !== 'paused' && c.status !== 'suspended').map(c => (
              <option key={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Chatter</label>
          <select value={plChatter} onChange={e => setPlChatter(e.target.value)}>
            {chatters.map(c => <option key={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Customer name</label>
          <input type="text" placeholder="Display name" value={plName} onChange={e => setPlName(e.target.value)} />
        </div>
        <div className="field">
          <label>Customer username</label>
          <input type="text" placeholder="@username" value={plUser}
            onChange={e => setPlUser(e.target.value)}
            onBlur={() => { let v = plUser.trim(); if (v && !v.startsWith('@')) setPlUser('@' + v); }} />
        </div>
        <div className="field">
          <label>Amount (EUR)</label>
          <input type="number" min={linkLimits.min || linkLimits.providerMin}
            max={linkLimits.max ?? undefined} step={0.01} placeholder="0.00"
            value={plAmt} onChange={e => setPlAmt(e.target.value)} />
          <div className="sub" style={{ marginTop: 6 }}>
            {belowMin ? <span style={{ color: 'var(--red)' }}>Below the {fmt(linkLimits.min!)} minimum.</span>
              : aboveMax ? <span style={{ color: 'var(--red)' }}>Above the {fmt(linkLimits.max!)} maximum.</span>
              : hintText}
          </div>
        </div>

        {/* Fee indicator */}
        <div className="pl-fees">
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
            <span style={{ color: 'var(--muted)', fontSize: '13.2px' }}>Fees on this link</span>
            <span style={{ color: fb ? (fb.effectivePct >= 18 ? 'var(--red)' : fb.effectivePct >= 15 ? 'var(--amber)' : 'var(--brand)') : 'var(--muted)' }}>
              {fb ? fb.effectivePct.toFixed(1) + '%' : '\u2013'}
            </span>
          </div>
          <div className="fee-bar">
            <span style={{
              width: fb ? Math.min(100, fb.effectivePct / 25 * 100) + '%' : '0%',
              background: fb ? (fb.effectivePct >= 18 ? 'var(--red)' : fb.effectivePct >= 15 ? 'var(--amber)' : 'var(--brand)') : undefined,
            }} />
          </div>
          <div className="fee-line">
            <span>{fb ? `Platform fee (${fb.blendedPct}%)` : 'Platform fee'}</span>
            <b className="fee-val">{fb ? fmt(fb.blendedFee) : '\u2013'}</b>
          </div>
          <div className="fee-line">
            <span>Fixed per transaction</span>
            <b className="fee-val">{fb ? fmt(fb.fixed) : '\u2013'}</b>
          </div>
          {showSplit && fb && fb.pspPct != null && (
            <div>
              <div className="fee-line" style={{ opacity: 0.75 }}>
                <span>{'\u2937'} PSP cost ({fb.pspPct}%)</span>
                <b className="fee-val">{fmt(fb.pspFee!)}</b>
              </div>
              <div className="fee-line" style={{ opacity: 0.75 }}>
                <span>{'\u2937'} HigherPays margin ({fb.marginPct}%)</span>
                <b className="fee-val">{fmt(fb.marginFee!)}</b>
              </div>
            </div>
          )}
          <div className="fee-tot">
            <span>Total fees</span>
            <span className="fee-val">{fb ? fmt(fb.total) : '\u2013'}</span>
          </div>
          <div className="fee-net">
            <span>Net to workspace</span>
            <span className="fee-val">{fb ? fmt(fb.net) : '\u2013'}</span>
          </div>
          {fb && fb.effectivePct >= 18 && (
            <div style={{ color: 'var(--red)', fontSize: '13.2px', marginTop: 6 }}>
              The fixed {fmt(fb.fixed)} fee dominates at this amount &mdash; a larger link is far more efficient.
            </div>
          )}
        </div>

        <div className="modal-actions">
          <button className="btn ghost" onClick={() => setCreateModal(false)}>Cancel</button>
          <button className="btn" onClick={createLink}>Generate link</button>
        </div>
      </Modal>
    </div>
  );
}
