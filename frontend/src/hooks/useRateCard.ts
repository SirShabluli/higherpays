/**
 * The workspace's active rate card (blended fee %, PSP fixed fee, refund fee,
 * reserve, etc.).
 *
 * In demo mode we compute it from the local `Workspace` object. In live mode
 * we fetch the platform-fee response from the API and translate it into the
 * same shape the rest of the app already understands. That way the pages
 * don't need two code paths.
 */

import { useQuery } from '@tanstack/react-query';
import { workspacesApi, type PlatformFee } from '../api/endpoints';
import type { RateCard, Workspace } from '../types';
import { defaultRateCard } from '../business/rateCard';
import { useCurrentSession } from './useCurrentSession';
import { useAppStore } from '../store/appStore';

function platformFeeToRateCard(f: PlatformFee): RateCard {
  const psp = f.pspRatePct ?? null;
  const margin = f.marginRatePct ?? null;
  return {
    blended: f.blendedRatePct,
    psp,
    margin,
    fixed: f.pspFixedFee,
    refundFee: f.refundFee,
    chargebackFee: f.chargebackFee,
    declineFee: f.declineFee,
    reservePct: f.reservePct,
    reserveReleaseDays: f.reserveReleaseDays,
  };
}

interface UseRateCardResult {
  rateCard: RateCard;
  isLoading: boolean;
  isError: boolean;
  providerRefundAvailable: boolean;
}

const EMPTY_RATE_CARD: RateCard = defaultRateCard(undefined);

export function useRateCard(): UseRateCardResult {
  const { isDemo, activeWorkspaceId } = useCurrentSession();
  const demoWorkspaces = useAppStore((s) => s.workspaces) as Workspace[];
  const demoActive = useAppStore((s) => s.activeWsId);

  const query = useQuery({
    queryKey: ['platform-fee', activeWorkspaceId],
    queryFn: () => workspacesApi.getPlatformFee(),
    enabled: !isDemo && Boolean(activeWorkspaceId),
    staleTime: 5 * 60_000,
  });

  if (isDemo) {
    const ws = demoWorkspaces.find((w) => w.id === demoActive) ?? demoWorkspaces[0];
    return {
      rateCard: defaultRateCard(ws),
      isLoading: false,
      isError: false,
      providerRefundAvailable: false,
    };
  }

  return {
    rateCard: query.data ? platformFeeToRateCard(query.data) : EMPTY_RATE_CARD,
    isLoading: query.isLoading,
    isError: query.isError,
    providerRefundAvailable: query.data?.providerRefundAvailable ?? false,
  };
}
