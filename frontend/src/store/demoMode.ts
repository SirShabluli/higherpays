/**
 * Whether the user opted into offline demo mode.
 *
 * Demo mode is now an explicit choice on the login screen. It replaces the
 * old "always start in demo state" behaviour, which made the app impossible
 * to reason about and hid the fact that no data was ever hitting the API.
 *
 * The presence of a stored `true` here lets a page decide whether to read
 * from the demo store (`legacyStore.ts`) or from React Query. It is
 * intentionally *not* persisted — closing the tab ends the demo.
 */

import { create } from 'zustand';

interface DemoState {
  enabled: boolean;
  enable: () => void;
  disable: () => void;
}

export const useDemoModeStore = create<DemoState>((set) => ({
  enabled: false,
  enable: () => set({ enabled: true }),
  disable: () => set({ enabled: false }),
}));
