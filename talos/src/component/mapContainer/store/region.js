// region store for controlling the region and subregion
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { getRegionSubregions } from '../map_config';
import useIni from './initial';
import useVisual from './visual';

const useRegion = create(
    persist(
        (set, get) => ({
            // Default state
            currentRegion: 'Valley_4',
            previousRegion: 'Valley_4',
            subregions: [],
            currentSubregion: null,

            initialize: () => {
                const currentRegion = get().currentRegion;
                set({
                    subregions: getRegionSubregions(currentRegion)
                });
            },

            setCurrentRegion: (region) => {
                const currentRegion = get().currentRegion;
                set({
                    previousRegion: currentRegion,
                    currentRegion: region,
                    subregions: getRegionSubregions(region),
                    currentSubregion: null
                });
            },

            setCurrentSubregion: (subregion) => {
                set({ currentSubregion: subregion });
            },

            findSubregionById: (id) => {
                const { subregions } = get();
                return subregions.find(s => s.id === id);
            },

            resetToDefault: () => {
                set({
                    currentSubregion: null
                });
            }
        }),
        {
            name: 'region-storage',
            partialize: (state) => ({
                currentRegion: state.currentRegion,
                currentSubregion: state.currentSubregion?.id
            })
        }
    )
);

export default useRegion;