import { create } from 'zustand';
import type { RegionProfile } from '@/utils/endfield/locatorTransform';

export type LocatorViewMode = 'off' | 'tracking' | 'detached';

type LocatorPosition = {
    lat: number;
    lng: number;
    gameX: number;
    gameY: number;
    gameZ: number;
    locatorProfile?: RegionProfile | null;
    regionKey?: string | null;
    subregionKey?: string | null;
};

interface LocatorState {
    viewMode: LocatorViewMode;
    lastPosition: LocatorPosition | null;
    bannerKey: string | null;
    bindReq: number;
    authOpen: boolean;
    setViewMode: (mode: LocatorViewMode) => void;
    setLastPosition: (position: LocatorPosition | null) => void;
    showBanner: (key: string) => void;
    clearBanner: () => void;
    reqBind: () => void;
    openAuth: () => void;
    closeAuth: () => void;
}

export const useLocatorStore = create<LocatorState>((set) => ({
    viewMode: 'off',
    lastPosition: null,
    bannerKey: null,
    bindReq: 0,
    authOpen: false,
    setViewMode: (viewMode) => set({ viewMode }),
    setLastPosition: (lastPosition) => set({ lastPosition }),
    showBanner: (bannerKey) => set({ bannerKey }),
    clearBanner: () => set({ bannerKey: null }),
    reqBind: () => set((state) => ({ bindReq: state.bindReq + 1 })),
    openAuth: () => set({ authOpen: true }),
    closeAuth: () => set({ authOpen: false }),
}));

export const LOCATOR_RETURN_CURRENT_EVENT = 'locator:return-current';

export const requestLocatorReturnCurrent = (): void => {
    window.dispatchEvent(new CustomEvent(LOCATOR_RETURN_CURRENT_EVENT));
};
