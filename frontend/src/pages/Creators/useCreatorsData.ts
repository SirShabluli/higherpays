/**
 * Creators list — demo store OR live API.
 *
 * Emits the legacy `Creator` shape the page component already understands so
 * we don't have to rewrite every field access. Also exposes `create`/`update`
 * mutations that call the API in live mode and mutate the demo store in
 * offline mode.
 */

import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '../../store/appStore';
import { useCurrentSession } from '../../hooks/useCurrentSession';
import {
  creatorsApi,
  type Creator as ApiCreator,
  type CreateCreatorInput,
} from '../../api/endpoints';
import type { Creator, RevenueModel, CreatorStatus } from '../../types';

const COLORS = ['#F4707A', '#B98CFF', '#4ADE9E', '#15C3AF', '#F5C451'];

function apiToLegacyCreator(a: ApiCreator, idx: number): Creator {
  return {
    id: a.id,
    name: a.stageName,
    handle: a.handle ?? `@${a.stageName.toLowerCase().replace(/\s+/g, '')}`,
    color: COLORS[idx % COLORS.length] ?? COLORS[0]!,
    status: a.status as CreatorStatus,
    revModel: a.revenueModel,
    splitCreator: a.revenueSplitPct,
    salary: a.salary ?? undefined,
    salaryInc: a.salaryIncreasePct ?? undefined,
    mrr: 0,
  };
}

export interface CreateCreatorForm {
  name: string;
  handle?: string;
  revModel: RevenueModel;
  splitCreator?: number;
  salary?: number;
  salaryInc?: number;
  status?: 'active' | 'suspended';
}

export interface UseCreatorsDataResult {
  creators: Creator[];
  isLoading: boolean;
  isError: boolean;
  create: (input: CreateCreatorForm) => Promise<void>;
  updateStatus: (id: string, status: CreatorStatus) => Promise<void>;
  updateSplit: (id: string, revenueSplitPct: number) => Promise<void>;
}

export function useCreatorsData(): UseCreatorsDataResult {
  const { isDemo, activeWorkspaceId } = useCurrentSession();
  const demoCreators = useAppStore((s) => s.creators);
  const updateDemo = useAppStore((s) => s.updateState);
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ['creators', activeWorkspaceId],
    queryFn: () => creatorsApi.list(),
    enabled: !isDemo && Boolean(activeWorkspaceId),
  });

  const createMutation = useMutation({
    mutationFn: (input: CreateCreatorInput) => creatorsApi.create(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['creators', activeWorkspaceId] }),
  });

  const updateMutation = useMutation({
    mutationFn: (args: { id: string; patch: Partial<CreateCreatorInput> & { status?: CreatorStatus } }) =>
      creatorsApi.update(args.id, args.patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['creators', activeWorkspaceId] }),
  });

  const liveCreators = useMemo(
    () => (query.data ?? []).map(apiToLegacyCreator),
    [query.data],
  );

  return {
    creators: isDemo ? demoCreators : liveCreators,
    isLoading: !isDemo && query.isLoading,
    isError: !isDemo && query.isError,

    create: async (input) => {
      if (isDemo) {
        const handle = input.handle?.trim().startsWith('@')
          ? input.handle
          : input.handle
            ? `@${input.handle}`
            : `@${input.name.toLowerCase().replace(/\s+/g, '')}`;
        const next: Creator = {
          id: `cr${demoCreators.length + 1}`,
          name: input.name,
          handle: handle!,
          color: COLORS[demoCreators.length % COLORS.length]!,
          status: input.status === 'suspended' ? 'suspended' : 'active',
          revModel: input.revModel,
          splitCreator: input.revModel === 'revshare' ? (input.splitCreator ?? 70) : 0,
          salary: input.salary,
          salaryInc: input.salaryInc,
          mrr: 0,
        };
        updateDemo({ creators: [...demoCreators, next] });
        return;
      }
      await createMutation.mutateAsync({
        stageName: input.name,
        handle: input.handle,
        revenueModel: input.revModel,
        revenueSplitPct: input.splitCreator,
        salary: input.salary,
        salaryIncreasePct: input.salaryInc,
      });
    },

    updateStatus: async (id, status) => {
      if (isDemo) {
        const next = demoCreators.map((c) => (c.id === id ? { ...c, status } : c));
        updateDemo({ creators: next });
        return;
      }
      await updateMutation.mutateAsync({ id, patch: { status } });
    },

    updateSplit: async (id, revenueSplitPct) => {
      if (isDemo) {
        const next = demoCreators.map((c) =>
          c.id === id ? { ...c, splitCreator: revenueSplitPct } : c,
        );
        updateDemo({ creators: next });
        return;
      }
      await updateMutation.mutateAsync({ id, patch: { revenueSplitPct } });
    },
  };
}
