// region store for controlling the region and subregion
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type RegionPersistedState = {
    currentRegionKey: string;
    currentSubregionKey: string | null;
};

const isRegionPersistedState = (value: unknown): value is RegionPersistedState => {
    if (typeof value !== 'object' || value === null) return false;
    const record = value as Record<string, unknown>;
    if (typeof record.currentRegionKey !== 'string') return false;
    const sub = record.currentSubregionKey;
    return sub === null || typeof sub === 'string';
};

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
            // 通过 version + migrate 兼容历史数据（例如 Jinlong -> Wuling）
            version: 2,
            migrate: (persistedState: unknown, version: number): RegionPersistedState => {
                const fallback: RegionPersistedState = {
                    currentRegionKey: 'Valley_4',
                    currentSubregionKey: null,
                };

                if (!isRegionPersistedState(persistedState)) return fallback;

                if (version < 2 && persistedState.currentRegionKey === 'Jinlong') {
                    return {
                        ...persistedState,
                        currentRegionKey: 'Wuling',
                        currentSubregionKey: null,
                    };
                }

                return persistedState;
            },
            partialize: (state) => ({
                currentRegionKey: state.currentRegionKey,
                currentSubregionKey: state.currentSubregionKey,
            }),
        },
    ),
);

export default useRegion;
