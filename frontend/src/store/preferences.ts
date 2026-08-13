/**
 * User preferences — things that survive login/logout and travel with the browser.
 *
 * Kept separate from `authStore` so signing out doesn't reset the user's
 * timezone or density choices.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type TzMode = 'auto' | 'manual';

interface PreferencesState {
  tzMode: TzMode;
  tzManual: string | null;

  setTz: (mode: TzMode, manual?: string | null) => void;
}

export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({
      tzMode: 'auto',
      tzManual: null,

      setTz: (mode, manual) => set({ tzMode: mode, tzManual: manual ?? null }),
    }),
    {
      name: 'higherpays.preferences',
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
