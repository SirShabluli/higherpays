import { api } from '../http';
import { workspacePath } from '../workspacePath';

export type ChatterStatus = 'active' | 'offline';
export type ChatterShift = 'Day' | 'Night';

/**
 * A chatter membership. The backend calls the endpoint "memberships" but the
 * response is scoped to chatter-role users only; other role rows are dropped.
 */
export interface Chatter {
  membershipId: string;
  name: string;
  email: string;
  status: ChatterStatus;
  shift: ChatterShift;
  commissionPct: number | null;
}

interface RawChatter {
  membershipId: string;
  name: string;
  email: string;
  status: ChatterStatus;
  shift: ChatterShift;
  commissionPct: number | string | null;
}

function toNullableNumber(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === 'string' ? parseFloat(v) : (v as number);
  return Number.isFinite(n) ? n : null;
}

export const membershipsApi = {
  async listChatters(): Promise<Chatter[]> {
    const raw = await api.get<{ chatters: RawChatter[] }>(workspacePath('/memberships'));
    return raw.chatters.map((c) => ({
      membershipId: c.membershipId,
      name: c.name,
      email: c.email,
      status: c.status,
      shift: c.shift,
      commissionPct: toNullableNumber(c.commissionPct),
    }));
  },

  async setCommissionPct(membershipId: string, commissionPct: number | null) {
    return api.patch<{ id: string; commissionPct: number | null }>(
      workspacePath(`/memberships/${membershipId}`),
      { commissionPct },
    );
  },
};
