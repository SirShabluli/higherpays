import { useState, useMemo } from 'react';
import { useAppStore } from '../../store/appStore';
import { useCan } from '../../hooks/usePermission';
import Modal from '../../components/Modal';
import { toast } from '../../components/Toast';
import { tzParts } from '../../business/timezone';
import type { Customer, CustomerSegment } from '../../types';

const fmt = (n: number) => {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR' }).format(n); }
  catch { return 'EUR ' + n.toFixed(2); }
};

const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const segClass = (s: string) =>
  s === 'VIP' ? 'seg vip' : s === 'At-risk' ? 'seg risk' : s === 'Inactive' ? 'seg inactive' : 'seg';

const custAvg = (c: Customer) => c.purchases ? c.spend / c.purchases : 0;

interface ColDef { k: string; label: string }

const CUST_COLS: ColDef[] = [
  { k: 'name', label: 'Customer' }, { k: 'username', label: 'Username' },
  { k: 'creator', label: 'Creator' }, { k: 'chatter', label: 'Chatter' },
  { k: 'spend', label: 'Total spend' }, { k: 'ltv', label: 'LTV' },
  { k: 'purchases', label: '# Buys' }, { k: 'avg', label: 'Avg / sale' },
  { k: 'last', label: 'Last purchase' }, { k: 'seg', label: 'Segment' },
];

const DEFAULT_COLS = new Set(['name', 'username', 'creator', 'chatter', 'spend', 'avg', 'last', 'seg']);
const SEGMENTS: CustomerSegment[] = ['New', 'Regular', 'High value', 'VIP', 'Inactive', 'At-risk'];

export default function CustomersPage() {
  const can = useCan();
  const customers = useAppStore(s => s.customers);
  const creators = useAppStore(s => s.creators);
  const chatters = useAppStore(s => s.chatters);
  const links = useAppStore(s => s.links);
  const updateState = useAppStore(s => s.updateState);
  const tzMode = useAppStore(s => s.tzMode);
  const tzManual = useAppStore(s => s.tzManual);

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
  const [seg, setSeg] = useState('');
  const [search, setSearch] = useState('');
  const [crFilter, setCrFilter] = useState('');
  const [chFilter, setChFilter] = useState('');
  const [sort, setSort] = useState('spend');

  // Column chooser
  const [cols, setCols] = useState(DEFAULT_COLS);
  const [colModal, setColModal] = useState(false);
  const [colPick, setColPick] = useState(DEFAULT_COLS);

  // Customer card
  const [cardId, setCardId] = useState<string | null>(null);

  // Add customer
  const [addModal, setAddModal] = useState(false);
  const [cuName, setCuName] = useState('');
  const [cuUser, setCuUser] = useState('');
  const [cuCreator, setCuCreator] = useState(creators[0]?.name || '');
  const [cuChatter, setCuChatter] = useState(chatters[0]?.name || '');
  const [cuSeg, setCuSeg] = useState<CustomerSegment>('New');
  const [cuError, setCuError] = useState(false);

  // Filtered list
  const filtered = useMemo(() => {
    let list = customers.filter(c => {
      if (seg && c.seg !== seg) return false;
      if (crFilter && c.creator !== crFilter) return false;
      if (chFilter && c.chatter !== chFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!(c.name + c.username + (c.email || '')).toLowerCase().includes(q)) return false;
      }
      return true;
    });
    const keyFn: Record<string, (c: Customer) => number> = {
      spend: c => c.spend, ltv: c => c.spend, avg: custAvg, last: c => c.last,
    };
    const fn = keyFn[sort] || (c => c.spend);
    return [...list].sort((a, b) => fn(b) - fn(a));
  }, [customers, seg, crFilter, chFilter, search, sort]);

  const visibleCols = CUST_COLS.filter(c => cols.has(c.k));

  const cellContent = (c: Customer, k: string) => {
    switch (k) {
      case 'name': return <span className="cname">{c.name}</span>;
      case 'username': return <span className="cemail">{c.username}</span>;
      case 'spend': case 'ltv': return <span className="amt">{fmt(c.spend)}</span>;
      case 'avg': return fmt(custAvg(c));
      case 'purchases': return c.purchases;
      case 'last': { const d = fmtDate(c.last); return <span className="time">{d.date}<br /><span style={{ color: '#4d5a72' }}>{d.time}</span></span>; }
      case 'seg': return <span className={segClass(c.seg)}>{c.seg}</span>;
      default: return (c as unknown as Record<string, string>)[k] || '';
    }
  };

  const clearFilters = () => { setSeg(''); setSearch(''); setCrFilter(''); setChFilter(''); setSort('spend'); };

  const addCustomer = () => {
    if (!cuName.trim()) { setCuError(true); return; }
    let u = cuUser.trim();
    if (u && !u.startsWith('@')) u = '@' + u;
    const newCust: Customer = {
      id: 'cu' + (customers.length + 1),
      name: cuName.trim(), username: u, email: '',
      creator: cuCreator, chatter: cuChatter,
      spend: 0, purchases: 0, last: Date.now(), seg: cuSeg,
    };
    updateState({ customers: [...customers, newCust] });
    setAddModal(false);
    setCuName(''); setCuUser(''); setCuError(false);
    toast('Customer added.');
  };

  const applyColumns = () => {
    if (colPick.size === 0) { toast('Pick at least one column.'); return; }
    setCols(new Set(colPick));
    setColModal(false);
  };

  // Customer card data
  const cardCustomer = cardId ? customers.find(c => c.id === cardId) : null;
  const cardLinks = cardCustomer ? links.filter(l => l.customerUsername === cardCustomer.username) : [];

  return (
    <div>
      <div className="pagehead">
        <div><h2>Customers</h2><p>Fan CRM &mdash; everyone who paid.</p></div>
        <div style={{ display: 'flex', gap: 8 }}>
          {can('customers.export') && (
            <button className="btn ghost" onClick={() => toast('Export coming soon.')}>Export</button>
          )}
          {can('customers.manage') && (
            <button className="btn" onClick={() => setAddModal(true)}>+ Add customer</button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="filters">
        <select value={seg} onChange={e => setSeg(e.target.value)}>
          <option value="">All segments</option>
          {SEGMENTS.map(s => <option key={s}>{s}</option>)}
        </select>
        <select value={crFilter} onChange={e => setCrFilter(e.target.value)}>
          <option value="">All creators</option>
          {[...new Set(creators.map(c => c.name))].map(n => <option key={n}>{n}</option>)}
        </select>
        <select value={chFilter} onChange={e => setChFilter(e.target.value)}>
          <option value="">All chatters</option>
          {[...new Set(chatters.map(c => c.name))].map(n => <option key={n}>{n}</option>)}
        </select>
        <select value={sort} onChange={e => setSort(e.target.value)}>
          <option value="spend">Sort by spend</option>
          <option value="avg">Sort by avg</option>
          <option value="last">Sort by recent</option>
        </select>
        <input type="text" placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} style={{ maxWidth: 200 }} />
        <button className="btn ghost" onClick={clearFilters}>Clear</button>
        <button className="btn ghost" onClick={() => { setColPick(new Set(cols)); setColModal(true); }}>Columns</button>
      </div>

      {/* Table */}
      <div className="card">
        <div className="tablewrap">
          <table>
            <thead>
              <tr>{visibleCols.map(c => <th key={c.k}>{c.label}</th>)}</tr>
            </thead>
            <tbody>
              {filtered.length > 0 ? filtered.map(c => (
                <tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => setCardId(c.id)}>
                  {visibleCols.map(col => <td key={col.k}>{cellContent(c, col.k)}</td>)}
                </tr>
              )) : (
                <tr>
                  <td colSpan={visibleCols.length} style={{ padding: 36, textAlign: 'center', color: 'var(--muted)' }}>
                    No customers match.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div style={{ padding: '8px 12px', fontSize: '13.2px', color: 'var(--muted)' }}>Showing {filtered.length}</div>
      </div>

      {/* Customer card modal */}
      <Modal open={!!cardCustomer} onClose={() => setCardId(null)}>
        {cardCustomer && (
          <>
            <h3>{cardCustomer.username}</h3>
            <p className="sub">{cardCustomer.name} &middot; {cardCustomer.email || 'no email'}</p>
            <div className="deep">
              <div className="dcell"><div className="dl">Total spend / LTV</div><div className="dv">{fmt(cardCustomer.spend)}</div></div>
              <div className="dcell"><div className="dl">Purchases</div><div className="dv">{cardCustomer.purchases}</div></div>
              <div className="dcell"><div className="dl">Avg / sale</div><div className="dv">{fmt(custAvg(cardCustomer))}</div></div>
              <div className="dcell"><div className="dl">Segment</div><div className="dv" style={{ fontSize: '15.4px' }}><span className={segClass(cardCustomer.seg)}>{cardCustomer.seg}</span></div></div>
            </div>
            <div className="setrow"><div className="k">Creator</div><span className="mono-val">{cardCustomer.creator}</span></div>
            <div className="setrow"><div className="k">Chatter</div><span className="mono-val">{cardCustomer.chatter}</span></div>
            <div className="setrow"><div className="k">Last purchase</div><span className="mono-val">{new Date(cardCustomer.last).toLocaleString()}</span></div>
            <div className="sechead">Recent links ({cardLinks.length})</div>
            <div style={{ maxHeight: 120, overflow: 'auto', fontSize: '14.3px' }}>
              {cardLinks.slice(0, 6).map(l => (
                <div className="ws-row" key={l.id}>
                  <span>{l.creator} &middot; {fmt(l.amount)}</span>
                  <span className={`pill ${l.status === 'Paid' ? 'ok' : 'no'}`}>{l.status}</span>
                </div>
              ))}
              {cardLinks.length === 0 && <span style={{ color: 'var(--muted)' }}>No links.</span>}
            </div>
            <div className="modal-actions">
              <button className="btn ghost" onClick={() => setCardId(null)}>Close</button>
            </div>
          </>
        )}
      </Modal>

      {/* Column chooser modal */}
      <Modal open={colModal} onClose={() => setColModal(false)}>
        <h3>Choose columns</h3>
        <p className="sub">Pick what shows in the customers table.</p>
        <div style={{ maxHeight: 260, overflow: 'auto' }}>
          {CUST_COLS.map(c => (
            <label key={c.k} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 0', fontSize: '15.4px' }}>
              <input type="checkbox" checked={colPick.has(c.k)}
                onChange={e => {
                  setColPick(prev => {
                    const next = new Set(prev);
                    e.target.checked ? next.add(c.k) : next.delete(c.k);
                    return next;
                  });
                }}
                style={{ minWidth: 'auto', width: 'auto' }} />
              {c.label}
            </label>
          ))}
        </div>
        <div className="modal-actions">
          <button className="btn ghost" onClick={() => setColModal(false)}>Cancel</button>
          <button className="btn" onClick={applyColumns}>Apply</button>
        </div>
      </Modal>

      {/* Add customer modal */}
      <Modal open={addModal} onClose={() => setAddModal(false)}>
        <h3>Add customer</h3>
        <p className="sub">Fan CRM record. Keep only data you have a lawful basis to hold.</p>
        <div className="field">
          <label>Name</label>
          <input type="text" placeholder="Display name" value={cuName}
            onChange={e => { setCuName(e.target.value); setCuError(false); }}
            style={cuError ? { borderColor: 'var(--red)' } : undefined} />
        </div>
        <div className="field">
          <label>Username</label>
          <input type="text" placeholder="@username" value={cuUser}
            onChange={e => setCuUser(e.target.value)} />
        </div>
        <div className="field">
          <label>Creator</label>
          <select value={cuCreator} onChange={e => setCuCreator(e.target.value)}>
            {creators.map(c => <option key={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Chatter</label>
          <select value={cuChatter} onChange={e => setCuChatter(e.target.value)}>
            {chatters.map(c => <option key={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Segment</label>
          <select value={cuSeg} onChange={e => setCuSeg(e.target.value as CustomerSegment)}>
            {SEGMENTS.map(s => <option key={s}>{s}</option>)}
          </select>
        </div>
        <div className="modal-actions">
          <button className="btn ghost" onClick={() => setAddModal(false)}>Cancel</button>
          <button className="btn" onClick={addCustomer}>Add customer</button>
        </div>
      </Modal>
    </div>
  );
}
