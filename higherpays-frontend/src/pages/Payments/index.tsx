import { useState, useMemo } from 'react';
import { useAppStore } from '../../store/appStore';
import { useCan, useActiveWorkspace } from '../../hooks/usePermission';
import { scopeTx } from '../../rbac/permissions';
import { splitSale } from '../../business/splitSale';
import { rateCard } from '../../business/rateCard';
import { feeBreakdown } from '../../business/feeBreakdown';
import { tzParts } from '../../business/timezone';
import Modal from '../../components/Modal';
import { toast } from '../../components/Toast';
import type { Transaction } from '../../types';

const fmt = (n: number) => {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR' }).format(n); }
  catch { return 'EUR ' + n.toFixed(2); }
};

const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

interface ColDef { k: string; label: string }

const PAY_COLS: ColDef[] = [
  { k: 'reference', label: 'Reference' }, { k: 'customer', label: 'Customer' },
  { k: 'username', label: 'Username' }, { k: 'creator', label: 'Creator' },
  { k: 'chatter', label: 'Chatter' }, { k: 'notes', label: 'Notes' },
  { k: 'gross', label: 'Gross' }, { k: 'platformFee', label: 'Platform fee' },
  { k: 'net', label: 'Net' }, { k: 'status', label: 'Status' }, { k: 'date', label: 'Date' },
];
const DEFAULT_COLS = new Set(['reference', 'customer', 'chatter', 'gross', 'status', 'date']);

// Dashboard stat card definitions
interface StatDef {
  k: string; label: string; perm: string; color?: string;
  val: (ctx: StatCtx) => string; sub: (ctx: StatCtx) => string; up?: boolean;
}

interface StatCtx {
  list: Transaction[]; paid: Transaction[]; gross: number; fee: number;
  dueCreators: number; dueTeam: number; creatorCount: number;
  chatterCount: number; rateSpread: string;
  reserveHeld: number; reservePct: number; reserveReleaseDays: number; reserveSource: string;
}

export default function PaymentsPage() {
  const can = useCan();
  const transactions = useAppStore(s => s.transactions);
  const role = useAppStore(s => s.role);
  const identity = useAppStore(s => s.identity);
  const creators = useAppStore(s => s.creators);
  const chatters = useAppStore(s => s.chatters);
  const commission = useAppStore(s => s.commission);
  const mode = useAppStore(s => s.mode);
  const fees = useAppStore(s => s.fees);
  const reserve = useAppStore(s => s.reserve);
  const updateState = useAppStore(s => s.updateState);
  const tzMode = useAppStore(s => s.tzMode);
  const tzManual = useAppStore(s => s.tzManual);
  const ws = useActiveWorkspace();

  const isLive = mode === 'live';
  const rc = rateCard(ws, fees, isLive);
  const blended = rc.blended;
  const platFee = (g: number) => g * blended / 100;

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
  const [fStatus, setFStatus] = useState('');
  const [fFrom, setFFrom] = useState('');
  const [fTo, setFTo] = useState('');
  const [fSearch, setFSearch] = useState('');
  const [rangePop, setRangePop] = useState(false);

  // Column state
  const [cols, setCols] = useState(DEFAULT_COLS);
  const [colModal, setColModal] = useState(false);
  const [colPick, setColPick] = useState(DEFAULT_COLS);

  // Stat card picker
  const [statsSet, setStatsSet] = useState(new Set(['gross', 'fee', 'net', 'rate']));
  const [statsModal, setStatsModal] = useState(false);
  const [statsPick, setStatsPick] = useState(new Set(['gross', 'fee', 'net', 'rate']));

  // Transaction detail
  const [txDetail, setTxDetail] = useState<Transaction | null>(null);
  // Refund confirm
  const [refundTx, setRefundTx] = useState<Transaction | null>(null);
  const [refundConfirmed, setRefundConfirmed] = useState(false);

  // Filtered & scoped list
  const scoped = useMemo(() => scopeTx(transactions, role, identity), [transactions, role, identity]);

  const filtered = useMemo(() => {
    const q = fSearch.trim().toLowerCase();
    const fromTs = fFrom ? new Date(fFrom + 'T00:00:00').getTime() : null;
    const toTs = fTo ? new Date(fTo + 'T23:59:59').getTime() : null;
    return scoped.filter(t => {
      if (fStatus === 'paid' && !t.paid) return false;
      if (fStatus === 'declined' && t.paid) return false;
      if (fromTs && t.ts < fromTs) return false;
      if (toTs && t.ts > toTs) return false;
      if (q && !(t.referenceId + t.clientName + t.username + t.creator + t.chatter + t.notes).toLowerCase().includes(q)) return false;
      return true;
    });
  }, [scoped, fStatus, fFrom, fTo, fSearch]);

  const paidTx = filtered.filter(t => t.paid);
  const gross = paidTx.reduce((s, t) => s + t.amount, 0);
  const fee = platFee(gross);

  // Compute splits for due-payment cards
  const splits = paidTx.map(t => splitSale(
    { amount: t.amount, creator: t.creator, chatter: t.chatter },
    creators, chatters, commission,
  ));
  const dueCreators = splits.reduce((s, x) => s + x.creatorCut, 0);
  const dueTeam = splits.reduce((s, x) => s + x.chatterCut, 0);
  const creatorCount = new Set(paidTx.map(t => t.creator).filter(Boolean)).size;
  const chatterNames = [...new Set(paidTx.map(t => t.chatter).filter(Boolean))];
  const chatterCount = chatterNames.length;
  const rates = chatterNames.map(nm => {
    const ch = chatters.find(c => c.name === nm);
    return (ch && ch.commissionPct != null) ? +ch.commissionPct : (commission.chatterPct || 0);
  });
  const rateSpread = rates.length ? (Math.min(...rates) === Math.max(...rates)
    ? Math.min(...rates) + '%' : Math.min(...rates) + '\u2013' + Math.max(...rates) + '%') : '';

  // Reserve
  const reservePct = rc.reservePct || 0;
  const reserveHeld = (reserve && reserve.source === 'settlements')
    ? +(reserve.held || 0)
    : +(gross * reservePct / 100).toFixed(2);
  const reserveSource = (reserve && reserve.source === 'settlements') ? 'settlements' : 'estimated';

  const ctx: StatCtx = {
    list: filtered, paid: paidTx, gross, fee,
    dueCreators, dueTeam, creatorCount, chatterCount, rateSpread,
    reserveHeld, reservePct, reserveReleaseDays: rc.reserveReleaseDays || 0, reserveSource,
  };

  const PAY_STATS: StatDef[] = [
    { k: 'gross', label: 'Gross volume', perm: 'payments.view', val: c => fmt(c.gross), sub: () => 'What customers paid', up: true },
    { k: 'fee', label: 'Platform fee', perm: 'payments.view', val: c => fmt(c.fee), sub: () => 'Platform fee ' + blended + '%' },
    { k: 'net', label: 'Net', perm: 'payments.view', val: c => fmt(c.gross - c.fee), sub: () => 'Net after platform fees', up: true },
    { k: 'rate', label: 'Approval rate', perm: 'payments.view', val: c => (c.list.length ? Math.round(c.paid.length / c.list.length * 100) : 0) + '%', sub: c => c.paid.length + ' of ' + c.list.length },
    { k: 'reserve', label: 'Held in reserve', perm: 'commissions.view', color: 'var(--amber)',
      val: c => fmt(c.reserveHeld),
      sub: c => c.reservePct ? `${c.reservePct}% \u00b7 released after ${c.reserveReleaseDays}d${c.reserveSource === 'estimated' ? ' \u00b7 est.' : ''}` : 'no reserve configured' },
    { k: 'dueCreators', label: 'Creator due payments', perm: 'commissions.view', color: 'var(--mint)',
      val: c => fmt(c.dueCreators), sub: c => c.creatorCount + ' creator' + (c.creatorCount === 1 ? '' : 's') + ' in view' },
    { k: 'dueTeam', label: "Team's due payments", perm: 'commissions.view', color: 'var(--brand)',
      val: c => fmt(c.dueTeam), sub: c => c.chatterCount + ' chatter' + (c.chatterCount === 1 ? '' : 's') + (c.rateSpread ? ' \u00b7 ' + c.rateSpread : '') },
    { k: 'aov', label: 'Average order', perm: 'payments.view', val: c => fmt(c.paid.length ? c.gross / c.paid.length : 0), sub: c => c.paid.length + ' paid' },
    { k: 'buyers', label: 'Unique customers', perm: 'payments.view', val: c => String(new Set(c.paid.map(t => t.clientName)).size), sub: () => 'in this view' },
    { k: 'declines', label: 'Declined', perm: 'payments.view', color: 'var(--red)', val: c => String(c.list.length - c.paid.length), sub: () => 'failed attempts' },
  ];

  const availableStats = PAY_STATS.filter(s => can(s.perm as never));
  const shownStats = availableStats.filter(s => statsSet.has(s.k));
  const displayStats = shownStats.length > 0 ? shownStats : availableStats.slice(0, 4);

  // Column rendering
  const visibleCols = PAY_COLS.filter(c => cols.has(c.k));

  const cellContent = (t: Transaction, k: string) => {
    const g = t.amount, pf = platFee(g), net = g - pf;
    switch (k) {
      case 'reference': return <span className="ref">{t.referenceId}</span>;
      case 'customer': return <span className="cname">{t.clientName}</span>;
      case 'username': return <span className="cemail">{t.username}</span>;
      case 'creator': return t.creator;
      case 'chatter': return t.chatter;
      case 'notes': return t.notes;
      case 'gross': return <span className="amt">{fmt(g)}</span>;
      case 'platformFee': return <span className="fee">{fmt(pf)}</span>;
      case 'net': return <span className="amt">{fmt(net)}</span>;
      case 'status': return <span className={`pill ${t.paid ? 'ok' : 'no'}`}>{t.paid ? 'Paid' : 'Declined'}</span>;
      case 'date': { const d = fmtDate(t.ts); return <span className="time">{d.date}<br /><span style={{ color: '#4d5a72' }}>{d.time}</span></span>; }
      default: return '';
    }
  };

  const clearFilters = () => { setFStatus(''); setFFrom(''); setFTo(''); setFSearch(''); };

  // Range label
  const dOnly = (v: string) => {
    const d = new Date(v + 'T00:00:00');
    return d.getDate() + ' ' + MON[d.getMonth()] + ' ' + d.getFullYear();
  };
  const rangeLabel = (!fFrom && !fTo) ? 'All time'
    : (fFrom && fTo) ? `${dOnly(fFrom)} \u2013 ${dOnly(fTo)}`
    : fFrom ? `From ${dOnly(fFrom)}` : `Until ${dOnly(fTo)}`;

  // Refund
  const doRefund = (t: Transaction) => {
    const updated = transactions.map(tx =>
      tx.id === t.id ? { ...tx, refunded: true, paid: false } : tx
    );
    updateState({ transactions: updated });
    setRefundTx(null); setTxDetail(null); setRefundConfirmed(false);
    toast('Refunded ' + fmt(t.amount) + ' (demo).');
  };

  // Apply columns
  const applyColumns = () => {
    if (colPick.size === 0) return;
    setCols(new Set(colPick));
    setColModal(false);
  };

  // Apply stat cards
  const applyStats = () => {
    if (statsPick.size === 0) { toast('Pick at least one card.'); return; }
    setStatsSet(new Set(statsPick));
    setStatsModal(false);
  };

  // Detail row for tx detail modal
  const detailRow = (k: string, v: string | React.ReactNode) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '9px 0', borderBottom: '1px solid rgba(30,43,68,.5)' }}>
      <span style={{ color: 'var(--muted)', fontSize: '14.3px' }}>{k}</span>
      <span style={{ fontSize: '14.3px', textAlign: 'right' }}>{v}</span>
    </div>
  );

  return (
    <div>
      <div className="pagehead">
        <div><h2>Payments</h2><p>Transaction ledger.</p></div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn ghost" onClick={() => { setStatsPick(new Set(statsSet)); setStatsModal(true); }}>
            Cards
          </button>
          {can('payments.export') && (
            <button className="btn ghost" onClick={() => toast('Export coming soon.')}>Export</button>
          )}
          {['owner', 'admin'].includes(role) && (
            <button className="btn ghost" onClick={() => { setColPick(new Set(cols)); setColModal(true); }}>
              Columns
            </button>
          )}
        </div>
      </div>

      {/* Dashboard stat cards */}
      <div className="stats">
        {displayStats.map(s => (
          <div className="card stat" key={s.k}>
            <div className="lbl">{s.label}</div>
            <div className="val" style={s.color ? { color: s.color } : undefined}>{s.val(ctx)}</div>
            <div className={`sub${s.up ? ' up' : ''}`}>{s.sub(ctx)}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="filters">
        <select value={fStatus} onChange={e => setFStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="paid">Paid</option>
          <option value="declined">Declined</option>
        </select>
        <div style={{ position: 'relative' }}>
          <button className="btn ghost" onClick={() => setRangePop(!rangePop)} style={{ fontSize: '13.2px' }}>
            {rangeLabel}
          </button>
          {rangePop && (
            <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 10, background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 10, minWidth: 220 }}>
              <div className="field"><label>From</label><input type="date" value={fFrom} onChange={e => setFFrom(e.target.value)} /></div>
              <div className="field"><label>To</label><input type="date" value={fTo} onChange={e => setFTo(e.target.value)} /></div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn ghost" onClick={() => { setFFrom(''); setFTo(''); }}>All time</button>
                <button className="btn" onClick={() => setRangePop(false)}>Apply</button>
              </div>
            </div>
          )}
        </div>
        <input type="text" placeholder="Search..." value={fSearch} onChange={e => setFSearch(e.target.value)} style={{ maxWidth: 200 }} />
        <button className="btn ghost" onClick={clearFilters}>Clear</button>
      </div>

      {/* Table */}
      <div className="card">
        <div className="tablewrap">
          <table>
            <thead><tr>{visibleCols.map(c => <th key={c.k}>{c.label}</th>)}</tr></thead>
            <tbody>
              {filtered.length > 0 ? filtered.map(t => (
                <tr key={t.id} className="txrow" style={{ cursor: 'pointer' }} onClick={() => setTxDetail(t)} title="View details">
                  {visibleCols.map(c => <td key={c.k}>{cellContent(t, c.k)}</td>)}
                </tr>
              )) : (
                <tr><td colSpan={visibleCols.length} style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
                  No transactions match these filters.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div style={{ padding: '8px 12px', fontSize: '13.2px', color: 'var(--muted)' }}>Showing {filtered.length}</div>
      </div>

      {/* Transaction detail modal */}
      <Modal open={!!txDetail && !refundTx} onClose={() => setTxDetail(null)}>
        {txDetail && (() => {
          const pf = platFee(txDetail.amount), net = txDetail.amount - pf;
          return (
            <>
              <h3>Transaction detail</h3>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, margin: '2px 0 12px' }}>
                <span style={{ fontFamily: 'var(--mono)', fontSize: '14.3px', color: 'var(--brand)' }}>{txDetail.referenceId}</span>
                <span className={`pill ${txDetail.paid ? 'ok' : 'no'}`}>{txDetail.paid ? 'Paid' : 'Declined'}</span>
              </div>
              {detailRow('Customer', txDetail.clientName || '\u2013')}
              {detailRow('Username', txDetail.username || '\u2013')}
              {detailRow('Creator', txDetail.creator || '\u2013')}
              {detailRow('Chatter', txDetail.chatter || '\u2013')}
              {detailRow('Gross', fmt(txDetail.amount))}
              {detailRow('Platform fee (' + blended + '%)', fmt(pf))}
              {detailRow('Net', <b>{fmt(net)}</b>)}
              {detailRow('Date', new Date(txDetail.ts).toLocaleString())}
              {txDetail.notes && detailRow('Notes', txDetail.notes)}
              {txDetail.refunded && (
                <div className="warnbar" style={{ marginTop: 10 }}>
                  Refunded &mdash; the sale has been reversed in the ledger.
                </div>
              )}
              <div className="modal-actions">
                {txDetail.paid && !txDetail.refunded && can('commissions.manage') && (
                  <button className="btn ghost" style={{ color: 'var(--red)', borderColor: 'rgba(233,90,90,.4)' }}
                    onClick={() => { setRefundTx(txDetail); setRefundConfirmed(false); }}>
                    Refund
                  </button>
                )}
                <span style={{ flex: 1 }} />
                <button className="btn" onClick={() => setTxDetail(null)}>Close</button>
              </div>
            </>
          );
        })()}
      </Modal>

      {/* Refund confirm modal */}
      <Modal open={!!refundTx} onClose={() => { setRefundTx(null); setRefundConfirmed(false); }}>
        {refundTx && (() => {
          const rf = rc.refundFee;
          const b = feeBreakdown(refundTx.amount, rc);
          const split = splitSale(
            { amount: refundTx.amount, creator: refundTx.creator, chatter: refundTx.chatter },
            creators, chatters, commission,
          );
          return (
            <>
              <h3>Record a refund</h3>
              <p className="sub">
                Issue the refund in the provider's dashboard first &mdash; they do not offer a refund API.
                This reverses the sale in your ledger so payouts and analytics stay correct.
              </p>
              <div style={{ background: 'var(--panel-2)', border: '1px solid var(--line)', borderRadius: 12, padding: '12px 13px', marginBottom: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13.6px', padding: '4px 0' }}>
                  <span style={{ color: 'var(--muted)' }}>Refund to customer</span><span>{fmt(refundTx.amount)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13.6px', padding: '4px 0' }}>
                  <span style={{ color: 'var(--muted)' }}>Refund fee</span><span style={{ color: 'var(--red)' }}>{fmt(rf)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13.6px', padding: '4px 0' }}>
                  <span style={{ color: 'var(--muted)' }}>Chatter commission reversed</span><span>{fmt(-split.chatterCut)}</span>
                </div>
                <div className="sub" style={{ marginTop: 8 }}>
                  Platform fees already paid ({fmt(b.total)}) are not returned by the provider.
                </div>
              </div>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 9, fontSize: '13.6px', marginBottom: 12 }}>
                <input type="checkbox" checked={refundConfirmed}
                  onChange={e => setRefundConfirmed(e.target.checked)}
                  style={{ minWidth: 'auto', width: 'auto', marginTop: 3 }} />
                <span>I have issued this refund in the provider's dashboard.</span>
              </label>
              <div className="modal-actions">
                <button className="btn ghost" onClick={() => { setRefundTx(null); setRefundConfirmed(false); }}>Cancel</button>
                <button className="btn" style={{ background: 'var(--red)', borderColor: 'var(--red)' }}
                  onClick={() => {
                    if (!refundConfirmed) { toast('Confirm you issued the refund at the provider first.'); return; }
                    doRefund(refundTx);
                  }}>
                  Record refund of {fmt(refundTx.amount)}
                </button>
              </div>
            </>
          );
        })()}
      </Modal>

      {/* Column chooser modal */}
      <Modal open={colModal} onClose={() => setColModal(false)}>
        <h3>Choose columns</h3>
        <p className="sub">Pick what shows in the transactions table.</p>
        <div style={{ maxHeight: 260, overflow: 'auto' }}>
          {PAY_COLS.map(c => (
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

      {/* Stat card picker modal */}
      <Modal open={statsModal} onClose={() => setStatsModal(false)}>
        <h3>Edit dashboard cards</h3>
        <p className="sub">Pick what you want to see at a glance. Only cards your role can access are listed.</p>
        <div style={{ maxHeight: 300, overflow: 'auto' }}>
          {availableStats.map(s => (
            <label key={s.k} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 0', fontSize: '15.4px', cursor: 'pointer' }}>
              <input type="checkbox" checked={statsPick.has(s.k)}
                onChange={e => {
                  setStatsPick(prev => {
                    const next = new Set(prev);
                    e.target.checked ? next.add(s.k) : next.delete(s.k);
                    return next;
                  });
                }}
                style={{ minWidth: 'auto', width: 'auto', cursor: 'pointer' }} />
              {s.label}
            </label>
          ))}
        </div>
        <div className="modal-actions">
          <button className="btn ghost" onClick={() => { setStatsPick(new Set(['gross', 'fee', 'net', 'rate'])); }}>Reset</button>
          <span style={{ flex: 1 }} />
          <button className="btn ghost" onClick={() => setStatsModal(false)}>Cancel</button>
          <button className="btn" onClick={applyStats}>Apply</button>
        </div>
      </Modal>
    </div>
  );
}
