// region store for controlling the region and subregion
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface IRegionStore {
    currentRegionKey: string;
    currentSubregionKey: string | null;

    setCurrentRegion: (regionKey: string) => void;
    setCurrentSubregion: (subregionKey: string) => void;
}

const useRegion = create<IRegionStore>()(
    persist(
        (set, get) => ({
            currentRegionKey: 'Valley_4',
            currentSubregionKey: null,


            setCurrentRegion: (regionKey: string) => {
                set({
                    currentRegionKey: regionKey,
                    currentSubregionKey: null
                });
            },

            setCurrentSubregion: (subregionKey: string) => {
                set({ currentSubregionKey: subregionKey });
            },
        }),
        {
            name: 'region-storage',
            partialize: (state) => ({
                currentRegionKey: state.currentRegionKey,
                currentSubregionKey: state.currentSubregionKey
            })
        }
    )
);

export default useRegion;