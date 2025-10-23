import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useUserRecord } from './userRecord';
import useRegion from './region';
import { useMemo } from 'react';
import { IMarkerData, SUBREGION_MARKS_MAP, WORLD_MARKS } from '@/data/marker';
import { REGION_DICT } from '@/data/map';

interface IMarkerStore {
    currentActivePoint: IMarkerData | null;
    setCurrentActivePoint: (point: IMarkerData) => void;
    filter: string[];
    points: string[];
    switchFilter: (typeKey: string) => void;

    searchString: string;
    setSearchString: (string) => void;

    // Persisted selected points (for UI selected state)
    selectedPoints: string[];
    toggleSelected: (id: string) => void;
    setSelected: (id: string, value: boolean) => void;
}

export const useMarkerStore = create<IMarkerStore>()(
    persist(
        (set, get) => ({
            currentActivePoint: null,
            setCurrentActivePoint: (point) => {
                set({ currentActivePoint: point });
            },
            filter: [],
            points: [],
            switchFilter: (typeKey) => {
                set((state) => {
                    const newFilter = state.filter.includes(typeKey)
                        ? state.filter.filter((key) => key !== typeKey)
                        : [...state.filter, typeKey];

                    return { filter: newFilter };
                });
            },
            searchString: '',
            setSearchString: (value: string) => {
                set({ searchString: value });
            },
            selectedPoints: [],
            toggleSelected: (id: string) => {
                const exists = get().selectedPoints.includes(id);
                get().setSelected(id, !exists);
            },
            setSelected: (id: string, value: boolean) => {
                set((state) => {
                    const exists = state.selectedPoints.includes(id);
                    if (value) {
                        return {
                            selectedPoints: exists
                                ? state.selectedPoints
                                : [...state.selectedPoints, id],
                        };
                    } else {
                        return {
                            selectedPoints: exists
                                ? state.selectedPoints.filter((x) => x !== id)
                                : state.selectedPoints,
                        };
                    }
                });
            },
        }),
        {
            name: 'marker-filter',
            partialize: (state) => ({ filter: state.filter, selectedPoints: state.selectedPoints }),
        },
    ),
);

export const usePoints = () => useMarkerStore((state) => state.points);
export const useFilter = () => useMarkerStore((state) => state.filter);
export const useSwitchFilter = () =>
    useMarkerStore((state) => state.switchFilter);

export const useSearchString = () =>
    useMarkerStore((state) => state.searchString);

export const useSelectedPoints = () =>
    useMarkerStore((state) => state.selectedPoints);
export const useToggleSelected = () =>
    useMarkerStore((state) => state.toggleSelected);

export const useWorldMarkerCount = (type) => {
    const pointsRecord = useUserRecord();
    return useMemo(() => {
        const ret = { total: 0, collected: 0 };
        if (!type) return ret;
        const worldTotal = WORLD_MARKS.filter((m) => m.type === type);
        ret.total = worldTotal.length;
        ret.collected = worldTotal.filter((m) =>
            pointsRecord.includes(m.id),
        ).length;
        return ret;
    }, [pointsRecord, type]);
};

export const useRegionMarkerCount = (type) => {
    const pointsRecord = useUserRecord();
    const currentRegion = useRegion((state) => state.currentRegionKey);
    const subRegions = REGION_DICT[currentRegion].subregions;
    return useMemo(() => {
        const ret = { total: 0, collected: 0 };
        if (!type) return ret;
        const regionTotal = subRegions
            .map((sr) => SUBREGION_MARKS_MAP[sr])
            .flat()
            .filter((m) => m.type === type);
        ret.total = regionTotal.length;
        ret.collected = regionTotal.filter((m) =>
            pointsRecord.includes(m.id),
        ).length;
        return ret;
    }, [pointsRecord, subRegions, type]);
};
