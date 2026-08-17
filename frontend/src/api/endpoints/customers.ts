import { api } from '../http';
import { workspacePath } from '../workspacePath';

export type CustomerSegment = 'new' | 'regular' | 'high_value' | 'vip' | 'inactive' | 'at_risk';

export interface CustomerListItem {
  id: string;
  alias: string;
  email: string | null;
  creatorId: string | null;
  segment: CustomerSegment;
  totalSpend: number;
  lastPurchaseAt: string | null;
  createdAt: string;
}

interface RawCustomer {
  id: string;
  alias: string;
  email: string | null;
  creator_id: string | null;
  segment: CustomerSegment;
  total_spend: number | string;
  last_purchase_at: string | null;
  created_at: string;
}

function normalize(c: RawCustomer): CustomerListItem {
  return {
    id: c.id,
    alias: c.alias,
    email: c.email,
    creatorId: c.creator_id,
    segment: c.segment,
    totalSpend: typeof c.total_spend === 'string' ? parseFloat(c.total_spend) : c.total_spend,
    lastPurchaseAt: c.last_purchase_at,
    createdAt: c.created_at,
  };
}

export interface ListCustomersQuery {
  segment?: CustomerSegment;
  q?: string;
  creatorId?: string;
  limit?: number;
  offset?: number;
}

export const customersApi = {
  async list(query: ListCustomersQuery = {}): Promise<{ customers: CustomerListItem[]; limit: number; offset: number }> {
    const qs = new URLSearchParams();
    if (query.segment) qs.set('segment', query.segment);
    if (query.q) qs.set('q', query.q);
    if (query.creatorId) qs.set('creatorId', query.creatorId);
    if (query.limit != null) qs.set('limit', String(query.limit));
    if (query.offset != null) qs.set('offset', String(query.offset));
    const suffix = qs.toString() ? `/customers?${qs.toString()}` : '/customers';

    const raw = await api.get<{ customers: RawCustomer[]; limit: number; offset: number }>(
      workspacePath(suffix),
    );
    return {
      customers: raw.customers.map(normalize),
      limit: raw.limit,
      offset: raw.offset,
    };
  },
};
