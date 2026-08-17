import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '../../store/appStore';
import { useCurrentSession } from '../../hooks/useCurrentSession';
import { membershipsApi, type Chatter as ApiChatter } from '../../api/endpoints';
import type { Chatter } from '../../types';

function apiToLegacyChatter(a: ApiChatter): Chatter {
  return {
    id: a.membershipId,
    name: a.name,
    email: a.email,
    status: a.status,
    shift: a.shift,
    // The backend does not currently return per-membership creator
    // assignments; the demo shape needs the list to render, so we leave it
    // empty until the API grows an assignments endpoint.
    assigned: [],
    commissionPct: a.commissionPct ?? 0,
  };
}

export interface UseTeamDataResult {
  chatters: Chatter[];
  isLoading: boolean;
  isError: boolean;
  setCommission: (chatterId: string, commissionPct: number) => Promise<void>;
}

export function useTeamData(): UseTeamDataResult {
  const { isDemo, activeWorkspaceId } = useCurrentSession();
  const demoChatters = useAppStore((s) => s.chatters);
  const updateDemo = useAppStore((s) => s.updateState);
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ['team-chatters', activeWorkspaceId],
    queryFn: () => membershipsApi.listChatters(),
    enabled: !isDemo && Boolean(activeWorkspaceId),
  });

  const commissionMutation = useMutation({
    mutationFn: (args: { membershipId: string; commissionPct: number }) =>
      membershipsApi.setCommissionPct(args.membershipId, args.commissionPct),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['team-chatters', activeWorkspaceId] }),
  });

  const live = useMemo(
    () => (query.data ?? []).map(apiToLegacyChatter),
    [query.data],
  );

  return {
    chatters: isDemo ? demoChatters : live,
    isLoading: !isDemo && query.isLoading,
    isError: !isDemo && query.isError,

    setCommission: async (chatterId, commissionPct) => {
      const clamped = Math.min(100, Math.max(0, commissionPct));
      if (isDemo) {
        const next = demoChatters.map((c) =>
          c.id === chatterId ? { ...c, commissionPct: clamped } : c,
        );
        updateDemo({ chatters: next });
        return;
      }
      await commissionMutation.mutateAsync({ membershipId: chatterId, commissionPct: clamped });
    },
  };
}
