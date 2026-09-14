import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DESKTOPER_BREAKPOINT, DESKTOPEST_BREAKPOINT } from '@/platform/device';

type ThemeMode = 'light' | 'dark' | 'auto';

export const SIDEBAR_MIN_WIDTH = 300;
export const SIDEBAR_DEFAULT_WIDTH = 500;
export const INTEL_SIDEBAR_WIDTH = 300;
export const SIDEBAR_THREE_COLUMN_MIN_WIDTH = 400;
export const SIDEBAR_DESKTOP_MAX_WIDTH = 500;
export const SIDEBAR_DESKTOPER_MAX_WIDTH = 600;
export const SIDEBAR_DESKTOPEST_MAX_WIDTH = 800;

export const getSidebarMaxWidth = (viewportWidth: number = typeof window === 'undefined' ? 0 : window.innerWidth): number =>
  viewportWidth >= DESKTOPEST_BREAKPOINT
    ? SIDEBAR_DESKTOPEST_MAX_WIDTH
    : viewportWidth >= DESKTOPER_BREAKPOINT
      ? SIDEBAR_DESKTOPER_MAX_WIDTH
      : SIDEBAR_DESKTOP_MAX_WIDTH;

export const clampSidebarWidth = (value: number, maxWidth: number = getSidebarMaxWidth()): number =>
  Math.round(Math.max(SIDEBAR_MIN_WIDTH, Math.min(maxWidth, value)));

interface IUiPrefsStore {
  sidebarOpen: boolean;
  setSidebarOpen: (value: boolean) => void;

  sidebarWidth: number;
  setSidebarWidth: (value: number, maxWidth?: number) => void;

  intelSidebarWidth: number;

  intelCardsExpanded: boolean;
  setIntelCardsExpanded: (value: boolean) => void;

  layoutVersion: number;
  incrementLayoutVersion: () => void;

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
  desktopDrawerSnapIndex: number | null;
  setDesktopDrawerSnapIndex: (index: number | null) => void;
  mobileDrawerSnapIndex: number | null;
  setMobileDrawerSnapIndex: (index: number | null) => void;
  forceRegionSubOpen: boolean;
  setForceRegionSubOpen: (value: boolean) => void;
  forceLayerSubOpen: boolean;
  setForceLayerSubOpen: (value: boolean) => void;
  forceDetailOpen: boolean;
  setForceDetailOpen: (value: boolean) => void;
  forceHeadbarExpanded: boolean | null;
  setForceHeadbarExpanded: (value: boolean | null) => void;
  isUserGuideOpen: boolean;
  setIsUserGuideOpen: (value: boolean) => void;
  isAnnouncementOpen: boolean;
  setIsAnnouncementOpen: (value: boolean) => void;
  announcementFlowReady: boolean;
  setAnnouncementFlowReady: (value: boolean) => void;

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
  prefsHideCompletedMarkers: boolean;
  setPrefsHideCompletedMarkers: (value: boolean) => void;
  prefsLocatorSyncEnabled: boolean;
  setPrefsLocatorSyncEnabled: (value: boolean) => void;

  // Performance Mode
  prefsPerformanceModeEnabled: boolean;
  setPrefsPerformanceModeEnabled: (value: boolean) => void;
}

type UiPrefsPersistedState = Partial<IUiPrefsStore> & {
  sidebarWidthV2?: number;
};

const migrateSidebarWidthV2 = (state: UiPrefsPersistedState): UiPrefsPersistedState => {
  if (typeof state.sidebarWidthV2 === 'number') return state;

  const nextWidth =
    typeof state.sidebarWidth === 'number' && state.sidebarWidth >= SIDEBAR_THREE_COLUMN_MIN_WIDTH
      ? state.sidebarWidth
      : SIDEBAR_DEFAULT_WIDTH;

  const { sidebarWidth, ...nextState } = state;
  void sidebarWidth;

  return {
    ...nextState,
    sidebarWidthV2: nextWidth,
  };
};

export const useUiPrefsStore = create<IUiPrefsStore>()(
  persist(
    (set, get) => ({
      sidebarOpen: false,
      setSidebarOpen: (value) => set({ sidebarOpen: value }),

      sidebarWidth: SIDEBAR_DEFAULT_WIDTH,
      setSidebarWidth: (value, maxWidth) => set({ sidebarWidth: clampSidebarWidth(value, maxWidth) }),

      intelSidebarWidth: INTEL_SIDEBAR_WIDTH,

      intelCardsExpanded: false,
      setIntelCardsExpanded: (value) => set({ intelCardsExpanded: value }),

      layoutVersion: 0,
      incrementLayoutVersion: () => set((s) => ({ layoutVersion: s.layoutVersion + 1 })),

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
      desktopDrawerSnapIndex: 1,
      setDesktopDrawerSnapIndex: (index) => set({ desktopDrawerSnapIndex: index }),
      mobileDrawerSnapIndex: 0,
      setMobileDrawerSnapIndex: (index) => set({ mobileDrawerSnapIndex: index }),
      forceRegionSubOpen: false,
      setForceRegionSubOpen: (value) => set({ forceRegionSubOpen: value }),
      forceLayerSubOpen: false,
      setForceLayerSubOpen: (value) => set({ forceLayerSubOpen: value }),
      forceDetailOpen: false,
      setForceDetailOpen: (value) => set({ forceDetailOpen: value }),
      forceHeadbarExpanded: null,
      setForceHeadbarExpanded: (value) => set({ forceHeadbarExpanded: value }),
      isUserGuideOpen: false,
      setIsUserGuideOpen: (value) => set({ isUserGuideOpen: value }),
      isAnnouncementOpen: false,
      setIsAnnouncementOpen: (value) => set({ isAnnouncementOpen: value }),
      announcementFlowReady: false,
      setAnnouncementFlowReady: (value) => set({ announcementFlowReady: value }),

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
      prefsHideCompletedMarkers: false,
      setPrefsHideCompletedMarkers: (value) => set({ prefsHideCompletedMarkers: value }),
      prefsLocatorSyncEnabled: false,
      setPrefsLocatorSyncEnabled: (value) => set({ prefsLocatorSyncEnabled: value }),

      // Performance Mode (default: true - performance mode enabled)
      prefsPerformanceModeEnabled: true,
      setPrefsPerformanceModeEnabled: (value) => set({ prefsPerformanceModeEnabled: value }),
    }),
    {
      name: 'ui-prefs',
      version: 1,
      migrate: (persistedState: unknown, version: number): UiPrefsPersistedState => {
        const persisted =
          typeof persistedState === 'object' && persistedState !== null
            ? (persistedState as UiPrefsPersistedState)
            : {};

        return version < 1 ? migrateSidebarWidthV2(persisted) : persisted;
      },
      partialize: (state) => ({
        sidebarOpen: state.sidebarOpen,
        sidebarWidthV2: state.sidebarWidth,
        intelCardsExpanded: state.intelCardsExpanded,
        markFilterExpanded: state.markFilterExpanded,
        markFilterOrder: state.markFilterOrder,
        triggerCluster: state.triggerCluster,
        triggerBoundary: state.triggerBoundary,
        triggerlabelName: state.triggerlabelName,
        desktopDrawerSnapIndex: state.desktopDrawerSnapIndex,
        // mobileDrawerSnapIndex removed - always reset to 0
        theme: state.theme,
        // Settings flags
        prefsSidebarEnabled: state.prefsSidebarEnabled,
        prefsFilterOrderEnabled: state.prefsFilterOrderEnabled,
        prefsTriggersEnabled: state.prefsTriggersEnabled,
        prefsViewStateEnabled: state.prefsViewStateEnabled,
        prefsMarkerProgressEnabled: state.prefsMarkerProgressEnabled,
        prefsAutoClusterEnabled: state.prefsAutoClusterEnabled,
        prefsHideCompletedMarkers: state.prefsHideCompletedMarkers,
        prefsLocatorSyncEnabled: state.prefsLocatorSyncEnabled,
        prefsPerformanceModeEnabled: state.prefsPerformanceModeEnabled,
      }),
      merge: (persistedState, currentState) => {
        const persisted = (persistedState ?? {}) as UiPrefsPersistedState;
        const merged = { ...currentState };
        
        // Always restore preference flags
        if (persisted.prefsSidebarEnabled !== undefined) merged.prefsSidebarEnabled = persisted.prefsSidebarEnabled;
        if (persisted.prefsFilterOrderEnabled !== undefined) merged.prefsFilterOrderEnabled = persisted.prefsFilterOrderEnabled;
        if (persisted.prefsTriggersEnabled !== undefined) merged.prefsTriggersEnabled = persisted.prefsTriggersEnabled;
        if (persisted.prefsViewStateEnabled !== undefined) merged.prefsViewStateEnabled = persisted.prefsViewStateEnabled;
        if (persisted.prefsMarkerProgressEnabled !== undefined) merged.prefsMarkerProgressEnabled = persisted.prefsMarkerProgressEnabled;
        if (persisted.prefsAutoClusterEnabled !== undefined) merged.prefsAutoClusterEnabled = persisted.prefsAutoClusterEnabled;
        if (persisted.prefsHideCompletedMarkers !== undefined) merged.prefsHideCompletedMarkers = persisted.prefsHideCompletedMarkers;
        if (persisted.prefsLocatorSyncEnabled !== undefined) merged.prefsLocatorSyncEnabled = persisted.prefsLocatorSyncEnabled;
        if (persisted.prefsPerformanceModeEnabled !== undefined) merged.prefsPerformanceModeEnabled = persisted.prefsPerformanceModeEnabled;
        if (persisted.theme !== undefined) merged.theme = persisted.theme;
        if (persisted.intelCardsExpanded !== undefined) merged.intelCardsExpanded = persisted.intelCardsExpanded;
        
        // Conditionally restore based on preference flags
        if (persisted.prefsSidebarEnabled && persisted.sidebarOpen !== undefined) {
          merged.sidebarOpen = persisted.sidebarOpen;
        }
        if (persisted.prefsSidebarEnabled && persisted.sidebarWidthV2 !== undefined) {
          merged.sidebarWidth = clampSidebarWidth(persisted.sidebarWidthV2);
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
        }
        
        // Desktop drawer snap: always restore user's last state
        if (persisted.desktopDrawerSnapIndex !== undefined) {
          merged.desktopDrawerSnapIndex = persisted.desktopDrawerSnapIndex;
        }
        // Mobile drawer snap: not persisted, always reset to 0
        
        return merged;
      },
    },
  ),
);

export const useSidebarOpen = () => useUiPrefsStore((s) => s.sidebarOpen);
export const useSetSidebarOpen = () => useUiPrefsStore((s) => s.setSidebarOpen);
export const useSidebarWidth = () => useUiPrefsStore((s) => s.sidebarWidth);
export const useSetSidebarWidth = () => useUiPrefsStore((s) => s.setSidebarWidth);
export const useIntelSidebarWidth = () => useUiPrefsStore((s) => s.intelSidebarWidth);
export const useIntelCardsExpanded = () => useUiPrefsStore((s) => s.intelCardsExpanded);
export const useSetIntelCardsExpanded = () => useUiPrefsStore((s) => s.setIntelCardsExpanded);
export const useLayoutVersion = () => useUiPrefsStore((s) => s.layoutVersion);
export const useIncrementLayoutVersion = () => useUiPrefsStore((s) => s.incrementLayoutVersion);
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
export const useDesktopDrawerSnapIndex = (): number | null => useUiPrefsStore((s) => s.desktopDrawerSnapIndex);
export const useSetDesktopDrawerSnapIndex = (): ((index: number | null) => void) => useUiPrefsStore((s) => s.setDesktopDrawerSnapIndex);
export const useMobileDrawerSnapIndex = (): number | null => useUiPrefsStore((s) => s.mobileDrawerSnapIndex);
export const useSetMobileDrawerSnapIndex = (): ((index: number | null) => void) => useUiPrefsStore((s) => s.setMobileDrawerSnapIndex);
export const useForceRegionSubOpen = (): boolean => useUiPrefsStore((s) => s.forceRegionSubOpen);
export const useSetForceRegionSubOpen = (): ((value: boolean) => void) => useUiPrefsStore((s) => s.setForceRegionSubOpen);
export const useForceLayerSubOpen = (): boolean => useUiPrefsStore((s) => s.forceLayerSubOpen);
export const useSetForceLayerSubOpen = (): ((value: boolean) => void) => useUiPrefsStore((s) => s.setForceLayerSubOpen);
export const useForceDetailOpen = (): boolean => useUiPrefsStore((s) => s.forceDetailOpen);
export const useSetForceDetailOpen = (): ((value: boolean) => void) => useUiPrefsStore((s) => s.setForceDetailOpen);
export const useForceHeadbarExpanded = (): boolean | null => useUiPrefsStore((s) => s.forceHeadbarExpanded);
export const useSetForceHeadbarExpanded = (): ((value: boolean | null) => void) => useUiPrefsStore((s) => s.setForceHeadbarExpanded);
export const useIsUserGuideOpen = (): boolean => useUiPrefsStore((s) => s.isUserGuideOpen);
export const useSetIsUserGuideOpen = (): ((value: boolean) => void) => useUiPrefsStore((s) => s.setIsUserGuideOpen);
export const useIsAnnouncementOpen = (): boolean => useUiPrefsStore((s) => s.isAnnouncementOpen);
export const useSetIsAnnouncementOpen = (): ((value: boolean) => void) => useUiPrefsStore((s) => s.setIsAnnouncementOpen);
export const useAnnouncementFlowReady = (): boolean => useUiPrefsStore((s) => s.announcementFlowReady);
export const useSetAnnouncementFlowReady = (): ((value: boolean) => void) => useUiPrefsStore((s) => s.setAnnouncementFlowReady);

// Theme hooks
export const useTheme = () => useUiPrefsStore((s) => s.theme);
export const useSetTheme = () => useUiPrefsStore((s) => s.setTheme);

// Performance Mode hooks
export const usePerformanceMode = (): boolean => useUiPrefsStore((s) => s.prefsPerformanceModeEnabled);
export const useSetPerformanceMode = (): ((value: boolean) => void) => useUiPrefsStore((s) => s.setPrefsPerformanceModeEnabled);

// Hide Completed Markers hooks
export const useHideCompletedMarkers = (): boolean => useUiPrefsStore((s) => s.prefsHideCompletedMarkers);
export const useSetHideCompletedMarkers = (): ((value: boolean) => void) => useUiPrefsStore((s) => s.setPrefsHideCompletedMarkers);
export const useLocatorSyncEnabled = (): boolean => useUiPrefsStore((s) => s.prefsLocatorSyncEnabled);
export const useSetLocatorSyncEnabled = (): ((value: boolean) => void) => useUiPrefsStore((s) => s.setPrefsLocatorSyncEnabled);
