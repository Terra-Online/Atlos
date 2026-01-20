import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type ThemeMode = 'light' | 'dark' | 'auto';

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
  forceRegionSubOpen: boolean;
  setForceRegionSubOpen: (value: boolean) => void;
  forceLayerSubOpen: boolean;
  setForceLayerSubOpen: (value: boolean) => void;
  forceDetailOpen: boolean;
  setForceDetailOpen: (value: boolean) => void;
  isUserGuideOpen: boolean;
  setIsUserGuideOpen: (value: boolean) => void;

  // Theme (now supports 'auto')
  theme: ThemeMode;
  setTheme: (value: ThemeMode) => void;

  // Settings: Preference Enable Flags
  // UI Preferences
  prefsSidebarEnabled: boolean;
  setPrefsSidebarEnabled: (value: boolean) => void;
  prefsFilterOrderEnabled: boolean;
  setPrefsFilterOrderEnabled: (value: boolean) => void;
  prefsTriggersEnabled: boolean;
  setPrefsTriggersEnabled: (value: boolean) => void;
  prefsViewStateEnabled: boolean;
  setPrefsViewStateEnabled: (value: boolean) => void;

  // Map Preferences
  prefsMarkerProgressEnabled: boolean;
  setPrefsMarkerProgressEnabled: (value: boolean) => void;
  prefsAutoClusterEnabled: boolean;
  setPrefsAutoClusterEnabled: (value: boolean) => void;

  // Performance Mode
  prefsPerformanceModeEnabled: boolean;
  setPrefsPerformanceModeEnabled: (value: boolean) => void;
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
      triggerCluster: true,
      triggerBoundary: false,
      // Repurposed: controls region/place name labels visibility
      triggerlabelName: true,
      setTriggerCluster: (value: boolean) => set({ triggerCluster: value }),
      setTriggerBoundary: (value: boolean) => set({ triggerBoundary: value }),
      setTriggerlabelName: (value: boolean) => set({ triggerlabelName: value }),

      // User Guide States
      drawerSnapIndex: 1,
      setDrawerSnapIndex: (index) => set({ drawerSnapIndex: index }),
      forceRegionSubOpen: false,
      setForceRegionSubOpen: (value) => set({ forceRegionSubOpen: value }),
      forceLayerSubOpen: false,
      setForceLayerSubOpen: (value) => set({ forceLayerSubOpen: value }),
      forceDetailOpen: false,
      setForceDetailOpen: (value) => set({ forceDetailOpen: value }),
      isUserGuideOpen: false,
      setIsUserGuideOpen: (value) => set({ isUserGuideOpen: value }),

      // Theme (supports 'auto')
      theme: 'auto',
      setTheme: (value) => set({ theme: value }),

      // Settings: Preference Enable Flags (all default to true)
      prefsSidebarEnabled: true,
      setPrefsSidebarEnabled: (value) => set({ prefsSidebarEnabled: value }),
      prefsFilterOrderEnabled: true,
      setPrefsFilterOrderEnabled: (value) => set({ prefsFilterOrderEnabled: value }),
      prefsTriggersEnabled: true,
      setPrefsTriggersEnabled: (value) => set({ prefsTriggersEnabled: value }),
      prefsViewStateEnabled: true,
      setPrefsViewStateEnabled: (value) => set({ prefsViewStateEnabled: value }),
      prefsMarkerProgressEnabled: true,
      setPrefsMarkerProgressEnabled: (value) => set({ prefsMarkerProgressEnabled: value }),
      prefsAutoClusterEnabled: true,
      setPrefsAutoClusterEnabled: (value) => set({ prefsAutoClusterEnabled: value }),

      // Performance Mode (default: true - performance mode enabled)
      prefsPerformanceModeEnabled: true,
      setPrefsPerformanceModeEnabled: (value) => set({ prefsPerformanceModeEnabled: value }),
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
        drawerSnapIndex: state.drawerSnapIndex,
        theme: state.theme,
        // Settings flags
        prefsSidebarEnabled: state.prefsSidebarEnabled,
        prefsFilterOrderEnabled: state.prefsFilterOrderEnabled,
        prefsTriggersEnabled: state.prefsTriggersEnabled,
        prefsViewStateEnabled: state.prefsViewStateEnabled,
        prefsMarkerProgressEnabled: state.prefsMarkerProgressEnabled,
        prefsAutoClusterEnabled: state.prefsAutoClusterEnabled,
        prefsPerformanceModeEnabled: state.prefsPerformanceModeEnabled,
      }),
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<IUiPrefsStore>;
        const merged = { ...currentState };
        
        // Always restore preference flags
        if (persisted.prefsSidebarEnabled !== undefined) merged.prefsSidebarEnabled = persisted.prefsSidebarEnabled;
        if (persisted.prefsFilterOrderEnabled !== undefined) merged.prefsFilterOrderEnabled = persisted.prefsFilterOrderEnabled;
        if (persisted.prefsTriggersEnabled !== undefined) merged.prefsTriggersEnabled = persisted.prefsTriggersEnabled;
        if (persisted.prefsViewStateEnabled !== undefined) merged.prefsViewStateEnabled = persisted.prefsViewStateEnabled;
        if (persisted.prefsMarkerProgressEnabled !== undefined) merged.prefsMarkerProgressEnabled = persisted.prefsMarkerProgressEnabled;
        if (persisted.prefsAutoClusterEnabled !== undefined) merged.prefsAutoClusterEnabled = persisted.prefsAutoClusterEnabled;
        if (persisted.prefsPerformanceModeEnabled !== undefined) merged.prefsPerformanceModeEnabled = persisted.prefsPerformanceModeEnabled;
        if (persisted.theme !== undefined) merged.theme = persisted.theme;
        
        // Conditionally restore based on preference flags
        if (persisted.prefsSidebarEnabled && persisted.sidebarOpen !== undefined) {
          merged.sidebarOpen = persisted.sidebarOpen;
        }
        if (persisted.prefsSidebarEnabled && persisted.markFilterExpanded !== undefined) {
          merged.markFilterExpanded = persisted.markFilterExpanded;
        }
        if (persisted.prefsFilterOrderEnabled && persisted.markFilterOrder !== undefined) {
          merged.markFilterOrder = persisted.markFilterOrder;
        }
        if (persisted.prefsTriggersEnabled) {
          if (persisted.triggerCluster !== undefined) merged.triggerCluster = persisted.triggerCluster;
          if (persisted.triggerBoundary !== undefined) merged.triggerBoundary = persisted.triggerBoundary;
          if (persisted.triggerlabelName !== undefined) merged.triggerlabelName = persisted.triggerlabelName;
          if (persisted.drawerSnapIndex !== undefined) merged.drawerSnapIndex = persisted.drawerSnapIndex;
        }
        
        return merged;
      },
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
export const useDrawerSnapIndex = (): number | null => useUiPrefsStore((s) => s.drawerSnapIndex);
export const useSetDrawerSnapIndex = (): ((index: number | null) => void) => useUiPrefsStore((s) => s.setDrawerSnapIndex);
export const useForceRegionSubOpen = (): boolean => useUiPrefsStore((s) => s.forceRegionSubOpen);
export const useSetForceRegionSubOpen = (): ((value: boolean) => void) => useUiPrefsStore((s) => s.setForceRegionSubOpen);
export const useForceLayerSubOpen = (): boolean => useUiPrefsStore((s) => s.forceLayerSubOpen);
export const useSetForceLayerSubOpen = (): ((value: boolean) => void) => useUiPrefsStore((s) => s.setForceLayerSubOpen);
export const useForceDetailOpen = (): boolean => useUiPrefsStore((s) => s.forceDetailOpen);
export const useSetForceDetailOpen = (): ((value: boolean) => void) => useUiPrefsStore((s) => s.setForceDetailOpen);
export const useIsUserGuideOpen = (): boolean => useUiPrefsStore((s) => s.isUserGuideOpen);
export const useSetIsUserGuideOpen = (): ((value: boolean) => void) => useUiPrefsStore((s) => s.setIsUserGuideOpen);

// Theme hooks
export const useTheme = () => useUiPrefsStore((s) => s.theme);
export const useSetTheme = () => useUiPrefsStore((s) => s.setTheme);

// Performance Mode hooks
export const usePerformanceMode = (): boolean => useUiPrefsStore((s) => s.prefsPerformanceModeEnabled);
export const useSetPerformanceMode = (): ((value: boolean) => void) => useUiPrefsStore((s) => s.setPrefsPerformanceModeEnabled);