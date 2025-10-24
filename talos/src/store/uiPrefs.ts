import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface IUiPrefsStore {
  sidebarOpen: boolean;
  setSidebarOpen: (value: boolean) => void;

  markFilterExpanded: Record<string, boolean>;
  setMarkFilterExpanded: (key: string, value: boolean) => void;
  toggleMarkFilterExpanded: (key: string) => void;
}

export const useUiPrefsStore = create<IUiPrefsStore>()(
  persist(
    (set, get) => ({
      sidebarOpen: false,
      setSidebarOpen: (value) => set({ sidebarOpen: value }),

      markFilterExpanded: {},
      setMarkFilterExpanded: (key, value) =>
        set((state) => ({
          markFilterExpanded: { ...state.markFilterExpanded, [key]: value },
        })),
      toggleMarkFilterExpanded: (key) => {
        const current = get().markFilterExpanded[key] ?? false;
        get().setMarkFilterExpanded(key, !current);
      },
    }),
    {
      name: 'ui-prefs',
      partialize: (state) => ({
        sidebarOpen: state.sidebarOpen,
        markFilterExpanded: state.markFilterExpanded,
      }),
    },
  ),
);

export const useSidebarOpen = () => useUiPrefsStore((s) => s.sidebarOpen);
export const useSetSidebarOpen = () => useUiPrefsStore((s) => s.setSidebarOpen);
export const useMarkFilterExpanded = (key: string) =>
  useUiPrefsStore((s) => s.markFilterExpanded[key] ?? false);
export const useToggleMarkFilterExpanded = () =>
  useUiPrefsStore((s) => s.toggleMarkFilterExpanded);
