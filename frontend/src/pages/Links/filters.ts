import type { PaymentLink, LinkStatus } from '../../types';

/**
 * Payment links created but not paid within this window are treated as expired
 * in the UI. The provider still owns the source of truth, but this lets the
 * table stay accurate between reconciles.
 */
export const LINK_TTL_MS = 10 * 60 * 1000;

export function effectiveLinkStatus(l: PaymentLink): LinkStatus {
  if (l.status === 'Created' && Date.now() - l.ts > LINK_TTL_MS) return 'Expired';
  return l.status;
}

export interface LinksFilters {
  creator: string;
  chatter: string;
  status: '' | LinkStatus;
  min: string;
  max: string;
  from: string;
  to: string;
  search: string;
}

export const DEFAULT_FILTERS: LinksFilters = {
  creator: '', chatter: '', status: '',
  min: '', max: '', from: '', to: '', search: '',
};

export function filterLinks(rows: PaymentLink[], f: LinksFilters): PaymentLink[] {
  const q = f.search.trim().toLowerCase();
  const min = parseFloat(f.min);
  const max = parseFloat(f.max);
  const fromTs = f.from ? new Date(`${f.from}T00:00:00`).getTime() : null;
  const toTs = f.to ? new Date(`${f.to}T23:59:59`).getTime() : null;

  return rows.filter((l) => {
    if (f.creator && l.creator !== f.creator) return false;
    if (f.chatter && l.chatter !== f.chatter) return false;
    if (f.status && effectiveLinkStatus(l) !== f.status) return false;
    if (!Number.isNaN(min) && l.amount < min) return false;
    if (!Number.isNaN(max) && l.amount > max) return false;
    if (fromTs && l.ts < fromTs) return false;
    if (toTs && l.ts > toTs) return false;
    if (q && !(`${l.customerName}${l.customerUsername}`).toLowerCase().includes(q)) return false;
    return true;
  });
}
