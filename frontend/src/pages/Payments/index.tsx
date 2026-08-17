/**
 * Payments page.
 *
 * Thin view over `usePaymentsData` (which decides demo vs. live) + the shared
 * UI kit. The old page was ~460 lines and hand-rolled its own layout, filter
 * bar, table, and stat grid; that logic now lives in shared modules.
 */

import { useMemo, useState } from 'react';
import { useCan } from '../../hooks/usePermission';
import { useRateCard } from '../../hooks/useRateCard';
import { useAppStore } from '../../store/appStore';
import { splitSale } from '../../business/splitSale';
import { feeBreakdown } from '../../business/feeBreakdown';
import { formatMoney } from '../../lib/format';
import Modal from '../../components/Modal';
import { toast } from '../../components/Toast';
import {
  PageHeader, StatCard, StatGrid, Money, Pill, DateCell,
  DataTable, FilterBar, DateRangePicker, DetailRow,
  type Column, type DateRange,
} from '../../components/ui';
import type { Transaction } from '../../types';
import { usePaymentsData } from './usePaymentsData';
import { filterTransactions, DEFAULT_FILTERS, type PaymentsFilters } from './filters';

export default function PaymentsPage() {
  const can = useCan();
  const { transactions, isLoading } = usePaymentsData();
  const { rateCard: rc } = useRateCard();
  const creators = useAppStore((s) => s.creators);
  const chatters = useAppStore((s) => s.chatters);
  const commission = useAppStore((s) => s.commission);
  const updateStateDemo = useAppStore((s) => s.updateState);
  const demoTx = useAppStore((s) => s.transactions);

  const [filters, setFilters] = useState<PaymentsFilters>(DEFAULT_FILTERS);
  const [detail, setDetail] = useState<Transaction | null>(null);
  const [refunding, setRefunding] = useState<Transaction | null>(null);
  const [refundConfirmed, setRefundConfirmed] = useState(false);

  const platFee = (g: number) => (g * rc.blended) / 100;

  const filtered = useMemo(
    () => filterTransactions(transactions, filters),
    [transactions, filters],
  );
  const paid = useMemo(() => filtered.filter((t) => t.paid), [filtered]);
  const gross = useMemo(() => paid.reduce((s, t) => s + t.amount, 0), [paid]);
  const fee = platFee(gross);
  const splits = useMemo(
    () => paid.map((t) => splitSale(
      { amount: t.amount, creator: t.creator, chatter: t.chatter },
      creators, chatters, commission,
    )),
    [paid, creators, chatters, commission],
  );
  const dueCreators = splits.reduce((s, x) => s + x.creatorCut, 0);
  const dueTeam = splits.reduce((s, x) => s + x.chatterCut, 0);

  const range: DateRange = { from: filters.from, to: filters.to };
  const setRange = (r: DateRange) => setFilters((f) => ({ ...f, ...r }));
  const clearFilters = () => setFilters(DEFAULT_FILTERS);

  const columns: Column<Transaction>[] = [
    { key: 'reference', header: 'Reference', render: (t) => <span className="ref">{t.referenceId}</span> },
    { key: 'customer', header: 'Customer', render: (t) => <span className="cname">{t.clientName || '—'}</span> },
    { key: 'chatter', header: 'Chatter', render: (t) => t.chatter || '—' },
    { key: 'gross', header: 'Gross', align: 'right', render: (t) => <Money amount={t.amount} /> },
    {
      key: 'status', header: 'Status',
      render: (t) => <Pill tone={t.paid ? 'ok' : 'no'}>{t.paid ? 'Paid' : 'Declined'}</Pill>,
    },
    { key: 'date', header: 'Date', render: (t) => <DateCell ts={t.ts} /> },
  ];

  const recordRefund = (t: Transaction) => {
    const next = demoTx.map((x) => (x.id === t.id ? { ...x, refunded: true, paid: false } : x));
    updateStateDemo({ transactions: next });
    setRefunding(null); setDetail(null); setRefundConfirmed(false);
    toast(`Refunded ${formatMoney(t.amount)} (demo).`);
  };

  return (
    <div>
      <PageHeader
        title="Payments"
        subtitle="Every transaction that hit your account, with fees and payout splits."
        actions={
          can('payments.export') ? (
            <button className="btn ghost" onClick={() => toast('Export coming soon.')}>Export</button>
          ) : null
        }
      />

      <StatGrid>
        <StatCard label="Gross volume" value={<Money amount={gross} />} sub="What customers paid" up />
        <StatCard label="Platform fee" value={<Money amount={fee} />} sub={`Platform fee ${rc.blended.toFixed(1)}%`} />
        <StatCard label="Net" value={<Money amount={gross - fee} />} sub="After platform fees" up />
        <StatCard
          label="Approval rate"
          value={`${filtered.length ? Math.round((paid.length / filtered.length) * 100) : 0}%`}
          sub={`${paid.length} of ${filtered.length}`}
        />
        {can('commissions.view') && (
          <>
            <StatCard
              label="Creator due payments"
              value={<Money amount={dueCreators} />}
              color="var(--mint)"
              sub={`${new Set(paid.map((t) => t.creator).filter(Boolean)).size} in view`}
            />
            <StatCard
              label="Team's due payments"
              value={<Money amount={dueTeam} />}
              color="var(--brand)"
              sub={`${new Set(paid.map((t) => t.chatter).filter(Boolean)).size} chatters`}
            />
          </>
        )}
      </StatGrid>

      <FilterBar>
        <select
          value={filters.status}
          onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value as PaymentsFilters['status'] }))}
        >
          <option value="">All statuses</option>
          <option value="paid">Paid</option>
          <option value="declined">Declined</option>
        </select>
        <DateRangePicker value={range} onChange={setRange} />
        <input
          type="search"
          placeholder="Search reference, customer…"
          value={filters.search}
          onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
          style={{ maxWidth: 240 }}
        />
        <button className="btn ghost" onClick={clearFilters}>Clear</button>
      </FilterBar>

      <DataTable
        columns={columns}
        rows={filtered}
        rowKey={(t) => t.id}
        onRowClick={setDetail}
        isLoading={isLoading}
        emptyTitle="No transactions match these filters."
        emptyHint="Try widening the date range or clearing filters."
        footer={`Showing ${filtered.length}`}
      />

      <Modal open={!!detail && !refunding} onClose={() => setDetail(null)}>
        {detail ? (() => {
          const pf = platFee(detail.amount);
          return (
            <>
              <h3>Transaction detail</h3>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '2px 0 12px' }}>
                <span style={{ fontFamily: 'var(--mono)', fontSize: '14.3px', color: 'var(--brand)' }}>{detail.referenceId}</span>
                <Pill tone={detail.paid ? 'ok' : 'no'}>{detail.paid ? 'Paid' : 'Declined'}</Pill>
              </div>
              <DetailRow label="Customer">{detail.clientName || '—'}</DetailRow>
              <DetailRow label="Creator">{detail.creator || '—'}</DetailRow>
              <DetailRow label="Chatter">{detail.chatter || '—'}</DetailRow>
              <DetailRow label="Gross"><Money amount={detail.amount} /></DetailRow>
              <DetailRow label={`Platform fee (${rc.blended.toFixed(1)}%)`}><Money amount={pf} /></DetailRow>
              <DetailRow label="Net"><Money amount={detail.amount - pf} emphasis /></DetailRow>
              <DetailRow label="Date">{new Date(detail.ts).toLocaleString()}</DetailRow>
              {detail.refunded && (
                <div className="warnbar" style={{ marginTop: 10 }}>
                  Refunded — the sale has been reversed in the ledger.
                </div>
              )}
              <div className="modal-actions">
                {detail.paid && !detail.refunded && can('commissions.manage') && (
                  <button
                    className="btn ghost"
                    style={{ color: 'var(--red)', borderColor: 'rgba(233,90,90,.4)' }}
                    onClick={() => { setRefunding(detail); setRefundConfirmed(false); }}
                  >
                    Refund
                  </button>
                )}
                <span style={{ flex: 1 }} />
                <button className="btn" onClick={() => setDetail(null)}>Close</button>
              </div>
            </>
          );
        })() : null}
      </Modal>

      <Modal open={!!refunding} onClose={() => { setRefunding(null); setRefundConfirmed(false); }}>
        {refunding ? (() => {
          const b = feeBreakdown(refunding.amount, rc);
          const split = splitSale(
            { amount: refunding.amount, creator: refunding.creator, chatter: refunding.chatter },
            creators, chatters, commission,
          );
          return (
            <>
              <h3>Record a refund</h3>
              <p className="sub">
                Issue the refund in the provider's dashboard first. This reverses the sale in your ledger so payouts stay correct.
              </p>
              <div style={{ background: 'var(--panel-2)', border: '1px solid var(--line)', borderRadius: 12, padding: '12px 13px', marginBottom: 14 }}>
                <DetailRow label="Refund to customer"><Money amount={refunding.amount} /></DetailRow>
                <DetailRow label="Refund fee"><span style={{ color: 'var(--red)' }}><Money amount={rc.refundFee} /></span></DetailRow>
                <DetailRow label="Chatter commission reversed"><Money amount={-split.chatterCut} /></DetailRow>
                <div className="sub" style={{ marginTop: 8 }}>
                  Platform fees already paid ({formatMoney(b.total)}) are not returned by the provider.
                </div>
              </div>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 9, fontSize: '13.6px', marginBottom: 12 }}>
                <input
                  type="checkbox"
                  checked={refundConfirmed}
                  onChange={(e) => setRefundConfirmed(e.target.checked)}
                  style={{ minWidth: 'auto', width: 'auto', marginTop: 3 }}
                />
                <span>I have issued this refund in the provider's dashboard.</span>
              </label>
              <div className="modal-actions">
                <button className="btn ghost" onClick={() => { setRefunding(null); setRefundConfirmed(false); }}>Cancel</button>
                <button
                  className="btn"
                  style={{ background: 'var(--red)', borderColor: 'var(--red)' }}
                  onClick={() => {
                    if (!refundConfirmed) { toast('Confirm you issued the refund at the provider first.'); return; }
                    recordRefund(refunding);
                  }}
                >
                  Record refund of {formatMoney(refunding.amount)}
                </button>
              </div>
            </>
          );
        })() : null}
      </Modal>
    </div>
  );
}
