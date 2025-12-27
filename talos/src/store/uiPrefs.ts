import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface IUiPrefsStore {
  sidebarOpen: boolean;
  setSidebarOpen: (value: boolean) => void;

  markFilterExpanded: Record<string, boolean>;
  setMarkFilterExpanded: (key: string, value: boolean) => void;
  toggleMarkFilterExpanded: (key: string) => void;

  // Persistent custom order of mark filters (array of idKey)
  markFilterOrder: string[];
  setMarkFilterOrder: (order: string[]) => void;

  // Trigger states (persistent)
  triggerCluster: boolean;
  triggerBoundary: boolean;
  triggerlabelName: boolean;
  setTriggerCluster: (value: boolean) => void;
  setTriggerBoundary: (value: boolean) => void;
  setTriggerlabelName: (value: boolean) => void;

  // User Guide States (Transient)
  drawerSnapIndex: number | null;
  setDrawerSnapIndex: (index: number | null) => void;
  forceSubregionOpen: boolean;
  setForceSubregionOpen: (value: boolean) => void;
  forceDetailOpen: boolean;
  setForceDetailOpen: (value: boolean) => void;
  isUserGuideOpen: boolean;
  setIsUserGuideOpen: (value: boolean) => void;

  // Theme
  theme: 'light' | 'dark';
  setTheme: (value: 'light' | 'dark') => void;
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

      markFilterOrder: [],
      setMarkFilterOrder: (order) => set({ markFilterOrder: order }),

      // triggers (default off)
      triggerCluster: false,
      triggerBoundary: false,
      // Repurposed: controls region/place name labels visibility
      triggerlabelName: true,
      setTriggerCluster: (value: boolean) => set({ triggerCluster: value }),
      setTriggerBoundary: (value: boolean) => set({ triggerBoundary: value }),
      setTriggerlabelName: (value: boolean) => set({ triggerlabelName: value }),

      // User Guide States
      drawerSnapIndex: null,
      setDrawerSnapIndex: (index) => set({ drawerSnapIndex: index }),
      forceSubregionOpen: false,
      setForceSubregionOpen: (value) => set({ forceSubregionOpen: value }),
      forceDetailOpen: false,
      setForceDetailOpen: (value) => set({ forceDetailOpen: value }),
      isUserGuideOpen: false,
      setIsUserGuideOpen: (value) => set({ isUserGuideOpen: value }),

      // Theme
      theme: 'dark',
      setTheme: (value) => set({ theme: value }),
    }),
    {
      name: 'ui-prefs',
      partialize: (state) => ({
        sidebarOpen: state.sidebarOpen,
        markFilterExpanded: state.markFilterExpanded,
        markFilterOrder: state.markFilterOrder,
        triggerCluster: state.triggerCluster,
        triggerBoundary: state.triggerBoundary,
        triggerlabelName: state.triggerlabelName,
        theme: state.theme,
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

export const useMarkFilterOrder = () => useUiPrefsStore((s) => s.markFilterOrder);
export const useSetMarkFilterOrder = () => useUiPrefsStore((s) => s.setMarkFilterOrder);

// Triggers hooks
export const useTriggerCluster = () => useUiPrefsStore((s) => s.triggerCluster);
export const useSetTriggerCluster = () => useUiPrefsStore((s) => s.setTriggerCluster);
export const useTriggerBoundary = () => useUiPrefsStore((s) => s.triggerBoundary);
export const useSetTriggerBoundary = () => useUiPrefsStore((s) => s.setTriggerBoundary);
export const useTriggerlabelName = () => useUiPrefsStore((s) => s.triggerlabelName);
export const useSetTriggerlabelName = () => useUiPrefsStore((s) => s.setTriggerlabelName);

// User Guide hooks
export const useDrawerSnapIndex = () => useUiPrefsStore((s) => s.drawerSnapIndex);
export const useSetDrawerSnapIndex = () => useUiPrefsStore((s) => s.setDrawerSnapIndex);
export const useForceSubregionOpen = () => useUiPrefsStore((s) => s.forceSubregionOpen);
export const useSetForceSubregionOpen = () => useUiPrefsStore((s) => s.setForceSubregionOpen);
export const useForceDetailOpen = () => useUiPrefsStore((s) => s.forceDetailOpen);
export const useSetForceDetailOpen = () => useUiPrefsStore((s) => s.setForceDetailOpen);
export const useIsUserGuideOpen = () => useUiPrefsStore((s) => s.isUserGuideOpen);
export const useSetIsUserGuideOpen = () => useUiPrefsStore((s) => s.setIsUserGuideOpen);

// Theme hooks
export const useTheme = () => useUiPrefsStore((s) => s.theme);
export const useSetTheme = () => useUiPrefsStore((s) => s.setTheme);
