import { useAppStore } from '../store/appStore';
import type { Permission } from '../types';

export function useCan(): (perm: Permission) => boolean {
  const role = useAppStore(s => s.role);
  const roles = useAppStore(s => s.roles);
  return (perm: Permission) => (roles[role] || []).includes(perm);
}

export function useActiveWorkspace() {
  const workspaces = useAppStore(s => s.workspaces);
  const activeWsId = useAppStore(s => s.activeWsId);
  const mode = useAppStore(s => s.mode);
  if (mode === 'demo') return workspaces.find(w => w.id === activeWsId) || workspaces[0];
  return workspaces.find(w => w.id === activeWsId) || workspaces[0];
}
