import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAppStore } from '../../store/appStore';
import { useCurrentSession } from '../../hooks/useCurrentSession';
import {
  customersApi,
  type CustomerListItem,
  type CustomerSegment as ApiSegment,
} from '../../api/endpoints';
import type { Customer, CustomerSegment as UiSegment } from '../../types';

const API_TO_UI_SEGMENT: Record<ApiSegment, UiSegment> = {
  new: 'New',
  regular: 'Regular',
  high_value: 'High value',
  vip: 'VIP',
  inactive: 'Inactive',
  at_risk: 'At-risk',
};

function apiToLegacyCustomer(c: CustomerListItem, creatorNameById: Map<string, string>): Customer {
  return {
    id: c.id,
    name: c.alias,
    username: c.alias.startsWith('@') ? c.alias : `@${c.alias}`,
    email: c.email ?? '',
    creator: (c.creatorId && creatorNameById.get(c.creatorId)) ?? '',
    chatter: '',
    spend: c.totalSpend,
    purchases: 0,
    last: c.lastPurchaseAt ? Date.parse(c.lastPurchaseAt) : 0,
    seg: API_TO_UI_SEGMENT[c.segment] ?? 'New',
  };
}

export interface UseCustomersDataResult {
  customers: Customer[];
  isLoading: boolean;
  isError: boolean;
}

export function useCustomersData(): UseCustomersDataResult {
  const { isDemo, activeWorkspaceId } = useCurrentSession();
  const demoCustomers = useAppStore((s) => s.customers);
  const demoCreators = useAppStore((s) => s.creators);

  const query = useQuery({
    queryKey: ['customers', activeWorkspaceId],
    queryFn: () => customersApi.list({ limit: 500 }),
    enabled: !isDemo && Boolean(activeWorkspaceId),
  });

  const creatorNameById = useMemo(
    () => new Map(demoCreators.map((c) => [c.id, c.name])),
    [demoCreators],
  );

  const live = useMemo(
    () => (query.data?.customers ?? []).map((c) => apiToLegacyCustomer(c, creatorNameById)),
    [query.data, creatorNameById],
  );

  return {
    customers: isDemo ? demoCustomers : live,
    isLoading: !isDemo && query.isLoading,
    isError: !isDemo && query.isError,
  };
}
