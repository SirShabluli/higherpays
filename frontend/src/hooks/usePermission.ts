import { useCurrentSession } from './useCurrentSession';
import { ROLE_PERMISSIONS } from '../rbac/permissions';
import { useAppStore } from '../store/appStore';
import type { Permission, Role } from '../types';

/**
 * Returns `can(permission)` for the CURRENT session — live or demo.
 *
 * In live mode the role comes from the user's membership on the active
 * workspace; in demo mode it comes from the demo store (so the sidebar's
 * "Preview as role" switcher still works). Either way, permissions are
 * resolved from the same built-in matrix as the backend.
 *
 * Fixes the class of bug where the sidebar showed a signed-in chatter every
 * tab because `useCan` was reading demo state (`appStore.role`) instead of
 * the live membership.
 */
export function useCan(): (perm: Permission) => boolean {
  const { role } = useCurrentSession();
  const perms = ROLE_PERMISSIONS[role as Role] ?? [];
  return (perm: Permission) => perms.includes(perm);
}

/**
 * The active workspace as recorded in the demo store — kept for pages that
 * still read from the demo dataset (Analytics, Goals, Compare, Settings).
 * Once those pages are wired to live data, prefer `useCurrentSession()`.
 */
export function useActiveWorkspace() {
  const workspaces = useAppStore((s) => s.workspaces);
  const activeWsId = useAppStore((s) => s.activeWsId);
  return workspaces.find((w) => w.id === activeWsId) || workspaces[0];
}
