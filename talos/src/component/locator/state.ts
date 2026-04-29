import { create } from 'zustand';

export type LocatorViewMode = 'off' | 'tracking' | 'detached';

type LocatorPosition = {
    lat: number;
    lng: number;
};

interface LocatorState {
    viewMode: LocatorViewMode;
    lastPosition: LocatorPosition | null;
    bannerMessage: string | null;
    setViewMode: (mode: LocatorViewMode) => void;
    setLastPosition: (position: LocatorPosition | null) => void;
    showBanner: (message: string) => void;
    clearBanner: () => void;
}

export const useLocatorStore = create<LocatorState>((set) => ({
    viewMode: 'off',
    lastPosition: null,
    bannerMessage: null,
    setViewMode: (viewMode) => set({ viewMode }),
    setLastPosition: (lastPosition) => set({ lastPosition }),
    showBanner: (bannerMessage) => set({ bannerMessage }),
    clearBanner: () => set({ bannerMessage: null }),
}));

export const LOCATOR_RETURN_CURRENT_EVENT = 'locator:return-current';

export const requestLocatorReturnCurrent = (): void => {
    window.dispatchEvent(new CustomEvent(LOCATOR_RETURN_CURRENT_EVENT));
};
