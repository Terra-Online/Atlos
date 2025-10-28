// region store for controlling the region and subregion
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface IRegionStore {
    currentRegionKey: string;
    currentSubregionKey: string | null;

    setCurrentRegion: (regionKey: string) => void;
    setCurrentSubregion: (subregionKey: string) => void;
    
    // 触发子区域切换的请求
    subregionSwitchRequest: string | null;
    requestSubregionSwitch: (subregionKey: string) => void;
    clearSubregionSwitchRequest: () => void;
}

const useRegion = create<IRegionStore>()(
    persist(
        (set) => ({
            currentRegionKey: 'Valley_4',
            currentSubregionKey: null,
            subregionSwitchRequest: null,

            setCurrentRegion: (regionKey: string) => {
                set({
                    currentRegionKey: regionKey,
                    currentSubregionKey: null,
                });
            },

            setCurrentSubregion: (subregionKey: string) => {
                set({ currentSubregionKey: subregionKey });
            },

            requestSubregionSwitch: (subregionKey: string) => {
                set({ subregionSwitchRequest: subregionKey });
            },

            clearSubregionSwitchRequest: () => {
                set({ subregionSwitchRequest: null });
            },
        }),
        {
            name: 'region-storage',
            partialize: (state) => ({
                currentRegionKey: state.currentRegionKey,
                currentSubregionKey: state.currentSubregionKey,
            }),
        },
    ),
);

export default useRegion;
