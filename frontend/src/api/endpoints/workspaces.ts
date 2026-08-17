import { api } from '../http';
import { workspacePath } from '../workspacePath';

/** Response from `GET /workspaces/:wid/platform-fee`. */
export interface PlatformFee {
  blendedRatePct: number;
  pspFixedFee: number;
  refundFee: number;
  chargebackFee: number;
  declineFee: number;
  reservePct: number;
  reserveReleaseDays: number;
  providerRefundAvailable: boolean;
  /** Only present when the caller is a platform operator. */
  pspRatePct?: number;
  marginRatePct?: number;
}

export interface LinkLimits {
  minLinkAmount: number | null;
  maxLinkAmount: number | null;
  providerMinimum: number;
}

export interface WorkspacePermissions {
  workspaceId: string;
  role: string;
  permissions: string[];
}

export const workspacesApi = {
  getPlatformFee: () =>
    api.get<PlatformFee>(workspacePath('/platform-fee')),

  getLinkLimits: () =>
    api.get<LinkLimits>(workspacePath('/link-limits')),

  setLinkLimits: (input: { minLinkAmount?: number | null; maxLinkAmount?: number | null }) =>
    api.patch<LinkLimits>(workspacePath('/link-limits'), input),

  getPermissions: () =>
    api.get<WorkspacePermissions>(workspacePath('/permissions')),

  rename: (name: string) =>
    api.patch<{ id: string; name: string }>(workspacePath(''), { name }),
};
