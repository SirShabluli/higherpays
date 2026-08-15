/**
 * Unified view of "who am I, where am I, and how am I connected?".
 *
 * Pages should read from this hook rather than three different stores. Handles
 * both real (authenticated) sessions and offline demo mode, so pages can be
 * written once and work in either.
 */

import { useAuthStore } from '../store/auth';
import { useSessionStore } from '../store/session';
import { useDemoModeStore } from '../store/demoMode';
import { useAppStore } from '../store/appStore';
import type { Role, AuthWorkspace } from '../api/types';

export interface CurrentSession {
  isDemo: boolean;
  isAuthenticated: boolean;
  userName: string;
  role: Role;
  activeWorkspaceId: string | null;
  activeWorkspace: AuthWorkspace | null;
  workspaces: AuthWorkspace[];
  currency: string;
}

export function useCurrentSession(): CurrentSession {
  const isDemo = useDemoModeStore((s) => s.enabled);
  const authUser = useAuthStore((s) => s.user);
  const authWorkspaces = useAuthStore((s) => s.workspaces);
  const activeWorkspaceId = useSessionStore((s) => s.activeWorkspaceId);
  const demoRole = useAppStore((s) => s.role);
  const demoWorkspaces = useAppStore((s) => s.workspaces);
  const demoActive = useAppStore((s) => s.activeWsId);

  if (isDemo) {
    const active = demoWorkspaces.find((w) => w.id === demoActive) ?? demoWorkspaces[0] ?? null;
    const asAuth: AuthWorkspace[] = demoWorkspaces.map((w) => ({
      id: w.id,
      name: w.name,
      role: demoRole,
      currency: 'EUR',
    }));
    return {
      isDemo: true,
      isAuthenticated: false,
      userName: 'Demo user',
      role: demoRole,
      activeWorkspaceId: active?.id ?? null,
      activeWorkspace: active
        ? { id: active.id, name: active.name, role: demoRole, currency: 'EUR' }
        : null,
      workspaces: asAuth,
      currency: 'EUR',
    };
  }

  const active =
    authWorkspaces.find((w) => w.id === activeWorkspaceId) ??
    authWorkspaces[0] ??
    null;

  return {
    isDemo: false,
    isAuthenticated: Boolean(authUser),
    userName: authUser?.fullName ?? 'Signed in',
    role: (active?.role ?? 'analyst') as Role,
    activeWorkspaceId: active?.id ?? null,
    activeWorkspace: active,
    workspaces: authWorkspaces,
    currency: active?.currency ?? 'EUR',
  };
}
