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
  triggerOptimalPath: boolean;
  setTriggerCluster: (value: boolean) => void;
  setTriggerBoundary: (value: boolean) => void;
  setTriggerOptimalPath: (value: boolean) => void;

  // User Guide States (Transient)
  drawerSnapIndex: number | null;
  setDrawerSnapIndex: (index: number | null) => void;
  forceSubregionOpen: boolean;
  setForceSubregionOpen: (value: boolean) => void;
  forceDetailOpen: boolean;
  setForceDetailOpen: (value: boolean) => void;
  isUserGuideOpen: boolean;
  setIsUserGuideOpen: (value: boolean) => void;
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
      triggerOptimalPath: false,
      setTriggerCluster: (value: boolean) => set({ triggerCluster: value }),
      setTriggerBoundary: (value: boolean) => set({ triggerBoundary: value }),
      setTriggerOptimalPath: (value: boolean) => set({ triggerOptimalPath: value }),

      // User Guide States
      drawerSnapIndex: null,
      setDrawerSnapIndex: (index) => set({ drawerSnapIndex: index }),
      forceSubregionOpen: false,
      setForceSubregionOpen: (value) => set({ forceSubregionOpen: value }),
      forceDetailOpen: false,
      setForceDetailOpen: (value) => set({ forceDetailOpen: value }),
      isUserGuideOpen: false,
      setIsUserGuideOpen: (value) => set({ isUserGuideOpen: value }),
    }),
    {
      name: 'ui-prefs',
      partialize: (state) => ({
        sidebarOpen: state.sidebarOpen,
        markFilterExpanded: state.markFilterExpanded,
        markFilterOrder: state.markFilterOrder,
        triggerCluster: state.triggerCluster,
        triggerBoundary: state.triggerBoundary,
        triggerOptimalPath: state.triggerOptimalPath,
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
export const useTriggerOptimalPath = () => useUiPrefsStore((s) => s.triggerOptimalPath);
export const useSetTriggerOptimalPath = () => useUiPrefsStore((s) => s.setTriggerOptimalPath);

// User Guide hooks
export const useDrawerSnapIndex = () => useUiPrefsStore((s) => s.drawerSnapIndex);
export const useSetDrawerSnapIndex = () => useUiPrefsStore((s) => s.setDrawerSnapIndex);
export const useForceSubregionOpen = () => useUiPrefsStore((s) => s.forceSubregionOpen);
export const useSetForceSubregionOpen = () => useUiPrefsStore((s) => s.setForceSubregionOpen);
export const useForceDetailOpen = () => useUiPrefsStore((s) => s.forceDetailOpen);
export const useSetForceDetailOpen = () => useUiPrefsStore((s) => s.setForceDetailOpen);
export const useIsUserGuideOpen = () => useUiPrefsStore((s) => s.isUserGuideOpen);
export const useSetIsUserGuideOpen = () => useUiPrefsStore((s) => s.setIsUserGuideOpen);
