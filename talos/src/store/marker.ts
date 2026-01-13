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
    batchToggleFilter: (typeKeys: string[]) => void;
    setFilter: (filter: string[]) => void;

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
                const prev = get().currentActivePoint;
                // If user clicks the same point again, still emit an update so UI can re-open.
                if (prev?.id === point.id) {
                    set({ currentActivePoint: { ...point } });
                    return;
                }
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
            batchToggleFilter: (typeKeys: string[]) => {
                set((state) => {
                    let newFilter = [...state.filter];
                    typeKeys.forEach(key => {
                        if (newFilter.includes(key)) {
                            newFilter = newFilter.filter(k => k !== key);
                        } else {
                            newFilter.push(key);
                        }
                    });
                    return { filter: newFilter };
                });
            },
            setFilter: (newFilter: string[]) => {
                set({ filter: newFilter });
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
export const useBatchToggleFilter = () =>
    useMarkerStore((state) => state.batchToggleFilter);
export const useSetFilter = () =>
    useMarkerStore((state) => state.setFilter);

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
    return useMemo(() => {
        const ret = { total: 0, collected: 0 };
        if (!type) return ret;
        // 兼容老的 region key（例如 Jinlong 已重命名为 Wuling）
        const regionConfig = REGION_DICT[currentRegion];
        const subRegions = regionConfig?.subregions ?? [];
        const regionTotal = subRegions
            .map((sr) => SUBREGION_MARKS_MAP[sr])
            .flat()
            .filter((m) => m.type === type);
        ret.total = regionTotal.length;
        ret.collected = regionTotal.filter((m) =>
            pointsRecord.includes(m.id),
        ).length;
        return ret;
    }, [pointsRecord, currentRegion, type]);
};
