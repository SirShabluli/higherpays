import { create } from 'zustand';
import type {
  Role, Permission, Brand, Workspace, Creator, Chatter, Member, Customer,
  PaymentLink, Transaction, Commission, LinkLimits, MyWorkspace,
  Reserve, Fees, GoalTarget, Settlement,
} from '../types';
import { createDemoState } from '../demo/generators';

interface AppStore {
  // Mode
  mode: 'demo' | 'live';

  // Auth
  token: string | null;
  refreshToken: string | null;
  twoFactorEnabled: boolean;

  // Core state
  brand: Brand;
  role: Role;
  workspaces: Workspace[];
  members: Member[];
  creators: Creator[];
  chatters: Chatter[];
  customers: Customer[];
  links: PaymentLink[];
  transactions: Transaction[];
  commission: Commission;
  linkLimits: LinkLimits;
  activeWsId: string;
  myWorkspaces: MyWorkspace[];
  roles: Record<string, Permission[]>;

  // Optional state
  reserve?: Reserve;
  fees?: Fees;
  platformBlended?: number;
  identity?: { chatter?: string; creator?: string };
  targets?: GoalTarget[];
  settlements?: Settlement[];

  // Timezone
  tzMode: 'auto' | 'manual';
  tzManual: string | null;

  // Actions
  setRole: (role: Role) => void;
  setActiveWorkspace: (wsId: string) => void;
  setMode: (mode: 'demo' | 'live') => void;
  setAuth: (token: string, refreshToken: string) => void;
  clearAuth: () => void;
  setTz: (mode: 'auto' | 'manual', manual?: string) => void;
  loadDemoState: () => void;
  updateState: (partial: Partial<AppStore>) => void;
}

const demoState = createDemoState();

export const useAppStore = create<AppStore>((set) => ({
  mode: 'demo',
  token: null,
  refreshToken: null,
  twoFactorEnabled: false,

  brand: demoState.brand,
  role: demoState.role,
  workspaces: demoState.workspaces,
  members: demoState.members,
  creators: demoState.creators,
  chatters: demoState.chatters,
  customers: demoState.customers,
  links: demoState.links,
  transactions: demoState.transactions,
  commission: demoState.commission,
  linkLimits: demoState.linkLimits,
  activeWsId: demoState.activeWsId,
  myWorkspaces: demoState.myWorkspaces,
  roles: demoState.roles,

  tzMode: 'auto',
  tzManual: null,

  setRole: (role) => set({ role }),
  setActiveWorkspace: (wsId) => set({ activeWsId: wsId }),
  setMode: (mode) => set({ mode }),
  setAuth: (token, refreshToken) => set({ token, refreshToken, mode: 'live' }),
  clearAuth: () => set({ token: null, refreshToken: null, mode: 'demo' }),
  setTz: (mode, manual) => set({ tzMode: mode, tzManual: manual ?? null }),
  loadDemoState: () => {
    const s = createDemoState();
    set({
      mode: 'demo',
      brand: s.brand,
      role: s.role,
      workspaces: s.workspaces,
      members: s.members,
      creators: s.creators,
      chatters: s.chatters,
      customers: s.customers,
      links: s.links,
      transactions: s.transactions,
      commission: s.commission,
      linkLimits: s.linkLimits,
      activeWsId: s.activeWsId,
      myWorkspaces: s.myWorkspaces,
      roles: s.roles,
      reserve: undefined,
      fees: undefined,
      platformBlended: undefined,
      targets: undefined,
      settlements: undefined,
    });
  },
  updateState: (partial) => set(partial),
}));
